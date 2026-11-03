#!/usr/bin/env node
/**
 * Emberline server: static front end + JSON API over the SQLite store.
 *
 *   GET /api/sources               sources loaded in the DB (counts, year span, load time)
 *   GET /api/fires?source=&from=&to=  historical fires as compact columns
 *   GET /api/search?…              search the record (same query language as Search mode: q= takes plain
 *                                  language, plus from, to, m, cause, class, min, max, dur, dmin, dmax, near,
 *                                  bbox, named, spread, zone, sort, dir); format=json|csv|geojson, limit, offset
 *   GET /api/live                  active incidents (SPSA → CWFIS hotspots → simulation), satellite
 *                                  perimeters and SPSA communities;
 *                                  real (non-simulated) pulls are stored in live_snapshots
 *   GET /api/live/history          list of stored live snapshots
 *   GET /api/spread                fires with a True Spread Replay (NBAC perimeter + satellite hotspots)
 *   GET /api/spread/<id>           one fire: perimeter rings, arrival grid, daily growth, hotspots
 *   GET /api/provenance            where every dataset came from: import runs, per-year counts, spread coverage
 *   GET /api/provenance/ping/<id>  asks one source in src/provenance.js for its current state (fixed URLs only)
 *   GET /api/voice                 narration manifest (Kokoro clips made by "npm run make:voice"), keyed by line text
 *   GET /api/voice/<hash>.ogg      one narration clip from data/voice
 *
 * Usage: node server/index.mjs [port]    (default 5173)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { openDb, listSources, queryFires, listSpreadFires, getSpreadFire, provenanceInfo, allFires, spreadCnfdbIds, DB_PATH } from './db.mjs';
import { prepare, search, fromParams, parseText, mergeQuery, describe, toRows, toCSV, toGeoJSON } from '../src/search.js';
import { sourceById, pingSource } from '../src/provenance.js';
import { loadActiveIncidents, loadCommunities, loadPerimeters } from '../src/services/live.js';
import { enrich } from '../src/data.js';
import { CONFIG } from '../src/config.js';

const ROOT = resolve('.');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg',
};
const VOICE_DIR = resolve('data/voice');
// Only the front end is served; the database and raw downloads never are
const PUBLIC = [/^\/$/, /^\/index\.html$/, /^\/src\/[\w\-/]+\.(js|css|svg|png)$/, /^\/data\/fires\.json$/];

const db = openDb();
const cache = new Map();

function send(req, res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra };
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && !/image|audio/.test(type)) {
    buf = gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(status, headers).end(buf);
}

function firesFor(source, from, to) {
  const key = `${source}|${from}|${to}`;
  if (!cache.has(key)) cache.set(key, JSON.stringify(queryFires(db, { source, from, to })));
  return cache.get(key);
}

let live = null; // { at, body }
async function getLive(force = false) {
  const ttl = CONFIG.liveRefreshMinutes * 60_000;
  if (!force && live && Date.now() - live.at < ttl) return live.body;
  const source = listSources(db)[0]?.source;
  const rows = source ? JSON.parse(firesFor(source, 0, 9999)).columns : null;
  const fires = rows ? enrich(rows.fire_id.map((id, i) => ({
    fire_id: id, ignition_date: rows.ignition_date[i], size_ha: rows.size_ha[i],
    latitude: rows.latitude[i], longitude: rows.longitude[i], general_cause: rows.general_cause[i],
  }))) : [];
  const [incidents, communities, perimeters] = await Promise.all([loadActiveIncidents(fires), loadCommunities(), loadPerimeters().catch(() => [])]);
  if (!incidents.simulated) {
    db.prepare('INSERT INTO live_snapshots (fetched_at, source, label, incident_count, payload) VALUES (?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), incidents.source, incidents.label, incidents.incidents.length, JSON.stringify(incidents.incidents));
  }
  live = { at: Date.now(), body: { ...incidents, ...communities, perimeters, fetchedAt: new Date().toISOString() } };
  return live.body;
}

// Search runs over every fire of a source held in memory (prepared once; about 27k rows for CNFDB)
const searchCache = new Map();
function searchable(source) {
  if (!searchCache.has(source)) searchCache.set(source, { fires: prepare(allFires(db, source)), spreadIds: spreadCnfdbIds(db) });
  return searchCache.get(source);
}
// Community names in q= ("near La Ronge") resolve against the live SPSA layer, fetched at most hourly
let communityCache = null;
async function communities() {
  if (live?.body.communities?.length) return live.body.communities;
  if (!communityCache || Date.now() - communityCache.at > 3600_000) {
    communityCache = { at: Date.now(), list: (await loadCommunities().catch(() => ({ communities: [] }))).communities };
  }
  return communityCache.list;
}

async function handleSearch(req, res, url) {
  const p = url.searchParams;
  const sources = listSources(db);
  const source = p.get('source') ?? sources[0]?.source;
  if (!source || !sources.some((s) => s.source === source)) return send(req, res, 404, { error: `No data for source '${source ?? ''}'.` });
  const base = fromParams(p);
  const parsed = base.text ? parseText(base.text, { communities: /\b(near|around|close)\b|near:/i.test(base.text) ? await communities() : [] }) : null;
  const q = parsed ? mergeQuery({ ...base, text: '' }, { ...parsed.patch, text: parsed.text }) : base;
  const { fires, spreadIds } = searchable(source);
  const r = search(fires, q, { spreadIds });
  const format = p.get('format') ?? 'json';
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    return send(req, res, 200, toCSV(r.results, { near: Boolean(r.query.near) }), 'text/csv; charset=utf-8',
      { 'Content-Disposition': `attachment; filename="emberline-search-${stamp}.csv"` });
  }
  const understood = describe(r.query).map((x) => x.text);
  if (format === 'geojson') {
    return send(req, res, 200, toGeoJSON(r.results, { source, query: understood }), 'application/geo+json; charset=utf-8',
      { 'Content-Disposition': `attachment; filename="emberline-search-${stamp}.geojson"` });
  }
  const offset = Math.max(0, Number(p.get('offset')) || 0);
  const limit = Math.min(5000, Math.max(0, Number(p.get('limit') ?? 100) || 0));
  const facets = Object.fromEntries(Object.entries(r.facets).map(([k, m]) => [k, Object.fromEntries([...m].map(([v, e]) => [v, { count: e.count, ha: Math.round(e.ha) }]))]));
  return send(req, res, 200, {
    source, query: r.query, understood, notes: parsed?.notes ?? [], count: r.count, ha: Math.round(r.ha), offset, limit,
    results: toRows(r.results.slice(offset, offset + limit)), facets,
  });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/sources') return send(req, res, 200, { db: DB_PATH.split(sep).slice(-2).join('/'), sources: listSources(db) });
  if (p === '/api/fires') {
    const sources = listSources(db);
    const source = url.searchParams.get('source') ?? sources[0]?.source;
    if (!source || !sources.some((s) => s.source === source)) {
      return send(req, res, 404, { error: `No data for source '${source ?? ''}'. Run a load script first (see README).` });
    }
    const from = Number(url.searchParams.get('from') ?? 0), to = Number(url.searchParams.get('to') ?? 9999);
    return send(req, res, 200, firesFor(source, from, to));
  }
  if (p === '/api/search') return handleSearch(req, res, url);
  if (p === '/api/live') return send(req, res, 200, await getLive(url.searchParams.has('refresh')));
  if (p === '/api/live/history') {
    return send(req, res, 200, db.prepare('SELECT id, fetched_at, source, label, incident_count FROM live_snapshots ORDER BY id DESC LIMIT 500').all());
  }
  if (p === '/api/provenance') {
    const manifest = JSON.parse(await readFile(join(VOICE_DIR, 'manifest.json'), 'utf8').catch(() => 'null'));
    const voice = manifest && { clips: Object.keys(manifest.clips ?? {}).length, engine: manifest.engine, voice: manifest.voice, madeAt: manifest.madeAt };
    return send(req, res, 200, { ...provenanceInfo(db), voice, db: DB_PATH.split(sep).slice(-2).join('/') });
  }
  const ping = p.match(/^\/api\/provenance\/ping\/([\w-]+)$/);
  if (ping) {
    // Only the catalogue's own URLs are fetched; the id never becomes part of a URL
    const src = sourceById(ping[1]);
    if (!src?.ping) return send(req, res, 404, { error: `No checkable source '${ping[1]}'` });
    return send(req, res, 200, await pingSource(src));
  }
  if (p === '/api/spread') return send(req, res, 200, listSpreadFires(db));
  const spread = p.match(/^\/api\/spread\/([\w-]+)$/);
  if (spread) {
    const key = `spread|${spread[1]}`;
    if (!cache.has(key)) {
      const fire = getSpreadFire(db, spread[1]);
      if (!fire) return send(req, res, 404, { error: `No spread replay for '${spread[1]}'. Run "npm run load:spread".` });
      cache.set(key, JSON.stringify(fire));
    }
    return send(req, res, 200, cache.get(key));
  }
  if (p === '/api/voice') {
    const manifest = await readFile(join(VOICE_DIR, 'manifest.json'), 'utf8').catch(() => null);
    return send(req, res, 200, manifest ?? { clips: {}, missing: 'No narration clips yet. Run "npm run make:voice".' });
  }
  const clip = p.match(/^\/api\/voice\/([0-9a-f]{16}\.ogg)$/);
  if (clip) return send(req, res, 200, await readFile(join(VOICE_DIR, clip[1])), TYPES['.ogg'], { 'Cache-Control': 'max-age=86400' });
  return send(req, res, 404, { error: 'Unknown endpoint' });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (!PUBLIC.some((re) => re.test(url.pathname))) return send(req, res, 404, 'Not found', 'text/plain');
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) return send(req, res, 403, 'Forbidden', 'text/plain');
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
    send(req, res, 200, await readFile(path), TYPES[extname(path)] ?? 'application/octet-stream');
  } catch (err) {
    if (err.code === 'ENOENT') return send(req, res, 404, 'Not found', 'text/plain');
    console.error(err);
    send(req, res, 500, { error: err.message });
  }
}).listen(PORT, () => {
  const sources = listSources(db);
  console.log(`Emberline running at http://localhost:${PORT}`);
  console.log(sources.length
    ? `Database ${DB_PATH}: ${sources.map((s) => `${s.source} (${s.fires.toLocaleString()} fires, ${s.min_year}–${s.max_year})`).join(', ')}`
    : `Database ${DB_PATH} is empty. Run "npm run load:cnfdb" (real data) or "npm run load:mock".`);
});
