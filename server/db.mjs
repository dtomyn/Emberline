/**
 * db.mjs: SQLite store for Emberline, built on Node's built-in node:sqlite (Node 22.13+).
 *
 * One table holds every historical fire, tagged with the source it came from:
 *   cnfdb  Canadian National Fire Database (NRCan), filtered to SRC_AGENCY = 'SK'
 *   spsa   SPSA historical CSV export (Open Government)
 *   mock   synthetic data from scripts/generate-mock.mjs
 *
 * The database lives at data/wildfire.db (gitignored) unless EMBERLINE_DB is set.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DB_PATH = resolve(process.env.EMBERLINE_DB ?? 'data/wildfire.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fires (
  id            INTEGER PRIMARY KEY,
  source        TEXT    NOT NULL,              -- cnfdb | spsa | mock
  fire_id       TEXT    NOT NULL,
  ignition_date TEXT    NOT NULL,              -- yyyy-mm-dd
  year          INTEGER NOT NULL,
  size_ha       REAL    NOT NULL,
  latitude      REAL    NOT NULL,
  longitude     REAL    NOT NULL,
  general_cause TEXT    NOT NULL,              -- Lightning | Human | Unknown
  fire_name     TEXT,
  out_date      TEXT,
  protection_zone TEXT,
  raw_cause     TEXT,
  UNIQUE (source, fire_id)
);
CREATE INDEX IF NOT EXISTS fires_source_year ON fires (source, year, ignition_date);

CREATE TABLE IF NOT EXISTS import_runs (
  id            INTEGER PRIMARY KEY,
  source        TEXT NOT NULL,
  input         TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  rows_read     INTEGER,
  rows_loaded   INTEGER,
  rows_rejected INTEGER,
  notes         TEXT                           -- JSON: rejection reasons, etc.
);

-- Every live pull is kept, so the app builds its own archive of active seasons
CREATE TABLE IF NOT EXISTS live_snapshots (
  id          INTEGER PRIMARY KEY,
  fetched_at  TEXT NOT NULL,
  source      TEXT NOT NULL,                   -- spsa | cwfis | simulated
  label       TEXT,
  incident_count INTEGER NOT NULL,
  payload     TEXT NOT NULL                    -- JSON array of normalized incidents
);

-- True Spread Replay: large fires with a real NBAC perimeter and the satellite hotspots inside it.
-- Built by scripts/load-spread.mjs; arrival grids and daily growth are pre-computed there.
CREATE TABLE IF NOT EXISTS spread_fires (
  id            TEXT PRIMARY KEY,              -- nbac-<year>-<nfireid>
  year          INTEGER NOT NULL,
  nfireid       INTEGER,
  source        TEXT NOT NULL,                 -- nbac-wfs | nbac-shp
  cause         TEXT,
  area_ha       REAL NOT NULL,
  base_date     TEXT NOT NULL,                 -- day 0 of the replay (yyyy-mm-dd)
  hs_sdate TEXT, hs_edate TEXT, ag_sdate TEXT, ag_edate TEXT,
  min_lon REAL, min_lat REAL, max_lon REAL, max_lat REAL,
  cnfdb_fire_id TEXT, fire_name TEXT,          -- matched CNFDB record, when one exists
  hotspot_count INTEGER NOT NULL,
  rings         TEXT NOT NULL,                 -- JSON [[[lon,lat],…],…] simplified, even-odd fill
  grid          TEXT NOT NULL,                 -- JSON { w, h, cellKm, bbox, arrival: base64 Uint16 hours }
  growth        TEXT NOT NULL                  -- JSON { days: [{ ha, bbox }], merges: [{ day, lon, lat, ha }] }
);
CREATE TABLE IF NOT EXISTS spread_hotspots (
  fire_id TEXT NOT NULL,
  t       REAL NOT NULL,                       -- days since base_date
  lon REAL NOT NULL, lat REAL NOT NULL,
  frp REAL, sensor TEXT, ws REAL, wd REAL
);
CREATE INDEX IF NOT EXISTS spread_hotspots_fire ON spread_hotspots (fire_id, t);
`;

export function openDb(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  return db;
}

/**
 * Replace all rows for `source` with `fires` in one transaction and record the run.
 * Each fire: { fire_id, ignition_date, size_ha, latitude, longitude, general_cause, fire_name?, out_date?, protection_zone?, raw_cause? }
 */
export function replaceSource(db, source, fires, { input, rowsRead, rejects = {} } = {}) {
  const started = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO fires (source, fire_id, ignition_date, year, size_ha, latitude, longitude, general_cause, fire_name, out_date, protection_zone, raw_cause)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let loaded = 0;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM fires WHERE source = ?').run(source);
    for (const f of fires) {
      const r = insert.run(
        source, f.fire_id, f.ignition_date, Number(f.ignition_date.slice(0, 4)), f.size_ha, f.latitude, f.longitude,
        f.general_cause, f.fire_name ?? null, f.out_date ?? null, f.protection_zone ?? null, f.raw_cause ?? null);
      loaded += Number(r.changes);
    }
    const duplicates = fires.length - loaded;
    if (duplicates) rejects = { ...rejects, duplicate: (rejects.duplicate ?? 0) + duplicates };
    const rejected = Object.values(rejects).reduce((s, n) => s + n, 0);
    db.prepare(`INSERT INTO import_runs (source, input, started_at, finished_at, rows_read, rows_loaded, rows_rejected, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(source, input ?? null, started, new Date().toISOString(), rowsRead ?? fires.length, loaded, rejected, JSON.stringify(rejects));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return loaded;
}

/** Sources present in the database, with counts and year span. */
export function listSources(db) {
  return db.prepare(`
    SELECT f.source, COUNT(*) AS fires, ROUND(SUM(size_ha)) AS hectares, MIN(year) AS min_year, MAX(year) AS max_year,
           (SELECT finished_at FROM import_runs r WHERE r.source = f.source ORDER BY id DESC LIMIT 1) AS loaded_at
    FROM fires f GROUP BY f.source ORDER BY CASE f.source WHEN 'cnfdb' THEN 0 WHEN 'spsa' THEN 1 ELSE 2 END`).all();
}

/** Fires for a source and year range, as compact columns (about 40% the size of row objects). */
export function queryFires(db, { source, from = 0, to = 9999 }) {
  const rows = db.prepare(`
    SELECT fire_id, ignition_date, size_ha, latitude, longitude, general_cause, fire_name
    FROM fires WHERE source = ? AND year BETWEEN ? AND ? ORDER BY ignition_date, fire_id`).all(source, from, to);
  const cols = { fire_id: [], ignition_date: [], size_ha: [], latitude: [], longitude: [], general_cause: [], fire_name: [] };
  for (const r of rows) for (const k in cols) cols[k].push(r[k]);
  return { count: rows.length, columns: cols };
}

/** Replace every spread fire (and its hotspots) in one transaction and record the run. */
export function replaceSpread(db, fires, { input, rowsRead, rejects = {} } = {}) {
  const started = new Date().toISOString();
  const insFire = db.prepare(`
    INSERT INTO spread_fires (id, year, nfireid, source, cause, area_ha, base_date, hs_sdate, hs_edate, ag_sdate, ag_edate,
      min_lon, min_lat, max_lon, max_lat, cnfdb_fire_id, fire_name, hotspot_count, rings, grid, growth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insHot = db.prepare('INSERT INTO spread_hotspots (fire_id, t, lon, lat, frp, sensor, ws, wd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM spread_hotspots; DELETE FROM spread_fires;');
    for (const f of fires) {
      insFire.run(f.id, f.year, f.nfireid ?? null, f.source, f.cause ?? null, f.area_ha, f.base_date,
        f.hs_sdate ?? null, f.hs_edate ?? null, f.ag_sdate ?? null, f.ag_edate ?? null, ...f.bbox,
        f.cnfdb_fire_id ?? null, f.fire_name ?? null, f.hotspots.length,
        JSON.stringify(f.rings), JSON.stringify(f.grid), JSON.stringify(f.growth));
      for (const h of f.hotspots) insHot.run(f.id, h.t, h.lon, h.lat, h.frp, h.sensor, h.ws, h.wd);
    }
    const rejected = Object.values(rejects).reduce((s, n) => s + n, 0);
    db.prepare(`INSERT INTO import_runs (source, input, started_at, finished_at, rows_read, rows_loaded, rows_rejected, notes)
                VALUES ('spread', ?, ?, ?, ?, ?, ?, ?)`)
      .run(input ?? null, started, new Date().toISOString(), rowsRead ?? fires.length, fires.length, rejected, JSON.stringify(rejects));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return fires.length;
}

/** Replayable fires, largest first within each year (no geometry). */
export function listSpreadFires(db) {
  return db.prepare(`
    SELECT id, year, cause, area_ha, base_date, hs_sdate, hs_edate, ag_sdate, ag_edate,
           min_lon, min_lat, max_lon, max_lat, cnfdb_fire_id, fire_name, hotspot_count
    FROM spread_fires ORDER BY year DESC, area_ha DESC`).all();
}

/** One fire with its rings, arrival grid, daily growth and hotspots (as compact columns). */
export function getSpreadFire(db, id) {
  const f = db.prepare('SELECT * FROM spread_fires WHERE id = ?').get(id);
  if (!f) return null;
  const hs = db.prepare('SELECT t, lon, lat, frp, sensor, ws, wd FROM spread_hotspots WHERE fire_id = ? ORDER BY t').all(id);
  const cols = { t: [], lon: [], lat: [], frp: [], sensor: [], ws: [], wd: [] };
  for (const h of hs) for (const k in cols) cols[k].push(h[k]);
  return {
    ...f, bbox: [f.min_lon, f.min_lat, f.max_lon, f.max_lat],
    rings: JSON.parse(f.rings), grid: JSON.parse(f.grid), growth: JSON.parse(f.growth), hotspots: cols,
  };
}

/**
 * Everything the Sources view needs to say where the data came from: the latest import run per
 * source (with its rejection reasons), fires and hectares per year for each source, the spread
 * tables' coverage and sensors, and Emberline's own live-snapshot archive.
 */
export function provenanceInfo(db) {
  const runs = db.prepare(`
    SELECT source, input, started_at, finished_at, rows_read, rows_loaded, rows_rejected, notes
    FROM import_runs r WHERE id = (SELECT MAX(id) FROM import_runs WHERE source = r.source)`).all();
  const years = {};
  for (const r of db.prepare('SELECT source, year, COUNT(*) AS fires, ROUND(SUM(size_ha)) AS ha FROM fires GROUP BY source, year ORDER BY year').all()) {
    (years[r.source] ??= []).push({ year: r.year, fires: r.fires, ha: r.ha });
  }
  const sp = db.prepare(`SELECT COUNT(*) AS fires, MIN(year) AS minYear, MAX(year) AS maxYear, SUM(hotspot_count) AS hotspots,
    SUM(source = 'nbac-wfs') AS wfs, SUM(source = 'nbac-shp') AS shp, ROUND(SUM(area_ha)) AS ha FROM spread_fires`).get();
  const sensors = db.prepare('SELECT sensor, COUNT(*) AS n FROM spread_hotspots GROUP BY sensor ORDER BY n DESC').all();
  const snaps = db.prepare('SELECT COUNT(*) AS n, MIN(fetched_at) AS first, MAX(fetched_at) AS last FROM live_snapshots').get();
  return { sources: listSources(db), runs, years, spread: { ...sp, sensors }, snapshots: snaps };
}
