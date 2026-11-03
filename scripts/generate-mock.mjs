#!/usr/bin/env node
/**
 * generate-mock.mjs
 *
 * Produces a realistic *synthetic* SPSA historical wildfire CSV (2006–2025)
 * with the exact flat schema the real Open Government export uses:
 *
 *   FIRE_ID, IGNITION_DATE, SIZE_HA, LATITUDE, LONGITUDE, GENERAL_CAUSE
 *
 * The output is then loaded with `node scripts/load-csv.mjs <csv> --source mock`, so the
 * mock data takes the same parsing path a real SPSA export will.
 *
 * Realism model (approximate, for demo purposes only):
 *  - Most fires are in the boreal forest (north of ~53.5°N); a few grass fires in the south.
 *  - Lightning fires come in storm clusters (bursts of ignitions on nearby days),
 *    peak in July, and run larger.
 *  - Human-caused fires gather near northern communities and peak in spring (April–May).
 *  - Fire sizes follow a heavy-tailed distribution scaled to each year's area burned.
 *  - Big years (2015, 2021, 2023, 2025) have regional "hot zones".
 *
 * Usage:  node scripts/generate-mock.mjs [--seed 42] [--out data/raw/spsa_fires_mock.csv]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, [])
);
const OUT = resolve(args.out ?? 'data/raw/spsa_fires_mock.csv');
let seed = Number(args.seed ?? 20250601);

// Deterministic PRNG (mulberry32) so the dataset is reproducible
function rand() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// [fires, hectares burned]. Loosely shaped like public SK season summaries; synthetic.
const YEARS = {
  2006: [700, 320_000], 2007: [430, 150_000], 2008: [460, 140_000], 2009: [330, 35_000],
  2010: [450, 120_000], 2011: [380, 300_000], 2012: [370, 190_000], 2013: [400, 120_000],
  2014: [420, 330_000], 2015: [760, 1_780_000], 2016: [320, 40_000], 2017: [400, 180_000],
  2018: [520, 200_000], 2019: [300, 45_000], 2020: [250, 30_000], 2021: [560, 1_100_000],
  2022: [380, 100_000], 2023: [500, 1_900_000], 2024: [520, 460_000], 2025: [620, 2_900_000],
};

// Regional hot zones for big seasons: [lat, lon, spread°, weight]
const HOT_ZONES = {
  2015: [[55.3, -105.6, 1.2, 0.5], [55.9, -107.6, 1.0, 0.3]],
  2021: [[56.6, -104.5, 1.3, 0.45]],
  2023: [[57.8, -106.5, 1.6, 0.4], [55.0, -107.0, 1.0, 0.2]],
  2025: [[54.9, -102.6, 1.0, 0.35], [55.6, -104.2, 1.2, 0.3], [58.2, -107.0, 1.4, 0.2]],
};

// Northern communities (human-caused fires cluster near people and roads)
const COMMUNITIES = [
  [55.10, -105.28], [55.85, -108.48], [59.25, -105.83], [54.76, -101.88], [53.20, -105.75],
  [53.96, -102.27], [54.13, -108.43], [55.45, -107.90], [55.50, -106.60], [56.33, -103.27],
  [58.05, -103.17], [59.57, -108.61], [56.48, -109.43], [54.10, -106.80], [53.75, -106.05],
  [55.27, -104.75], [54.43, -103.17], [55.80, -105.30], [53.58, -104.00], [54.85, -106.10],
];

// Big lakes to avoid (ellipses: lat, lon, dLat, dLon)
const LAKES = [
  [59.25, -107.8, 0.25, 1.4], [57.3, -102.35, 0.7, 0.3], [58.2, -103.35, 0.4, 0.3],
  [56.0, -103.8, 0.25, 0.25], [55.05, -104.9, 0.2, 0.4], [59.9, -107.0, 0.08, 0.7],
];
const inLake = (lat, lon) =>
  LAKES.some(([a, b, da, db]) => ((lat - a) / da) ** 2 + ((lon - b) / db) ** 2 < 1);

// Saskatchewan's eastern border drifts west slightly going north
const eastLon = (lat) => -101.36 - (lat - 49) * 0.058;
const inSask = (lat, lon) => lat >= 49 && lat <= 60 && lon >= -110 && lon <= eastLon(lat);

function borealPoint(zones) {
  for (let i = 0; i < 500; i++) {
    let lat, lon;
    const z = zones && rand() < zones.reduce((s, z) => s + z[3], 0) ? weightedZone(zones) : null;
    if (z) {
      lat = z[0] + gauss() * z[2] * 0.6;
      lon = z[1] + gauss() * z[2];
    } else {
      // Density peaks around 55–56°N and thins toward 60°N
      lat = 53.6 + Math.abs(gauss()) * 2.4 + rand() * 1.2;
      lon = -110 + rand() * 8.4;
    }
    if (inSask(lat, lon) && lat > 53.3 && !inLake(lat, lon)) return [lat, lon];
  }
  return [55.5, -106];
}
function weightedZone(zones) {
  const total = zones.reduce((s, z) => s + z[3], 0);
  let r = rand() * total;
  for (const z of zones) if ((r -= z[3]) <= 0) return z;
  return zones[0];
}

function doyToDate(year, doy) {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + Math.round(doy) - 1);
  return d.toISOString().slice(0, 10);
}

const rows = [];
for (const [yearStr, [count, targetHa]] of Object.entries(YEARS)) {
  const year = Number(yearStr);
  const zones = HOT_ZONES[year];
  const fires = [];

  const nLightning = Math.round(count * (0.55 + rand() * 0.15));
  const nUnknown = Math.round(count * 0.05);
  const nHuman = count - nLightning - nUnknown;

  // Lightning: storm clusters
  let made = 0;
  while (made < nLightning) {
    const stormSize = Math.min(nLightning - made, 1 + Math.floor(-Math.log(rand()) * 7));
    const [clat, clon] = borealPoint(zones);
    const day = clamp(195 + gauss() * 24, 125, 285);
    for (let i = 0; i < stormSize; i++) {
      const lat = clat + gauss() * 0.35, lon = clon + gauss() * 0.6;
      if (!inSask(lat, lon) || inLake(lat, lon)) continue;
      fires.push({ lat, lon, doy: day + Math.floor(rand() * 4), cause: 'Lightning', sigma: 2.7 });
      made++;
    }
  }
  // Human: near communities (spring-heavy); some southern grass fires
  for (let i = 0; i < nHuman; i++) {
    let lat, lon;
    if (rand() < 0.12) {
      do { lat = 49.3 + rand() * 4.2; lon = -109.8 + rand() * 8; } while (!inSask(lat, lon));
    } else {
      const [cl, co] = pick(COMMUNITIES);
      do { lat = cl + gauss() * 0.25; lon = co + gauss() * 0.4; } while (!inSask(lat, lon) || inLake(lat, lon));
    }
    const doy = rand() < 0.6 ? clamp(130 + gauss() * 18, 95, 200) : clamp(200 + gauss() * 40, 110, 300);
    fires.push({ lat, lon, doy, cause: 'Human', sigma: 1.9 });
  }
  for (let i = 0; i < nUnknown; i++) {
    const [lat, lon] = borealPoint(null);
    fires.push({ lat, lon, doy: clamp(175 + gauss() * 40, 100, 290), cause: 'Unknown', sigma: 2.2 });
  }

  // Heavy-tailed sizes, then scale the tail so the season total hits the target
  for (const f of fires) f.raw = Math.exp(gauss() * f.sigma - 0.4);
  const small = fires.filter((f) => f.raw < 10);
  const large = fires.filter((f) => f.raw >= 10);
  const sumSmall = small.reduce((s, f) => s + f.raw, 0);
  const CAP = 420_000;
  for (const f of fires) f.size = f.raw;
  // Iterate: fires that hit the cap stay there, the rest absorb the remainder
  for (let pass = 0; pass < 8; pass++) {
    const capped = large.filter((f) => f.size >= CAP);
    const free = large.filter((f) => f.size < CAP);
    const freeSum = free.reduce((s, f) => s + f.size, 0) || 1;
    const k = (targetHa - sumSmall - capped.length * CAP) / freeSum;
    if (Math.abs(k - 1) < 1e-3) break;
    for (const f of free) f.size = Math.min(Math.max(f.size * k, 10), CAP);
  }

  fires.sort((a, b) => a.doy - b.doy);
  fires.forEach((f, i) => {
    rows.push([
      `SK-${year}-${String(i + 1).padStart(4, '0')}`,
      doyToDate(year, f.doy),
      f.size < 1 ? f.size.toFixed(2) : f.size < 100 ? f.size.toFixed(1) : Math.round(f.size),
      f.lat.toFixed(5),
      f.lon.toFixed(5),
      f.cause,
    ]);
  });
}

const header = 'FIRE_ID,IGNITION_DATE,SIZE_HA,LATITUDE,LONGITUDE,GENERAL_CAUSE';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, [header, ...rows.map((r) => r.join(','))].join('\n') + '\n');
console.log(`Wrote ${rows.length.toLocaleString()} synthetic fire records → ${OUT}`);
