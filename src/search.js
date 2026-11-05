// search.js: the query model behind Search mode, shared by the browser and the server's /api/search.
//
// A query is a plain object (see emptyQuery). It can be written three ways, which all meet here:
//   - the controls in the Search panel,
//   - a plain-language search box ("lightning fires near La Ronge over 1000 ha in july 2015"), read by parseText,
//   - a URL query string (toParams / fromParams), used for shareable links and for /api/search.
//
// search() filters, sorts and counts in one pass. Facet counts follow the usual faceted-search rule: each
// facet is counted with every filter applied except its own, so a chip shows what you would get by
// toggling it. Everything here runs in Node too (no browser globals).
import { CAUSES, MONTHS, displayName, fmtInt } from './data.js';
import { haversineKm } from './services/live.js';

// Canadian wildfire size classes (A–E), in hectares; the upper bound is inclusive
export const SIZE_CLASSES = [
  { id: 'A', max: 0.1, label: '≤ 0.1 ha' },
  { id: 'B', max: 4, label: '0.1–4 ha' },
  { id: 'C', max: 40, label: '4–40 ha' },
  { id: 'D', max: 200, label: '40–200 ha' },
  { id: 'E', max: Infinity, label: '> 200 ha' },
];
// How long a fire burned: OUT_DATE minus the reported date, in whole days
export const DURATIONS = [
  { id: 'd0', min: 0, max: 0, label: 'Same day' },
  { id: 'd1', min: 1, max: 6, label: '1–6 days' },
  { id: 'd7', min: 7, max: 29, label: '1–4 weeks' },
  { id: 'd30', min: 30, max: 89, label: '1–3 months' },
  { id: 'd90', min: 90, max: Infinity, label: '3+ months' },
];
export const SORTS = { size: 'Largest first', date: 'Newest first', days: 'Longest burning', name: 'Name', km: 'Nearest first' };
const SORT_DEFAULT_DIR = { size: 'desc', date: 'desc', days: 'desc', name: 'asc', km: 'asc' };
export const DEFAULT_RADIUS_KM = 50;

export function emptyQuery() {
  return {
    text: '', from: null, to: null, months: [], causes: [], classes: [], sizeMin: null, sizeMax: null,
    durs: [], durMin: null, durMax: null, near: null, bbox: null, named: false, spread: false, zones: [],
    sort: 'size', dir: 'desc',
  };
}

// ---------------------------------------------------------------- per-fire derived fields

export const sizeClass = (ha) => SIZE_CLASSES.find((c) => ha <= c.max).id;
export function durationDays(f) {
  if (!f.out_date) return null;
  const d = Math.round((Date.parse(f.out_date.slice(0, 10)) - Date.parse(f.ignition_date)) / 86400000);
  return Number.isFinite(d) && d >= 0 && d <= 366 ? d : null; // negative or year-long spans are recording slips
}
const durationBucket = (d) => (d == null ? null : DURATIONS.find((b) => d >= b.min && d <= b.max).id);

/** Adds the fields search needs (once per record): year, month, size class, duration, display name, text haystack. */
export function prepare(fires) {
  for (const f of fires) {
    if (f._hay !== undefined) continue;
    f.year ??= Number(f.ignition_date.slice(0, 4));
    f.month ??= Number(f.ignition_date.slice(5, 7)) - 1;
    f.cls = sizeClass(f.size_ha);
    f.days = durationDays(f);
    f.dur = durationBucket(f.days);
    f.label = displayName(f);
    f._hay = `${f.label} ${f.fire_id} ${f.fire_name ?? ''}`.toLowerCase();
  }
  return fires;
}

// ---------------------------------------------------------------- filtering

/** Text terms: words must all appear; "quoted phrases" stay together; -word excludes. */
export function textTerms(text) {
  const terms = [];
  for (const m of String(text ?? '').toLowerCase().matchAll(/(-?)"([^"]+)"|(-?)(\S+)/g)) {
    const neg = (m[1] || m[3]) === '-';
    const t = (m[2] ?? m[4]).trim();
    if (t && t !== '-') terms.push({ t, neg });
  }
  return terms;
}

// Each dimension is one test; facets skip their own
function dimensions(q, ctx = {}) {
  const dims = [];
  const terms = textTerms(q.text);
  if (terms.length) dims.push(['text', (f) => terms.every(({ t, neg }) => f._hay.includes(t) !== neg)]);
  if (q.from != null || q.to != null) {
    const a = q.from ?? -Infinity, b = q.to ?? Infinity;
    dims.push(['year', (f) => f.year >= a && f.year <= b]);
  }
  if (q.months.length) { const s = new Set(q.months); dims.push(['month', (f) => s.has(f.month)]); }
  if (q.causes.length) { const s = new Set(q.causes); dims.push(['cause', (f) => s.has(f.general_cause)]); }
  if (q.classes.length) { const s = new Set(q.classes); dims.push(['cls', (f) => s.has(f.cls)]); }
  if (q.sizeMin != null || q.sizeMax != null) {
    const a = q.sizeMin ?? -Infinity, b = q.sizeMax ?? Infinity;
    dims.push(['size', (f) => f.size_ha >= a && f.size_ha <= b]);
  }
  if (q.durs.length) { const s = new Set(q.durs); dims.push(['dur', (f) => s.has(f.dur)]); }
  if (q.durMin != null || q.durMax != null) {
    const a = q.durMin ?? -Infinity, b = q.durMax ?? Infinity;
    dims.push(['days', (f) => f.days != null && f.days >= a && f.days <= b]);
  }
  if (q.near) {
    const { lat, lon, km } = q.near;
    // Cheap box test first: 1° of latitude ≈ 111 km
    const dLat = km / 111 + 0.01, dLon = km / (111 * Math.cos((lat * Math.PI) / 180)) + 0.01;
    dims.push(['near', (f) => Math.abs(f.latitude - lat) <= dLat && Math.abs(f.longitude - lon) <= dLon
      && haversineKm(lat, lon, f.latitude, f.longitude) <= km]);
  }
  if (q.bbox) {
    const [w, s, e, n] = q.bbox;
    dims.push(['bbox', (f) => f.longitude >= w && f.longitude <= e && f.latitude >= s && f.latitude <= n]);
  }
  if (q.named) dims.push(['named', (f) => f.label !== f.fire_id]);
  if (q.spread) { const ids = ctx.spreadIds ?? new Set(); dims.push(['spread', (f) => ids.has(f.fire_id)]); }
  if (q.zones.length) { const s = new Set(q.zones); dims.push(['zone', (f) => s.has(f.protection_zone ?? 'None')]); }
  return dims;
}

/** One predicate for the whole query (used by Replay and Explore when they take on a search). */
export function compile(q, ctx) {
  const tests = dimensions(normalizeQuery(q), ctx).map(([, t]) => t);
  return (f) => tests.every((t) => t(f));
}

const FACETS = { year: (f) => f.year, month: (f) => f.month, cause: (f) => f.general_cause, cls: (f) => f.cls, dur: (f) => f.dur ?? 'none', zone: (f) => f.protection_zone ?? 'None' };

/**
 * Filter, count and sort. Returns { results, count, ha, facets } where facets[name] is a Map of
 * value → { count, ha }, counted with every other filter applied (one pass: a fire that fails exactly
 * one test still counts toward that test's own facet).
 */
export function search(fires, query, ctx = {}) {
  const q = normalizeQuery(query);
  const dims = dimensions(q, ctx);
  const facetOf = Object.fromEntries(dims.map(([d]) => [d, d === 'size' ? 'cls' : d === 'days' ? 'dur' : d]));
  const facets = Object.fromEntries(Object.keys(FACETS).map((k) => [k, new Map()]));
  const bump = (name, f) => {
    const key = FACETS[name](f);
    const e = facets[name].get(key) ?? { count: 0, ha: 0 };
    e.count++; e.ha += f.size_ha;
    facets[name].set(key, e);
  };
  const results = [];
  let ha = 0;
  for (const f of fires) {
    let failed = null, fails = 0;
    for (const [d, test] of dims) {
      if (!test(f)) { if (++fails > 1) break; failed = d; }
    }
    if (fails === 0) {
      results.push(f);
      ha += f.size_ha;
      for (const name in FACETS) bump(name, f);
    } else if (fails === 1 && facetOf[failed] in FACETS) {
      // Size bounds and size classes share a facet; so do day bounds and duration buckets. Those count
      // only when the fire also passes the other half, so the facet still reflects the bounds.
      const sib = { cls: 'size', size: 'cls', dur: 'days', days: 'dur' }[failed];
      if (!sib || !dims.some(([d]) => d === sib)) bump(facetOf[failed], f);
    }
  }
  if (q.near) for (const f of results) f._km = haversineKm(q.near.lat, q.near.lon, f.latitude, f.longitude);
  sortResults(results, q.sort === 'km' && !q.near ? 'size' : q.sort, q.dir);
  return { results, count: results.length, ha, facets, query: q };
}

export function sortResults(list, sort = 'size', dir = SORT_DEFAULT_DIR[sort]) {
  const k = dir === 'asc' ? 1 : -1;
  const by = {
    size: (a, b) => a.size_ha - b.size_ha,
    date: (a, b) => (a.ignition_date < b.ignition_date ? -1 : a.ignition_date > b.ignition_date ? 1 : 0),
    days: (a, b) => (a.days ?? -1) - (b.days ?? -1),
    name: (a, b) => a.label.localeCompare(b.label),
    km: (a, b) => (a._km ?? 0) - (b._km ?? 0),
  }[sort] ?? (() => 0);
  return list.sort((a, b) => k * by(a, b) || b.size_ha - a.size_ha);
}

// ---------------------------------------------------------------- normalizing and merging

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Fills defaults and drops anything malformed (queries arrive from URLs and the network). */
export function normalizeQuery(q = {}) {
  const e = emptyQuery();
  const out = { ...e };
  out.text = typeof q.text === 'string' ? q.text.slice(0, 200) : '';
  out.from = num(q.from); out.to = num(q.to);
  if (out.from != null && out.to != null && out.from > out.to) [out.from, out.to] = [out.to, out.from];
  out.months = [...new Set((q.months ?? []).map(Number).filter((m) => Number.isInteger(m) && m >= 0 && m < 12))].sort((a, b) => a - b);
  out.causes = [...new Set((q.causes ?? []).filter((c) => CAUSES.includes(c)))];
  out.classes = [...new Set((q.classes ?? []).filter((c) => SIZE_CLASSES.some((s) => s.id === c)))].sort();
  out.sizeMin = num(q.sizeMin); out.sizeMax = num(q.sizeMax);
  out.durs = [...new Set((q.durs ?? []).filter((d) => DURATIONS.some((b) => b.id === d)))];
  out.durMin = num(q.durMin); out.durMax = num(q.durMax);
  const n = q.near;
  out.near = n && [n.lat, n.lon, n.km].every((v) => Number.isFinite(Number(v))) && Number(n.km) > 0
    ? { lat: Number(n.lat), lon: Number(n.lon), km: Math.min(1000, Number(n.km)), label: String(n.label ?? '').slice(0, 80) || null }
    : null;
  out.bbox = Array.isArray(q.bbox) && q.bbox.length === 4 && q.bbox.every((v) => Number.isFinite(Number(v))) ? q.bbox.map(Number) : null;
  out.named = Boolean(q.named);
  out.spread = Boolean(q.spread);
  out.zones = [...new Set((q.zones ?? []).filter((z) => typeof z === 'string' && z.length < 40))];
  out.sort = Object.hasOwn(SORTS, q.sort ?? "") ? q.sort : e.sort;
  out.dir = q.dir === 'asc' || q.dir === 'desc' ? q.dir : SORT_DEFAULT_DIR[out.sort];
  return out;
}

/** The controls' query with whatever the search box understood laid over it. */
export function mergeQuery(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === false || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  if (patch.near && !patch.near.km) out.near = { ...patch.near, km: base.near?.km ?? DEFAULT_RADIUS_KM };
  if (patch.radius) out.near = out.near ? { ...out.near, km: patch.radius } : null;
  delete out.radius;
  return out;
}

export function isEmptyQuery(q) {
  const n = normalizeQuery(q), e = emptyQuery();
  return Object.keys(e).every((k) => k === 'sort' || k === 'dir' || JSON.stringify(n[k]) === JSON.stringify(e[k]));
}

// ---------------------------------------------------------------- the search box

const dict = (o) => Object.assign(Object.create(null), o); // no inherited keys: 'constructor' is not a month
const MONTH_WORDS = dict(Object.fromEntries(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  .flatMap((m, i) => [[m, i], [m.slice(0, 3), i], ...(m.length > 4 ? [[m.slice(0, 4), i]] : [])])));
delete MONTH_WORDS.marc; delete MONTH_WORDS.octo; MONTH_WORDS.sept = 8;
const SEASONS = dict({ spring: [2, 3, 4], summer: [5, 6, 7], fall: [8, 9, 10], autumn: [8, 9, 10], winter: [11, 0, 1] });
const CAUSE_WORDS = dict({ lightning: 'Lightning', natural: 'Lightning', human: 'Human', people: 'Human', person: 'Human', 'man-made': 'Human', unknown: 'Unknown' });
const STOP = new Set(['fire', 'fires', 'wildfire', 'wildfires', 'in', 'of', 'the', 'and', 'from', 'during', 'caused', 'by', 'with', 'that', 'were', 'was', 'a', 'an', 'all', 'show', 'me', 'find', 'list', 'to', 'than', 'between', 'burned', 'burning', 'for', 'which', 'started', 'on', 'at']);
const OPS = dict({ over: '>', above: '>', exceeding: '>', more: '>', larger: '>', bigger: '>', longer: '>', greater: '>', under: '<', below: '<', less: '<', smaller: '<', shorter: '<', fewer: '<' });
const SORT_WORDS = dict({ largest: ['size', 'desc'], biggest: ['size', 'desc'], smallest: ['size', 'asc'], newest: ['date', 'desc'], latest: ['date', 'desc'], recent: ['date', 'desc'], oldest: ['date', 'asc'], earliest: ['date', 'asc'], longest: ['days', 'desc'], nearest: ['km', 'asc'], closest: ['km', 'asc'] });
const UNITS = dict({ ha: 'ha', hectare: 'ha', hectares: 'ha', km2: 'km2', 'km²': 'km2', sqkm: 'km2', d: 'days', day: 'days', days: 'days', wk: 'weeks', week: 'weeks', weeks: 'weeks', mo: 'months', month: 'months', months: 'months', km: 'km' });

/** "1.5k" → 1500 */
const parseNumber = (s) => {
  const m = String(s).match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  return m ? Number(m[1]) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1) : null;
};
const isYear = (n) => Number.isInteger(n) && n >= 1900 && n <= 2100;

/**
 * Reads a plain-language search into a query patch. Whatever it doesn't recognize stays as name text.
 *   lightning fires near "La Ronge" within 30 km, june–august 2015–2019, over 1,000 ha, burned > 2 weeks
 *   1990s human class:d,e   megafires named   sort:date   "shoe"   -creek
 * `communities` ([{ name, latitude, longitude }]) lets "near La Ronge" resolve to a point.
 */
export function parseText(input, { communities = [] } = {}) {
  const patch = { months: [], causes: [], classes: [], durs: [], zones: [] };
  const rest = [];
  const understood = [];
  // Tokens: key:value, key:"quoted value", "quoted phrase", or a word ("2,000" loses its comma first)
  const toks = [...String(input ?? '').replace(/(\d),(?=\d{3}\b)/g, '$1').matchAll(/([a-z]+):(?:"([^"]*)"?|([^\s;]*))|"([^"]*)"?|[^\s,;]+/gi)]
    .map((m) => ({ raw: m[0], key: m[1]?.toLowerCase() ?? null, quoted: m[2] != null || m[4] != null, val: m[2] ?? m[3] ?? m[4] ?? m[0] }));
  const word = (val) => ({ raw: val, key: null, quoted: false, val });
  const years = [];
  const setRange = (kind, op, v) => {
    const [lo, hi] = kind === 'ha' ? ['sizeMin', 'sizeMax'] : ['durMin', 'durMax'];
    if (op[0] === '>') patch[lo] = op === '>' && kind === 'days' ? v + 1 : v;
    else patch[hi] = op === '<' && kind === 'days' ? Math.max(0, v - 1) : v;
  };
  const measure = (n, unit) => {
    const u = UNITS[unit?.toLowerCase()];
    if (n == null || !u) return null;
    if (u === 'km2') return { kind: 'ha', v: n * 100 };
    if (u === 'weeks') return { kind: 'days', v: n * 7 };
    if (u === 'months') return { kind: 'days', v: n * 30 };
    return { kind: u, v: n };
  };
  // A number with an optional unit, glued ("1000ha", "2wk") or as the next token ("1000 ha")
  const readMeasure = (i) => {
    const t = toks[i]?.val.toLowerCase();
    if (!t) return null;
    const m = t.match(/^(\d+(?:\.\d+)?[km]?)([a-z²]+)?$/);
    if (!m) return null;
    const n = parseNumber(m[1]);
    if (m[2]) { const x = measure(n, m[2]); return x && { ...x, n, used: 1 }; }
    const next = toks[i + 1]?.val.toLowerCase();
    if (UNITS[next]) return { ...measure(n, next), n, used: 2 };
    return { kind: null, v: n, n, used: 1 };
  };
  // A place: "55.1,-105.3" (either order) or a community name (exact, or a unique-enough prefix)
  const place = (str, prefixOk) => {
    const coord = str.match(/^(-?\d+(?:\.\d+)?)\s*[,/ ]\s*(-?\d+(?:\.\d+)?)$/);
    if (coord) {
      let lat = Number(coord[1]), lon = Number(coord[2]);
      if (Math.abs(lat) > 90) [lat, lon] = [lon, lat];
      return { lat, lon, label: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°` };
    }
    const s = str.toLowerCase();
    const c = communities.find((x) => x.name?.toLowerCase() === s)
      ?? (prefixOk && s.length >= 4 ? communities.find((x) => x.name?.toLowerCase().startsWith(s)) : null);
    return c ? { lat: c.latitude, lon: c.longitude, label: c.name } : null;
  };
  // "near La Ronge": the longest run of following words (up to four) that names a place
  const near = (i) => {
    for (let len = Math.min(4, toks.length - i); len >= 1; len--) {
      const p = place(toks.slice(i, i + len).map((t) => t.val).join(len === 2 && /\d$/.test(toks[i].val) ? ',' : ' '), len === 1);
      if (p) { patch.near = p; return len; }
    }
    if (toks[i]) understood.push({ note: communities.length ? `No community called “${toks[i].val}” in the SPSA layer` : 'Community names need the live SPSA layer, which has not loaded' });
    return 0;
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    const t = tok.val.toLowerCase();
    const key = tok.key;
    if (key) {
      const vals = t.split(/[,|]/).filter(Boolean);
      if (key === 'near') {
        const p = place(tok.val, true);
        if (p) patch.near = p; else understood.push({ note: communities.length ? `No community called “${tok.val}” in the SPSA layer` : 'Community names need the live SPSA layer, which has not loaded' });
        continue;
      }
      if (key === 'class') { patch.classes.push(...vals.map((v) => v.toUpperCase()).filter((v) => /^[A-E]$/.test(v))); continue; }
      if (key === 'cause') { patch.causes.push(...vals.map((v) => CAUSE_WORDS[v]).filter(Boolean)); continue; }
      if (key === 'zone') { patch.zones.push(...tok.val.split(',').map((z) => (/^none$/i.test(z) ? 'None' : z.replace(/^\w/, (c) => (z.length > 3 ? c.toUpperCase() : c)).replace(/^ext$/i, 'EXT')))); continue; }
      if (key === 'sort') { const [s, d] = t.startsWith('-') ? [t.slice(1), 'desc'] : [t, null]; const map = dict({ size: 'size', date: 'date', year: 'date', duration: 'days', days: 'days', name: 'name', distance: 'km', km: 'km' }); if (map[s]) { patch.sort = map[s]; patch.dir = d ?? SORT_DEFAULT_DIR[map[s]]; } continue; }
      if (key === 'has') { if (/^name/.test(t)) patch.named = true; if (/^(spread|replay|perimeter)/.test(t)) patch.spread = true; continue; }
      if (key === 'name' || key === 'id') { rest.push(tok.quoted || /\s/.test(tok.val) ? `"${tok.val}"` : tok.val); continue; }
      // These are re-read as plain words: year:2015, month:jun-aug, size:>500, days:>30
      if (key === 'year' || key === 'years') { toks.splice(i + 1, 0, word(t)); continue; }
      if (key === 'month' || key === 'months') { toks.splice(i + 1, 0, ...vals.map(word)); continue; }
      if (key === 'radius' || key === 'within') { const r = parseFloat(t); if (r > 0) patch.radius = r; continue; }
      if ((key === 'size' || key === 'days') && t) {
        const m = t.match(/^([<>]=?)?(\d.*?)([a-z²]*)$/);
        if (m) toks.splice(i + 1, 0, word(`${m[1] ?? '>='}${m[2]}${m[3] || (key === 'size' ? 'ha' : 'd')}`));
        continue;
      }
      if (key === 'http' || key === 'https') { rest.push(tok.raw); continue; }
    }
    if (tok.quoted) { rest.push(`"${tok.val}"`); continue; }
    // "at" is a stopword, except in "at least" / "at most" (handled with the comparisons below)
    if (STOP.has(t) && !(t === 'at' && /^(least|most)$/i.test(toks[i + 1]?.val ?? ''))) continue;

    // near / around <community or coordinates>
    if (t === 'near' || t === 'around' || t === 'close') {
      if (toks[i + 1]?.val.toLowerCase() === 'to') i++;
      const used = near(i + 1);
      i += used;
      continue;
    }
    // within 30 km
    if (t === 'within' || t === 'radius') {
      const m = readMeasure(i + 1);
      if (m?.kind === 'km' || (m && m.kind == null)) { patch.radius = m.v; i += m.used; }
      continue;
    }
    // Comparisons: "over 1000 ha", "more than 2 weeks", "at least 50 ha", "before 2000", "since 2015"
    if (t in OPS || t === 'at' || ['before', 'after', 'since', 'until'].includes(t)) {
      let op = OPS[t], j = i + 1;
      if (t === 'at') { const w = toks[j]?.val.toLowerCase(); if (w === 'least') op = '>='; else if (w === 'most') op = '<='; else continue; j++; }
      if (toks[j]?.val.toLowerCase() === 'than') j++;
      const m = readMeasure(j);
      if (!m) continue;
      if (['before', 'after', 'since', 'until'].includes(t) && isYear(m.v)) {
        if (t === 'before') patch.to = m.v - 1; else if (t === 'until') patch.to = m.v;
        else patch.from = t === 'after' ? m.v + 1 : m.v;
      } else if (op) {
        if (m.kind == null && /^(longer|shorter)$/.test(t)) setRange('days', op, m.v); // "longer than 20" means days
        else if (m.kind === 'ha' || m.kind == null) setRange('ha', op, m.v);
        else if (m.kind === 'days') setRange('days', op, m.v);
      } else continue;
      i = j + m.used - 1;
      continue;
    }
    // >1000ha, >=30d, <5 ha
    let m = t.match(/^([<>]=?)(\d+(?:\.\d+)?[km]?)([a-z²]*)$/);
    if (m) {
      let unit = m[3];
      if (!unit && UNITS[toks[i + 1]?.val.toLowerCase()]) { unit = toks[i + 1].val.toLowerCase(); i++; }
      const x = measure(parseNumber(m[2]), unit || 'ha');
      if (x && x.kind !== 'km') setRange(x.kind, m[1], x.v);
      else if (x?.kind === 'km') patch.radius = x.v;
      continue;
    }
    // 1000-5000ha, 2-7 days
    m = t.match(/^(\d+(?:\.\d+)?[km]?)[-–](\d+(?:\.\d+)?[km]?)([a-z²]+)$/);
    if (m && UNITS[m[3]]) {
      const a = measure(parseNumber(m[1]), m[3]), b = measure(parseNumber(m[2]), m[3]);
      if (a.kind === 'ha') { patch.sizeMin = a.v; patch.sizeMax = b.v; } else if (a.kind === 'days') { patch.durMin = a.v; patch.durMax = b.v; }
      continue;
    }
    // Years: 2015, 2010-2015, 2010..2015, 1990s, 2015+
    m = t.match(/^(\d{4})(?:[-–]|\.\.)(\d{4})$/);
    if (m && isYear(+m[1]) && isYear(+m[2])) { years.push(+m[1], +m[2]); continue; }
    m = t.match(/^(\d{3})0'?s$/);
    if (m && isYear(+m[1] * 10)) { years.push(+m[1] * 10, +m[1] * 10 + 9); continue; }
    m = t.match(/^(\d{4})\+$/);
    if (m && isYear(+m[1])) { patch.from = +m[1]; continue; }
    if (/^\d{4}$/.test(t) && isYear(+t)) {
      // "1000 ha" is a size, not a year
      if (UNITS[toks[i + 1]?.val.toLowerCase()]) { const x = measure(+t, toks[i + 1].val); if (x.kind === 'ha') patch.sizeMin = x.v; if (x.kind === 'km') patch.radius = x.v; i++; continue; }
      years.push(+t);
      continue;
    }
    // 30km on its own sets the radius; "50 km" too
    m = t.match(/^(\d+(?:\.\d+)?)km$/);
    if (m) { patch.radius = Number(m[1]); continue; }
    if (/^\d+(\.\d+)?k?$/.test(t) && UNITS[toks[i + 1]?.val.toLowerCase()]) {
      const x = measure(parseNumber(t), toks[i + 1].val);
      if (x.kind === 'km') patch.radius = x.v; else if (x.kind === 'ha') patch.sizeMin = x.v; else if (x.kind === 'days') patch.durMin = x.v;
      i++;
      continue;
    }
    // Months and seasons: july, jun-aug, summer
    m = t.match(/^([a-z]+)[-–]([a-z]+)$/);
    if (m && m[1] in MONTH_WORDS && m[2] in MONTH_WORDS) {
      for (let k = MONTH_WORDS[m[1]]; ; k = (k + 1) % 12) { patch.months.push(k); if (k === MONTH_WORDS[m[2]]) break; }
      continue;
    }
    if (t in MONTH_WORDS) {
      // "june to august", "june through august"
      const link = toks[i + 1]?.val.toLowerCase(), end = toks[i + 2]?.val.toLowerCase();
      if (['to', 'through', 'thru', 'until'].includes(link) && end in MONTH_WORDS) {
        for (let k = MONTH_WORDS[t]; ; k = (k + 1) % 12) { patch.months.push(k); if (k === MONTH_WORDS[end]) break; }
        i += 2;
      } else patch.months.push(MONTH_WORDS[t]);
      continue;
    }
    if (t in SEASONS) { patch.months.push(...SEASONS[t]); continue; }
    // Causes
    const cause = CAUSE_WORDS[t] ?? CAUSE_WORDS[t.replace(/-caused$/, '')];
    if (cause) { patch.causes.push(cause); continue; }
    // Size words and other flags
    if (t === 'large' || t === 'big') { patch.classes.push('E'); continue; }
    if (t === 'small' || t === 'tiny') { patch.classes.push('A', 'B'); continue; }
    if (t === 'megafire' || t === 'megafires' || t === 'mega') { patch.sizeMin = 10000; continue; }
    if (t === 'named') { patch.named = true; continue; }
    if (t === 'replay' || t === 'replayable' || t === 'spread') { patch.spread = true; continue; }
    if (t in SORT_WORDS) { [patch.sort, patch.dir] = SORT_WORDS[t]; continue; }
    rest.push(tok.raw);
  }
  if (years.length) { patch.from = Math.min(...years); patch.to = Math.max(...years); }
  patch.months = [...new Set(patch.months)];
  patch.causes = [...new Set(patch.causes)];
  patch.classes = [...new Set(patch.classes)];
  return { patch, text: rest.join(' '), notes: understood.map((u) => u.note) };
}

// ---------------------------------------------------------------- words

const monthRange = (ms) => {
  if (!ms.length) return '';
  const s = [...ms].sort((a, b) => a - b);
  const runs = [];
  for (const m of s) { const r = runs[runs.length - 1]; if (r && m === r[1] + 1) r[1] = m; else runs.push([m, m]); }
  return runs.map(([a, b]) => (a === b ? MONTHS[a] : `${MONTHS[a]}–${MONTHS[b]}`)).join(', ');
};
const bound = (a, b, unit, fmt = fmtInt) => (a != null && b != null ? `${fmt(a)}–${fmt(b)} ${unit}` : a != null ? `≥ ${fmt(a)} ${unit}` : `≤ ${fmt(b)} ${unit}`);

/** The query as short labelled parts, for chips: [{ key, text }]. Removing `key` clears that part. */
export function describe(query) {
  const q = normalizeQuery(query);
  const parts = [];
  if (q.text) parts.push({ key: 'text', text: `name “${q.text.replace(/"/g, '')}”` });
  if (q.causes.length) parts.push({ key: 'causes', text: q.causes.join(' or ') });
  if (q.from != null || q.to != null) parts.push({ key: 'years', text: q.from === q.to ? `${q.from}` : q.from == null ? `until ${q.to}` : q.to == null ? `since ${q.from}` : `${q.from}–${q.to}` });
  if (q.months.length) parts.push({ key: 'months', text: monthRange(q.months) });
  if (q.classes.length) parts.push({ key: 'classes', text: `class ${q.classes.join(', ')}` });
  if (q.sizeMin != null || q.sizeMax != null) parts.push({ key: 'size', text: bound(q.sizeMin, q.sizeMax, 'ha', (n) => (n < 10 ? String(n) : fmtInt(n))) });
  if (q.durs.length) parts.push({ key: 'durs', text: q.durs.map((d) => DURATIONS.find((b) => b.id === d).label.toLowerCase()).join(' or ') });
  if (q.durMin != null || q.durMax != null) parts.push({ key: 'days', text: `burned ${bound(q.durMin, q.durMax, 'days')}` });
  if (q.near) parts.push({ key: 'near', text: `within ${fmtInt(q.near.km)} km of ${q.near.label ?? 'a point'}` });
  if (q.bbox) parts.push({ key: 'bbox', text: 'in the drawn area' });
  if (q.named) parts.push({ key: 'named', text: 'named fires' });
  if (q.spread) parts.push({ key: 'spread', text: 'with a true spread replay' });
  if (q.zones.length) parts.push({ key: 'zones', text: `zone ${q.zones.join(', ')}` });
  return parts;
}

/** Clears one part named by describe(). */
export function withoutPart(query, key) {
  const q = { ...normalizeQuery(query) };
  const e = emptyQuery();
  const fields = { years: ['from', 'to'], size: ['sizeMin', 'sizeMax'], days: ['durMin', 'durMax'] }[key] ?? [key];
  for (const f of fields) q[f] = e[f];
  return q;
}

// ---------------------------------------------------------------- URLs

/** Query → URLSearchParams (only what differs from empty, so links stay short). */
export function toParams(query) {
  const q = normalizeQuery(query);
  const p = new URLSearchParams();
  if (q.text) p.set('q', q.text);
  if (q.from != null) p.set('from', q.from);
  if (q.to != null) p.set('to', q.to);
  if (q.months.length) p.set('m', q.months.map((m) => m + 1).join(','));
  if (q.causes.length) p.set('cause', q.causes.join(','));
  if (q.classes.length) p.set('class', q.classes.join(','));
  if (q.sizeMin != null) p.set('min', q.sizeMin);
  if (q.sizeMax != null) p.set('max', q.sizeMax);
  if (q.durs.length) p.set('dur', q.durs.join(','));
  if (q.durMin != null) p.set('dmin', q.durMin);
  if (q.durMax != null) p.set('dmax', q.durMax);
  if (q.near) { p.set('near', [q.near.lat, q.near.lon, q.near.km].map((v) => +v.toFixed(4)).join(',')); if (q.near.label) p.set('nearName', q.near.label); }
  if (q.bbox) p.set('bbox', q.bbox.map((v) => +v.toFixed(4)).join(','));
  if (q.named) p.set('named', '1');
  if (q.spread) p.set('spread', '1');
  if (q.zones.length) p.set('zone', q.zones.join(','));
  if (q.sort !== 'size' || q.dir !== 'desc') { p.set('sort', q.sort); p.set('dir', q.dir); }
  return p;
}

export function fromParams(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const list = (k) => (p.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const near = list('near').map(Number);
  return normalizeQuery({
    text: p.get('q') ?? '', from: p.get('from'), to: p.get('to'),
    months: list('m').map((m) => Number(m) - 1), causes: list('cause'), classes: list('class').map((c) => c.toUpperCase()),
    sizeMin: p.get('min'), sizeMax: p.get('max'), durs: list('dur'), durMin: p.get('dmin'), durMax: p.get('dmax'),
    near: near.length === 3 ? { lat: near[0], lon: near[1], km: near[2], label: p.get('nearName') } : null,
    bbox: list('bbox').length === 4 ? list('bbox').map(Number) : null,
    named: p.get('named') === '1', spread: p.get('spread') === '1', zones: list('zone'),
    sort: p.get('sort'), dir: p.get('dir'),
  });
}

// ---------------------------------------------------------------- exports

export const EXPORT_COLUMNS = ['fire_id', 'name', 'ignition_date', 'out_date', 'duration_days', 'size_ha', 'size_class', 'general_cause', 'latitude', 'longitude', 'protection_zone', 'distance_km'];
const row = (f) => ({
  fire_id: f.fire_id, name: f.label, ignition_date: f.ignition_date, out_date: f.out_date ?? null, duration_days: f.days ?? null,
  size_ha: f.size_ha, size_class: f.cls, general_cause: f.general_cause, latitude: f.latitude, longitude: f.longitude,
  protection_zone: f.protection_zone ?? null, distance_km: f._km != null ? Math.round(f._km * 10) / 10 : null,
});
// Text starting with = + - @ (or tab/CR) runs as a formula in spreadsheet apps ("CSV injection"), so it
// gets a leading apostrophe. Numbers are left alone: a longitude of -105.3 stays a number.
const csvCell = (v) => {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(list, { near = true } = {}) {
  const cols = near ? EXPORT_COLUMNS : EXPORT_COLUMNS.filter((c) => c !== 'distance_km');
  return [cols.join(','), ...list.map((f) => { const r = row(f); return cols.map((c) => csvCell(r[c])).join(','); })].join('\r\n') + '\r\n';
}

export function toGeoJSON(list, meta = {}) {
  return {
    type: 'FeatureCollection',
    ...meta,
    features: list.map((f) => {
      const { latitude, longitude, ...props } = row(f);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties: props };
    }),
  };
}

/** Results as JSON rows (the shape /api/search returns). */
export const toRows = (list) => list.map(row);
