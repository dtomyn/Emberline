#!/usr/bin/env node
/**
 * parse-spsa-csv.mjs
 *
 * Ingests an SPSA historical wildfire CSV (Open Government export, 2006–2025)
 * and writes the normalized JSON the web app reads (data/fires.json).
 *
 * Output schema (one object per fire, sorted by ignition date):
 *   {
 *     "fire_id":       "SK-2015-0042",
 *     "ignition_date": "2015-06-27",      // ISO yyyy-mm-dd
 *     "size_ha":       1234.5,
 *     "latitude":      55.1234,
 *     "longitude":     -105.4321,
 *     "general_cause": "Lightning"        // Lightning | Human | Unknown
 *   }
 *
 * Built to cope with real-world exports:
 *  - RFC 4180 quoting (commas, quotes and newlines inside fields), BOM, CRLF
 *  - Header aliases ("Fire Number", "Start Date", "Area (ha)", "Lat", ...)
 *  - Date formats: yyyy-mm-dd, yyyy/mm/dd, dd/mm/yyyy, mm/dd/yyyy, ISO timestamps
 *  - Cause vocabulary normalized to Lightning / Human / Unknown
 *  - Rows outside Saskatchewan or with bad values are dropped and reported
 *
 * Usage:
 *   node scripts/parse-spsa-csv.mjs <input.csv> [output.json]
 *   node scripts/parse-spsa-csv.mjs data/raw/spsa_fires_mock.csv data/fires.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER_ALIASES = {
  fire_id: ['fire_id', 'fireid', 'fire_number', 'fire_no', 'fire_num', 'firenumber', 'incident_id', 'id'],
  ignition_date: ['ignition_date', 'ignitiondate', 'start_date', 'startdate', 'date_ignited', 'rep_date', 'reported_date', 'discovery_date', 'date'],
  size_ha: ['size_ha', 'sizeha', 'size', 'area_ha', 'area', 'hectares', 'final_size', 'fire_size_ha', 'size_hectares'],
  latitude: ['latitude', 'lat', 'y', 'lat_dd'],
  longitude: ['longitude', 'lon', 'long', 'lng', 'x', 'long_dd', 'lon_dd'],
  general_cause: ['general_cause', 'generalcause', 'cause', 'cause_general', 'fire_cause', 'cause_class'],
};

const SK_BOUNDS = { minLat: 48.9, maxLat: 60.1, minLon: -110.1, maxLon: -101.2 };

/** RFC 4180 CSV parser: returns an array of string arrays. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((v) => v !== '')) rows.push(row); }
  return rows;
}

const norm = (h) => h.trim().toLowerCase().replace(/[()]/g, '').replace(/[\s\-./]+/g, '_').replace(/_+$/, '');

export function mapHeaders(headers) {
  const normalized = headers.map(norm);
  const index = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = normalized.findIndex((h) => aliases.includes(h));
    if (i === -1) throw new Error(`Missing required column for "${key}". Found: ${headers.join(', ')}`);
    index[key] = i;
  }
  return index;
}

export function parseDate(raw) {
  const s = String(raw).trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) {
    // Ambiguous d/m vs m/d: if the first part is > 12 it must be the day
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    return a > 12 ? iso(y, b, a) : iso(y, a, b);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function iso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function normalizeCause(raw) {
  const s = String(raw).trim().toLowerCase();
  if (!s) return 'Unknown';
  if (/^(l|ltg|lightning|natural)/.test(s)) return 'Lightning';
  if (/^(h|human|person|people|recreation|resident|industr|railway|rail|incendiar|arson|equipment|burning|debris|forest industry|prescribed|other industry)/.test(s)) return 'Human';
  return 'Unknown';
}

const toNum = (v) => {
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

export function convert(text) {
  const [headers, ...data] = parseCsv(text);
  const ix = mapHeaders(headers);
  const fires = [];
  const rejects = { badDate: 0, badCoord: 0, outOfProvince: 0, badSize: 0, duplicate: 0 };
  const seen = new Set();

  for (const r of data) {
    const date = parseDate(r[ix.ignition_date] ?? '');
    if (!date) { rejects.badDate++; continue; }
    let lat = toNum(r[ix.latitude]), lon = toNum(r[ix.longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { rejects.badCoord++; continue; }
    if (lon > 0) lon = -lon; // some exports drop the western-hemisphere sign
    if (lat < SK_BOUNDS.minLat || lat > SK_BOUNDS.maxLat || lon < SK_BOUNDS.minLon || lon > SK_BOUNDS.maxLon) {
      rejects.outOfProvince++; continue;
    }
    const size = toNum(r[ix.size_ha]);
    if (!Number.isFinite(size) || size < 0) { rejects.badSize++; continue; }
    const id = String(r[ix.fire_id] ?? '').trim() || `SK-${date.slice(0, 4)}-${fires.length + 1}`;
    if (seen.has(id)) { rejects.duplicate++; continue; }
    seen.add(id);
    fires.push({
      fire_id: id,
      ignition_date: date,
      size_ha: Math.round(size * 100) / 100,
      latitude: Math.round(lat * 1e5) / 1e5,
      longitude: Math.round(lon * 1e5) / 1e5,
      general_cause: normalizeCause(r[ix.general_cause]),
    });
  }
  fires.sort((a, b) => a.ignition_date.localeCompare(b.ignition_date) || a.fire_id.localeCompare(b.fire_id));
  return { fires, rejects, total: data.length };
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output = 'data/fires.json'] = process.argv.slice(2);
  if (!input) {
    console.error('Usage: node scripts/parse-spsa-csv.mjs <input.csv> [output.json]');
    process.exit(1);
  }
  const { fires, rejects, total } = convert(readFileSync(input, 'utf8'));
  mkdirSync(dirname(resolve(output)), { recursive: true });
  // One record per line: compact, but still diff-friendly in git
  writeFileSync(output, '[\n' + fires.map((f) => JSON.stringify(f)).join(',\n') + '\n]\n');
  const ha = fires.reduce((s, f) => s + f.size_ha, 0);
  console.log(`Parsed ${total.toLocaleString()} rows → ${fires.length.toLocaleString()} fires, ${Math.round(ha).toLocaleString()} ha → ${output}`);
  const dropped = Object.entries(rejects).filter(([, n]) => n);
  if (dropped.length) console.log('Dropped:', Object.fromEntries(dropped));
}
