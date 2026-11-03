#!/usr/bin/env node
/**
 * export-json.mjs: writes one source from the SQLite store to a static JSON file, for
 * hosting the front end without the Node server (open index.html?data=./data/fires.json).
 * The output goes to data/ and is gitignored like the rest of the data.
 *
 * Usage: node scripts/export-json.mjs [--source cnfdb] [--from 1981] [--to 2025] [--out data/fires.json]
 */
import { writeFileSync } from 'node:fs';
import { openDb } from '../server/db.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const source = opt('source', 'cnfdb');
const out = opt('out', 'data/fires.json');

const db = openDb();
const rows = db.prepare(`SELECT fire_id, ignition_date, size_ha, latitude, longitude, general_cause, fire_name, out_date, protection_zone
  FROM fires WHERE source = ? AND year BETWEEN ? AND ? ORDER BY ignition_date`).all(source, Number(opt('from', 0)), Number(opt('to', 9999)));
writeFileSync(out, '[\n' + rows.map((r) => JSON.stringify({ ...r })).join(',\n') + '\n]\n');
console.log(`Exported ${rows.length.toLocaleString()} '${source}' fires → ${out}`);
