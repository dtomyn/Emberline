#!/usr/bin/env node
/**
 * Narration for the documentary mode ("Emberline Presents"), spoken by the local Kokoro voice that
 * C:\DevSource\IRISIdeas uses (af_heart, speed 0.97).
 *
 * Builds the story from the database exactly as the browser does (same fires, storms and spread
 * list), so every spoken number comes from the loaded data, then hands the lines to
 * scripts/kokoro-voice.py. Clips go to data/voice/ (gitignored) with a manifest the server
 * serves at /api/voice. Only new or changed lines are synthesized.
 *
 * Usage: node scripts/make-voice.mjs [--source cnfdb] [--dry-run]
 * Environment: KOKORO_PYTHON (Python with kokoro-onnx and soundfile) and KOKORO_DIR (folder with
 * kokoro-v1.0.onnx and voices-v1.0.bin). Both default to the IRISIdeas install.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb, listSources, queryFires, listSpreadFires } from '../server/db.mjs';
import { enrich, displayName } from '../src/data.js';
import { buildStorms } from '../src/lightning.js';
import { buildStory } from '../src/story.js';
import { storyLines } from '../src/narration.js';

const IRIS = 'C:\\DevSource\\IRISIdeas\\.venv';
const PYTHON = process.env.KOKORO_PYTHON ?? join(IRIS, process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
const MODEL_DIR = process.env.KOKORO_DIR ?? join(IRIS, 'kokoro');
const OUT = resolve('data/voice');

const args = process.argv.slice(2);
const only = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
const dryRun = args.includes('--dry-run');

/** The story for one source, built the way the browser builds it. */
function linesFor(db, source) {
  const c = queryFires(db, { source }).columns;
  const fires = enrich(c.fire_id.map((id, i) => ({
    fire_id: id, ignition_date: c.ignition_date[i], size_ha: c.size_ha[i], latitude: c.latitude[i],
    longitude: c.longitude[i], general_cause: c.general_cause[i], fire_name: c.fire_name[i],
  })));
  const spread = listSpreadFires(db).map((f) => ({ ...f }));
  return storyLines(buildStory(fires, displayName, { storms: buildStorms(fires).storms, spread }));
}

const db = openDb();
const sources = listSources(db).map((s) => s.source).filter((s) => !only || s === only);
if (!sources.length) { console.error(only ? `No source '${only}' in the database.` : 'The database is empty. Run "npm run load:cnfdb" first.'); process.exit(1); }

const byText = new Map();
for (const source of sources) {
  const lines = linesFor(db, source);
  console.log(`${source}: ${lines.length} lines`);
  for (const l of lines) if (!byText.has(l.text)) byText.set(l.text, { ...l, id: `${source}/${l.id}` });
}
const lines = [...byText.values()];
if (dryRun) { for (const l of lines) console.log(`\n[${l.id}]\n${l.sentences.join('\n')}`); process.exit(0); }

for (const [what, path] of [['Python', PYTHON], ['Kokoro model', join(MODEL_DIR, 'kokoro-v1.0.onnx')], ['Kokoro voices', join(MODEL_DIR, 'voices-v1.0.bin')]]) {
  if (!existsSync(path)) {
    console.error(`${what} not found at ${path}. Set KOKORO_PYTHON and KOKORO_DIR (see README). The documentary falls back to the browser's voice.`);
    process.exit(1);
  }
}
mkdirSync(OUT, { recursive: true });
const listPath = join(OUT, 'lines.json');
writeFileSync(listPath, JSON.stringify(lines, null, 1));
console.log(`Synthesizing ${lines.length} lines with Kokoro (voice af_heart)…`);
// -I keeps the interpreter from loading modules from the working directory
const run = spawnSync(PYTHON, ['-I', resolve('scripts/kokoro-voice.py'), listPath, OUT, MODEL_DIR], { stdio: 'inherit' });
process.exit(run.status ?? 1);
