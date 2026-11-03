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
