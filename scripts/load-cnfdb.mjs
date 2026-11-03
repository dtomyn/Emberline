#!/usr/bin/env node
/**
 * load-cnfdb.mjs: loads Saskatchewan fires from the Canadian National Fire Database
 * (NRCan / CWFIS) into the SQLite store.
 *
 *   1. Downloads NFDB_point_txt.zip from the CWFIS server (skipped if already present,
 *      unless --refresh is given) into data/raw/cnfdb/
 *   2. Reads the comma-delimited attribute table inside it
 *   3. Keeps rows where SRC_AGENCY == 'SK', drops prescribed burns, assistance requests
 *      and rows without usable coordinates or dates
 *   4. Replaces the 'cnfdb' source in data/wildfire.db
 *
 * Usage:
 *   node scripts/load-cnfdb.mjs                 # download if needed, then load
 *   node scripts/load-cnfdb.mjs --refresh       # force a fresh download
 *   node scripts/load-cnfdb.mjs --file path.zip # load a zip (or .txt) you downloaded yourself
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readZip } from './lib/unzip.mjs';
import { parseCsv } from './parse-spsa-csv.mjs';
import { openDb, replaceSource, DB_PATH } from '../server/db.mjs';

const BASE = 'https://cwfis.cfs.nrcan.gc.ca/downloads/nfdb/fire_pnt/current_version/';
const ZIP_NAME = 'NFDB_point_txt.zip';
const RAW_DIR = resolve('data/raw/cnfdb');
const SK = { minLat: 48.9, maxLat: 60.1, minLon: -110.1, maxLon: -101.2 };
const CAUSES = { N: 'Lightning', H: 'Human', 'H-PB': 'Human', U: 'Unknown', RE: 'Unknown' };

const argv = process.argv.slice(2);
const fileArg = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : null;
const refresh = argv.includes('--refresh');

async function download() {
  const dest = join(RAW_DIR, ZIP_NAME);
  if (existsSync(dest) && !refresh) {
    console.log(`Using cached ${dest} (pass --refresh to re-download)`);
    return dest;
  }
  mkdirSync(RAW_DIR, { recursive: true });
  console.log(`Downloading ${BASE}${ZIP_NAME} …`);
  const res = await fetch(BASE + ZIP_NAME);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`Saved ${(buf.length / 1e6).toFixed(1)} MB → ${dest}`);
  return dest;
}

function readTable(path) {
  if (/\.txt$|\.csv$/i.test(path)) return { name: path, text: readFileSync(path, 'utf8') };
  const entry = readZip(path).find((e) => /^NFDB_point.*\.txt$/i.test(e.name));
  if (!entry) throw new Error(`No NFDB_point*.txt table inside ${path}`);
  return { name: entry.name, text: entry.read().toString('utf8') };
}

/** Prefer the reported date (REP_DATE); fall back to YEAR/MONTH/DAY when it is missing. */
function fireDate(rep, y, m, d) {
  const iso = String(rep ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  y = Number(y); m = Number(m); d = Number(d) || 15; // a few records have no day; use mid-month
  if (!y || !m || m > 12) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, 28)).padStart(2, '0')}`;
}

const blank = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

export function extractSaskatchewan(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = parseCsv(lines[0])[0].map((h) => h.trim().toUpperCase());
  const ix = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const col of ['SRC_AGENCY', 'FIRE_ID', 'LATITUDE', 'LONGITUDE', 'YEAR', 'MONTH', 'DAY', 'REP_DATE', 'SIZE_HA', 'CAUSE']) {
    if (!(col in ix)) throw new Error(`CNFDB table is missing column ${col}`);
  }
  const fires = [];
  const rejects = { prescribed: 0, assistRequest: 0, badCoord: 0, badDate: 0 };
  let read = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Cheap prefilter before a full CSV parse: SRC_AGENCY is the second column
    if (!line.includes(',SK,')) continue;
    const r = parseCsv(line)[0];
    if (!r || r[ix.SRC_AGENCY]?.trim() !== 'SK') continue;
    read++;
    if (blank(r[ix.PRESCRIBED]) || r[ix.CAUSE]?.trim() === 'H-PB') { rejects.prescribed++; continue; }
    if (/^req/i.test(r[ix.FIRE_TYPE] ?? '')) { rejects.assistRequest++; continue; }
    const lat = Number(r[ix.LATITUDE]), lon = Number(r[ix.LONGITUDE]);
    if (!lat || !lon || lat < SK.minLat || lat > SK.maxLat || lon < SK.minLon || lon > SK.maxLon) { rejects.badCoord++; continue; }
    const date = fireDate(r[ix.REP_DATE], r[ix.YEAR], r[ix.MONTH], r[ix.DAY]);
    if (!date) { rejects.badDate++; continue; }
    const cause = r[ix.CAUSE]?.trim() ?? '';
    fires.push({
      fire_id: r[ix.NFDBFIREID]?.trim() || `SK-${date.slice(0, 4)}-${r[ix.FIRE_ID]?.trim()}`,
      ignition_date: date,
      size_ha: Math.max(0, Math.round(Number(r[ix.SIZE_HA]) * 100) / 100 || 0),
      latitude: Math.round(lat * 1e5) / 1e5,
      longitude: Math.round(lon * 1e5) / 1e5,
      general_cause: CAUSES[cause] ?? 'Unknown',
      fire_name: blank(r[ix.FIRENAME]),
      out_date: blank(r[ix.OUT_DATE])?.slice(0, 10) ?? null,
      protection_zone: blank(r[ix.PROTZONE]),
      raw_cause: cause || null,
    });
  }
  return { fires, rejects, read };
}

async function main() {
  const input = fileArg ? resolve(fileArg) : await download();
  const { name, text } = readTable(input);
  console.log(`Reading ${name} (${(text.length / 1e6).toFixed(1)} MB) …`);
  const { fires, rejects, read } = extractSaskatchewan(text);
  const db = openDb();
  const loaded = replaceSource(db, 'cnfdb', fires, { input: `${input}#${name}`, rowsRead: read, rejects });
  const ha = fires.reduce((s, f) => s + f.size_ha, 0);
  const years = fires.map((f) => Number(f.ignition_date.slice(0, 4)));
  console.log(`Loaded ${loaded.toLocaleString()} Saskatchewan fires (${Math.min(...years)}–${Math.max(...years)}, ${Math.round(ha).toLocaleString()} ha) → ${DB_PATH}`);
  console.log('Skipped:', Object.fromEntries(Object.entries(rejects).filter(([, n]) => n)));
  db.close();
}

if (process.argv[1]?.endsWith('load-cnfdb.mjs')) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
