#!/usr/bin/env node
/**
 * build-pages.mjs: builds a static copy of Emberline for GitHub Pages (or any static host) in dist/.
 *
 * The app normally reads the record through the Node server's API. A static host has no server, so this
 * writes what each API route would answer as a file (the browser maps routes to files with apiUrl() in
 * src/config.js):
 *
 *   api/sources.json              /api/sources
 *   api/fires/<source>.json       /api/fires?source=<source>
 *   api/spread.json               /api/spread
 *   api/spread/<id>.json          /api/spread/<id>
 *   api/provenance.json           /api/provenance
 *   api/voice.json, voice/*.ogg   /api/voice and its Kokoro clips (only if "npm run make:voice" made them)
 *
 * Routes that need a server are left out: /api/live (the browser asks SPSA and CWFIS itself),
 * /api/provenance/ping (the browser pings; CORS can block some sources) and /api/search (the Search tab
 * runs the same module in the page, so only its "API link" button is hidden).
 *
 * index.html gets <meta name="emberline-static"> and the server's Content-Security-Policy as a <meta>
 * (Pages can't send headers; frame-ancestors only works as a header, so it is dropped).
 *
 * dist/ is gitignored: the data is published by the Pages workflow (.github/workflows/pages.yml),
 * never committed. Mock data is left out unless you ask for it, and is then still labelled SIMULATED.
 *
 * Usage: node scripts/build-pages.mjs [--out dist] [--include-mock]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDb, listSources, queryFires, listSpreadFires, getSpreadFire, provenanceInfo } from '../server/db.mjs';
import { staticIndex } from './lib/pages.mjs';

const argv = process.argv.slice(2);
const OUT = resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'dist');
const includeMock = argv.includes('--include-mock');
const VOICE_DIR = resolve('data/voice');

if (OUT === resolve('.') || !OUT.startsWith(resolve('.'))) throw new Error(`Refusing to build into ${OUT}`);
rmSync(OUT, { recursive: true, force: true });

let bytes = 0, files = 0;
function write(rel, body) {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  writeFileSync(path, buf);
  bytes += buf.length; files++;
}

// ---------------------------------------------------------------- front end
write('index.html', staticIndex(readFileSync('index.html', 'utf8')));
cpSync('src', join(OUT, 'src'), { recursive: true, filter: (p) => !/\.(md|py)$/.test(p) });
write('.nojekyll', ''); // serve files as they are (no Jekyll processing)

// ---------------------------------------------------------------- the record
const db = openDb();
const sources = listSources(db).filter((s) => includeMock || s.source !== 'mock');
if (!sources.length) throw new Error('The database has no real data. Run "npm run load:cnfdb" first.');
write('api/sources.json', { db: 'static snapshot', builtAt: new Date().toISOString(), sources });
for (const s of sources) write(`api/fires/${s.source}.json`, queryFires(db, { source: s.source }));

const spread = listSpreadFires(db);
write('api/spread.json', spread);
for (const f of spread) write(`api/spread/${f.id}.json`, getSpreadFire(db, f.id));

// ---------------------------------------------------------------- narration
const manifestPath = join(VOICE_DIR, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
let clips = 0;
if (manifest) {
  const present = new Set(readdirSync(VOICE_DIR));
  for (const [text, clip] of Object.entries(manifest.clips ?? {})) {
    if (!/^[0-9a-f]{16}\.ogg$/.test(clip.file) || !present.has(clip.file)) { delete manifest.clips[text]; continue; }
    write(`api/voice/${clip.file}`, readFileSync(join(VOICE_DIR, clip.file)));
    clips++;
  }
}
write('api/voice.json', manifest ?? { clips: {}, missing: 'Published without Kokoro clips; narration uses the browser voice.' });

// ---------------------------------------------------------------- provenance
const info = provenanceInfo(db);
const keep = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => includeMock || k !== 'mock'));
const voice = manifest && { clips, engine: manifest.engine, voice: manifest.voice, madeAt: manifest.madeAt };
write('api/provenance.json', {
  ...info, sources, runs: info.runs.filter((r) => includeMock || r.source !== 'mock'), years: keep(info.years),
  voice, db: 'static snapshot',
});

const mb = (bytes / 1048576).toFixed(1);
console.log(`Static site → ${OUT}: ${files} files, ${mb} MB`);
console.log(`  ${sources.map((s) => `${s.source} ${s.fires.toLocaleString()} fires ${s.min_year}–${s.max_year}`).join(', ')}`);
console.log(`  ${spread.length} spread replays, ${clips} narration clips${manifest ? '' : ' (none: browser voice)'}`);
