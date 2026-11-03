#!/usr/bin/env node
/**
 * load-spread.mjs: builds True Spread Replay data. For Saskatchewan's large fires it takes the
 * real burned-area perimeter and the satellite detections inside it, then pre-computes how the
 * fire grew, day by day.
 *
 *   1. Perimeters: NBAC (National Burned Area Composite, NRCan), from the CWFIS WFS layer
 *      public:nbac (admin_area = 'SK'). Years the WFS doesn't carry yet (2025 as of 2026-11) fall
 *      back to the per-year NBAC shapefile zip, reprojected from Canada Lambert to WGS84.
 *   2. Hotspots: MODIS / VIIRS detections from public:hotspots, fetched one day at a time
 *      (multi-month queries time out at the gateway) with agency = 'SK', cached per day.
 *   3. For each fire, hotspots inside (or within 800 m of) the perimeter seed an arrival-time
 *      grid (see src/spread.js), which gives the daily burned area and any "merge" moments.
 *   4. Fires are matched to a CNFDB record (if loaded) for their name.
 *
 * Downloads are cached under data/raw/ (gitignored). Results replace the spread_* tables in data/wildfire.db.
 *
 * Usage:
 *   node scripts/load-spread.mjs                       # 2010 onward, fires ≥ 10,000 ha
 *   node scripts/load-spread.mjs --from 2002 --min-ha 5000
 *   node scripts/load-spread.mjs --refresh             # ignore cached downloads
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readZip } from './lib/unzip.mjs';
import { readShpPolygons, readDbf } from './lib/shapefile.mjs';
import { openDb, replaceSpread, DB_PATH } from '../server/db.mjs';
import {
  lccInverse, prepareRings, geometryRings, pointInRings, distanceToRingsKm, makeGrid, rasterize, lonToCol, latToRow,
  arrivalField, packArrival, dailyGrowth, parseHotspotCsv, daysBetween, u16ToBase64,
} from '../src/spread.js';

const WFS = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows';
const NBAC_DOWNLOADS = 'https://cwfis.cfs.nrcan.gc.ca/downloads/nbac/';
const RAW = resolve('data/raw');
const HOTSPOT_ERA = 2002;     // MODIS (Terra + Aqua) gives near-daily coverage from mid-2002
const EDGE_KM = 0.8;          // detections this close to the perimeter count (VIIRS 375 m / MODIS 1 km pixels)
const MAX_WINDOW_DAYS = 200;

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const opts = {
  from: Number(arg('--from', 2010)),
  to: Number(arg('--to', new Date().getUTCFullYear())),
  minHa: Number(arg('--min-ha', 10000)),
  concurrency: Number(arg('--concurrency', 4)),
  refresh: argv.includes('--refresh'),
};

// ---------------------------------------------------------------- helpers
const isoDay = (v) => (v ? String(v).slice(0, 10) : null);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { timeoutMs = 120000, tries = 4, html = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!html && text.startsWith('<')) throw new Error('service exception');
      return text;
    } catch (err) {
      if (attempt >= tries) throw new Error(`${err.message} for ${url}`);
      await sleep(2000 * attempt);
    }
  }
}

function wfsUrl(params) {
  const u = new URL(WFS);
  Object.entries({ service: 'WFS', version: '1.1.0', request: 'GetFeature', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  return u;
}

async function cached(path, produce) {
  if (existsSync(path) && !opts.refresh) return readFileSync(path, 'utf8');
  const text = await produce();
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return text;
}

/** Normalize NBAC attributes from WFS (lower case) or the shapefile DBF (upper case). */
export function normalizeNbac(p) {
  const g = (k) => p[k] ?? p[k.toUpperCase()] ?? null;
  return {
    year: Number(g('year')),
    nfireid: g('nfireid') == null ? null : Number(g('nfireid')),
    cause: g('firecaus'),
    area_ha: Number(g('adj_ha') ?? g('poly_ha')) || Number(g('poly_ha')) || 0,
    hs_sdate: isoDay(g('hs_sdate')), hs_edate: isoDay(g('hs_edate')),
    ag_sdate: isoDay(g('ag_sdate')), ag_edate: isoDay(g('ag_edate')),
  };
}

/** The replay window: first detection (or agency start) to last detection, padded by two days. */
export function fireWindow(f) {
  const starts = [f.hs_sdate, f.ag_sdate].filter(Boolean).sort();
  const ends = [f.hs_edate, f.hs_edate ? null : f.ag_edate].filter(Boolean).sort();
  if (!starts.length || !ends.length) return null;
  const start = addDays(starts[0], -2);
  let end = addDays(ends[ends.length - 1], 2);
  if (daysBetween(start, end) > MAX_WINDOW_DAYS) end = addDays(start, MAX_WINDOW_DAYS);
  return end > start ? { start, end } : null;
}

/** Parse LCC parameters from an ESRI .prj so the reprojection follows the file, not an assumption. */
export function parsePrj(text) {
  if (!/Lambert_Conformal_Conic/i.test(text)) throw new Error('Expected a Lambert Conformal Conic .prj');
  const p = (name) => Number(text.match(new RegExp(`PARAMETER\\["${name}",\\s*(-?[\\d.]+)\\]`, 'i'))?.[1]);
  return { lat1: p('Standard_Parallel_1'), lat2: p('Standard_Parallel_2'), lat0: p('Latitude_Of_Origin'), lon0: p('Central_Meridian'), x0: p('False_Easting') || 0, y0: p('False_Northing') || 0 };
}

// ---------------------------------------------------------------- perimeters
async function perimetersFromWfs(year) {
  const text = await cached(join(RAW, 'nbac', `wfs_SK_${year}_${opts.minHa}.json`), () => fetchText(wfsUrl({
    typeName: 'public:nbac', outputFormat: 'application/json', srsName: 'EPSG:4326',
    CQL_FILTER: `admin_area='SK' AND year=${year} AND poly_ha>=${opts.minHa}`,
  }), { timeoutMs: 300000 }));
  return JSON.parse(text).features.map((f) => ({ ...normalizeNbac(f.properties), source: 'nbac-wfs', rawRings: geometryRings(f.geometry) }));
}

async function perimetersFromShapefile(year) {
  const listing = await fetchText(NBAC_DOWNLOADS, { timeoutMs: 60000, html: true });
  const name = [...listing.matchAll(new RegExp(`NBAC_${year}_\\d+\\.zip`, 'g'))].map((m) => m[0]).sort().pop();
  if (!name) return [];
  const dest = join(RAW, 'nbac', name);
  if (!existsSync(dest) || opts.refresh) {
    console.log(`  downloading ${name} …`);
    mkdirSync(join(RAW, 'nbac'), { recursive: true });
    const res = await fetch(NBAC_DOWNLOADS + name);
    if (!res.ok) throw new Error(`NBAC download failed: HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  const entries = readZip(dest);
  const get = (ext) => entries.find((e) => e.name.toLowerCase().endsWith(ext))?.read();
  const rows = readDbf(get('.dbf'));
  const inv = lccInverse(parsePrj(get('.prj').toString()));
  const wanted = new Set();
  rows.forEach((r, i) => { if ((r.ADMIN_AREA ?? r.ADMIN_NAME) === 'SK' && !r.PRESCRIBED && Number(r.POLY_HA) >= opts.minHa) wanted.add(i); });
  const shapes = readShpPolygons(get('.shp'), (i) => wanted.has(i));
  return [...wanted].map((i) => ({
    ...normalizeNbac(rows[i]), source: 'nbac-shp',
    rawRings: (shapes[i] ?? []).map((ring) => ring.map(([x, y]) => inv(x, y))),
  }));
}

// ---------------------------------------------------------------- hotspots
async function hotspotsForDay(day) {
  const text = await cached(join(RAW, 'hotspots', `SK_${day}.csv`), () => fetchText(wfsUrl({
    typeName: 'public:hotspots', outputFormat: 'csv', propertyName: 'lat,lon,rep_date,sensor,frp,ws,wd',
    CQL_FILTER: `agency='SK' AND rep_day='${day}'`,
  })));
  return parseHotspotCsv(text);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      if (++done % 20 === 0 || done === items.length) process.stdout.write(`\r  hotspot days ${done}/${items.length}`);
    }
  }));
  process.stdout.write('\n');
  return out;
}

/**
 * Hotspots that belong to a fire: inside its window, and inside (or within EDGE_KM of) its perimeter.
 * Tested against the fire's raster mask, grown by EDGE_KM, because exact polygon tests against
 * tens of thousands of edges are far too slow for the hundreds of thousands of detections in a big season.
 */
export function assignHotspots(fire, hotspots, g = makeGrid(fire.bbox), mask = rasterize(fire.rings, g)) {
  const reach = Math.ceil(EDGE_KM / g.cellKm);
  const near = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const r = (i / g.w) | 0, c = i - r * g.w;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < g.h && cc < g.w && (dr * dr + dc * dc) * g.cellKm ** 2 <= (EDGE_KM + g.cellKm) ** 2) near[rr * g.w + cc] = 1;
      }
    }
  }
  const t0 = Date.parse(`${fire.window.start}T00:00:00Z`);
  const span = daysBetween(fire.window.start, fire.window.end) + 1;
  const out = [];
  for (const h of hotspots) {
    const c = lonToCol(g, h.lon), r = latToRow(g, h.lat);
    if (c < 0 || r < 0 || c >= g.w || r >= g.h || !near[r * g.w + c]) continue;
    const t = (Date.parse(h.time) - t0) / 86400000;
    if (t < 0 || t > span) continue;
    const r1 = (v, k) => (v == null ? null : Math.round(v * k) / k);
    out.push({ t: r1(t, 1000), lon: r1(h.lon, 1e4), lat: r1(h.lat, 1e4), frp: r1(h.frp, 10), sensor: h.sensor, ws: r1(h.ws, 10), wd: r1(h.wd, 1) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Match a CNFDB record: same year, inside or near the perimeter, largest wins. */
function matchCnfdb(db, fire) {
  let rows;
  try {
    rows = db.prepare(`SELECT fire_id, fire_name, size_ha, latitude, longitude FROM fires
      WHERE source = 'cnfdb' AND year = ? AND longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ? ORDER BY size_ha DESC`)
      .all(fire.year, fire.bbox[0] - 0.05, fire.bbox[2] + 0.05, fire.bbox[1] - 0.05, fire.bbox[3] + 0.05);
  } catch { return null; }
  return rows.find((r) => r.size_ha >= fire.area_ha * 0.05 &&
    (pointInRings(r.longitude, r.latitude, fire.rings) || distanceToRingsKm(r.longitude, r.latitude, fire.rings) < 3)) ?? null;
}

// ---------------------------------------------------------------- main
async function main() {
  console.log(`True Spread Replay: SK fires ≥ ${opts.minHa.toLocaleString()} ha, ${opts.from}–${opts.to}`);
  const rejects = { noDates: 0, preHotspotEra: 0, tooFewHotspots: 0 };
  const fires = [];
  for (let y = opts.from; y <= opts.to; y++) {
    let list = await perimetersFromWfs(y).catch((e) => { console.warn(`  ${y}: WFS failed (${e.message})`); return []; });
    if (!list.length) list = await perimetersFromShapefile(y).catch((e) => { console.warn(`  ${y}: shapefile failed (${e.message})`); return []; });
    for (const f of list) {
      const { rings, bbox } = prepareRings(f.rawRings);
      delete f.rawRings;
      if (!rings.length) continue;
      const window = fireWindow(f);
      if (!window) { rejects.noDates++; continue; }
      if (f.year < HOTSPOT_ERA) { rejects.preHotspotEra++; continue; }
      fires.push({ ...f, id: `nbac-${f.year}-${f.nfireid}`, rings, bbox, window });
    }
    console.log(`  ${y}: ${list.length} perimeters${list[0] ? ` (${list[0].source})` : ''}`);
  }

  const days = [...new Set(fires.flatMap((f) => {
    const out = [];
    for (let d = f.window.start; d <= f.window.end; d = addDays(d, 1)) out.push(d);
    return out;
  }))].sort();
  console.log(`Fetching SK hotspots for ${days.length} days (cached under data/raw/hotspots) …`);
  const byDay = new Map(days.map((d, i) => [d, i]));
  const perDay = await pool(days, opts.concurrency, (d) => hotspotsForDay(d).catch((e) => { console.warn(`\n  ${d}: ${e.message}`); return []; }));

  const db = openDb();
  const out = [];
  for (const f of fires) {
    const hs = [];
    for (let d = f.window.start; d <= f.window.end; d = addDays(d, 1)) for (const h of perDay[byDay.get(d)] ?? []) hs.push(h);
    const g = makeGrid(f.bbox);
    const mask = rasterize(f.rings, g);
    const hotspots = assignHotspots(f, hs, g, mask);
    if (hotspots.length < 10) { rejects.tooFewHotspots++; continue; }
    const arr = arrivalField(mask, g, hotspots);
    const growth = dailyGrowth(arr, g, f.area_ha);
    const match = matchCnfdb(db, f);
    out.push({
      ...f, base_date: f.window.start, hotspots, growth,
      grid: { w: g.w, h: g.h, cellKm: Math.round(g.cellKm * 1e4) / 1e4, bbox: g.bbox, arrival: u16ToBase64(packArrival(arr)) },
      cnfdb_fire_id: match?.fire_id ?? null, fire_name: match?.fire_name ?? null,
    });
    console.log(`  ${f.id}: ${Math.round(f.area_ha).toLocaleString()} ha, ${hotspots.length.toLocaleString()} hotspots, ${growth.days.length} days, ${growth.merges.length} merges${match ? ` · ${match.fire_id}` : ''}`);
  }
  replaceSpread(db, out, { input: `${WFS} public:nbac + public:hotspots, ${opts.from}–${opts.to}, ≥${opts.minHa} ha`, rowsRead: fires.length, rejects });
  console.log(`Loaded ${out.length} replayable fires → ${DB_PATH}`);
  console.log('Skipped:', Object.fromEntries(Object.entries(rejects).filter(([, n]) => n)));
  db.close();
}

if (process.argv[1]?.endsWith('load-spread.mjs')) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
