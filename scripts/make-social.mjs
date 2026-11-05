#!/usr/bin/env node
/**
 * The social images (LinkedIn cover 1920x1080, Viva Engage banner 2400x900), rendered from the live app
 * with figures computed from the database by social/figures.js: real data only, over the continuous
 * record (the same range the app and the film use). Rerun it after any load.
 *
 * Usage: npm run make:social [-- --source spsa] [-- --dry-run]
 * Environment: KOKORO_PYTHON, a Python with playwright (defaults to the IRISIdeas install, as for the film).
 * Output goes to data/social/ (gitignored).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from '../server/db.mjs';
import { socialFigures } from '../social/figures.js';

const IRIS = 'C:\\DevSource\\IRISIdeas\\.venv';
const PYTHON = process.env.KOKORO_PYTHON ?? join(IRIS, process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
const OUT = resolve('data/social');

const args = process.argv.slice(2);
const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'cnfdb';

const rows = openDb().prepare('SELECT year, size_ha FROM fires WHERE source = ?').all(source);
let figures;
try { figures = socialFigures(rows, source); }
catch (e) { console.error(`${e.message}${rows.length ? '' : ' Run "npm run load:cnfdb" first.'}`); process.exit(1); }
console.log(`${source}: ${figures.text.fires} fires, ${figures.text.hectares} ha, ${figures.text.range} (record from ${figures.recordFrom})`);
if (args.includes('--dry-run')) process.exit(0);

if (!existsSync(PYTHON)) {
  console.error(`Python not found at ${PYTHON}. Set KOKORO_PYTHON to a Python with playwright.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const figPath = join(OUT, 'figures.json');
writeFileSync(figPath, JSON.stringify(figures, null, 1));
// -I keeps the interpreter from loading modules from the working directory
const run = spawnSync(PYTHON, ['-I', resolve('social/render.py'), figPath, OUT], { stdio: 'inherit' });
process.exit(run.status ?? 1);
