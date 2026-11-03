#!/usr/bin/env node
/**
 * Emberline server: static front end + JSON API over the SQLite store.
 *
 *   GET /api/sources               sources loaded in the DB (counts, year span, load time)
 *   GET /api/fires?source=&from=&to=  historical fires as compact columns
 *   GET /api/live                  active incidents (SPSA → CWFIS hotspots → simulation), satellite
 *                                  perimeters and SPSA communities;
 *                                  real (non-simulated) pulls are stored in live_snapshots
 *   GET /api/live/history          list of stored live snapshots
 *
 * Usage: node server/index.mjs [port]    (default 5173)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { openDb, listSources, queryFires, DB_PATH } from './db.mjs';
import { loadActiveIncidents, loadCommunities, loadPerimeters } from '../src/services/live.js';
import { enrich } from '../src/data.js';
import { CONFIG } from '../src/config.js';

const ROOT = resolve('.');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};
// Only the front end is served; the database and raw downloads never are
const PUBLIC = [/^\/$/, /^\/index\.html$/, /^\/src\/[\w\-/]+\.(js|css|svg|png)$/, /^\/data\/fires\.json$/];

const db = openDb();
const cache = new Map();

function send(req, res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra };
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && !/image/.test(type)) {
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
  if (p === '/api/live') return send(req, res, 200, await getLive(url.searchParams.has('refresh')));
  if (p === '/api/live/history') {
    return send(req, res, 200, db.prepare('SELECT id, fetched_at, source, label, incident_count FROM live_snapshots ORDER BY id DESC LIMIT 500').all());
  }
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
