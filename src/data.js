// Loading, enrichment and aggregation of the historical fire record.

export const EPOCH = Date.UTC(2006, 0, 1);
export const DAY = 86400000;
export const SEASON_START_DOY = 91; // ~Apr 1
export const SEASON_END_DOY = 305;  // ~Nov 1
export const CAUSES = ['Lightning', 'Human', 'Unknown'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const dateToT = (iso) => (Date.parse(iso + 'T00:00:00Z') - EPOCH) / DAY;
export const tToDate = (t) => new Date(EPOCH + Math.floor(t) * DAY);
export const tToISO = (t) => tToDate(t).toISOString().slice(0, 10);
export const yearStartT = (y) => (Date.UTC(y, 0, 1) - EPOCH) / DAY;
export const seasonT = (y, doy) => yearStartT(y) + doy - 1;

/** Fetch fires.json and add derived fields used by rendering. */
export async function loadFires(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  const raw = await res.json();
  return enrich(Array.isArray(raw) ? raw : raw.fires);
}

export function enrich(records) {
  const fires = records.map((f) => {
    const t = dateToT(f.ignition_date);
    const year = Number(f.ignition_date.slice(0, 4));
    return {
      ...f,
      t,
      year,
      doy: t - yearStartT(year) + 1,
      month: Number(f.ignition_date.slice(5, 7)) - 1,
      causeIdx: Math.max(0, CAUSES.indexOf(f.general_cause)),
      // Radius of a circle with the same area as the burn, in metres
      radius: Math.sqrt((f.size_ha * 10000) / Math.PI),
      position: [f.longitude, f.latitude],
    };
  });
  fires.sort((a, b) => a.t - b.t);
  return fires;
}

/** Index of the first fire with t >= value (fires sorted by t). */
export function lowerBound(fires, value) {
  let lo = 0, hi = fires.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fires[mid].t < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function years(fires) {
  const ys = [...new Set(fires.map((f) => f.year))].sort((a, b) => a - b);
  return ys.length ? ys : [2006];
}

export function summarize(list) {
  const s = { count: list.length, ha: 0, largest: null, byCause: CAUSES.map(() => ({ count: 0, ha: 0 })), byMonth: Array(12).fill(0), byMonthHa: Array(12).fill(0) };
  for (const f of list) {
    s.ha += f.size_ha;
    if (!s.largest || f.size_ha > s.largest.size_ha) s.largest = f;
    s.byCause[f.causeIdx].count++;
    s.byCause[f.causeIdx].ha += f.size_ha;
    s.byMonth[f.month]++;
    s.byMonthHa[f.month] += f.size_ha;
  }
  return s;
}

export function byYear(fires, ys) {
  const map = new Map(ys.map((y) => [y, { year: y, count: 0, ha: 0 }]));
  for (const f of fires) { const e = map.get(f.year); if (e) { e.count++; e.ha += f.size_ha; } }
  return [...map.values()];
}

/** Weekly hectares per season, laid out on a continuous season-only axis. */
export function weeklySeries(fires, ys) {
  const weeks = Math.ceil((SEASON_END_DOY - SEASON_START_DOY) / 7);
  const series = new Float64Array(ys.length * weeks);
  const counts = new Uint32Array(ys.length * weeks);
  const y0 = ys[0];
  for (const f of fires) {
    const w = Math.floor((f.doy - SEASON_START_DOY) / 7);
    if (w < 0 || w >= weeks) continue;
    const i = (f.year - y0) * weeks + w;
    series[i] += f.size_ha;
    counts[i]++;
  }
  return { series, counts, weeks };
}

export const fmtInt = (n) => Math.round(n).toLocaleString('en-CA');
export function fmtHa(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (n >= 10) return Math.round(n).toString();
  return n.toFixed(1);
}
export const fmtDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
