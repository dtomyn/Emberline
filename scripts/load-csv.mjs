#!/usr/bin/env node
/**
 * load-csv.mjs: loads a flat historical fire CSV (the SPSA Open Government schema:
 * FIRE_ID, IGNITION_DATE, SIZE_HA, LATITUDE, LONGITUDE, GENERAL_CAUSE, or any header alias
 * that parse-spsa-csv.mjs recognizes) into the SQLite store.
 *
 * Usage:
 *   node scripts/load-csv.mjs <file.csv> [--source spsa]
 *   node scripts/load-csv.mjs data/raw/spsa_fires_mock.csv --source mock
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { convert } from './parse-spsa-csv.mjs';
import { openDb, replaceSource, DB_PATH } from '../server/db.mjs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--source');
const source = argv.includes('--source') ? argv[argv.indexOf('--source') + 1] : 'spsa';
if (!file || !/^[a-z0-9_-]+$/.test(source)) {
  console.error('Usage: node scripts/load-csv.mjs <file.csv> [--source spsa|mock]');
  process.exit(1);
}

const path = resolve(file);
const { fires, rejects, total } = convert(readFileSync(path, 'utf8'));
const db = openDb();
const loaded = replaceSource(db, source, fires, { input: path, rowsRead: total, rejects });
console.log(`Loaded ${loaded.toLocaleString()} of ${total.toLocaleString()} rows as source '${source}' → ${DB_PATH}`);
const dropped = Object.entries(rejects).filter(([, n]) => n);
if (dropped.length) console.log('Skipped:', Object.fromEntries(dropped));
db.close();
