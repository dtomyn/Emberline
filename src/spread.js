/**
 * spread.js: geometry and fire-growth algorithms for True Spread Replay.
 *
 * Pure functions with no DOM or Node dependencies. The loader (scripts/load-spread.mjs) uses them
 * to pre-compute each fire, and the browser uses them to draw it.
 *
 * Method, in brief. A fire's final NBAC perimeter is rasterized onto a grid. Every satellite
 * hotspot inside it seeds the cell it fell in with its detection time. A Dijkstra sweep then
 * spreads those times across the burned cells at a nominal rate, so each cell gets an
 * *arrival time*: the earliest time a detection, or the front growing out from one, reached it.
 * This is the standard "day of burning" interpolation (e.g. Parks 2014), constrained to the
 * real burned area. The front at time t is the isoline arrival = t.
 */

const R = 6371.0088; // km
const RAD = Math.PI / 180;

// ---------------------------------------------------------------- projection
// NBAC shapefiles use Canada Lambert Conformal Conic (NAD83 / GRS80, standard parallels 49° and 77°,
// origin 49°N 95°W). Formulas from Snyder, "Map Projections: A Working Manual" (1987), pp. 107–109.
const GRS80 = { a: 6378137, f: 1 / 298.257222101 };
export const CANADA_LCC = { lat1: 49, lat2: 77, lat0: 49, lon0: -95, x0: 0, y0: 0 };

function lccConstants({ lat1, lat2, lat0 }, { a, f } = GRS80) {
  const e = Math.sqrt(2 * f - f * f);
  const m = (p) => Math.cos(p) / Math.sqrt(1 - (e * Math.sin(p)) ** 2);
  const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const [p1, p2, p0] = [lat1 * RAD, lat2 * RAD, lat0 * RAD];
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * t(p1) ** n);
  return { a, e, n, F, rho0: a * F * t(p0) ** n, t };
}

/** [lon, lat] in degrees → [x, y] metres in the given LCC projection. */
export function lccForward(lon, lat, proj = CANADA_LCC) {
  const k = lccConstants(proj);
  const rho = k.a * k.F * k.t(lat * RAD) ** k.n;
  const th = k.n * (lon - proj.lon0) * RAD;
  return [proj.x0 + rho * Math.sin(th), proj.y0 + k.rho0 - rho * Math.cos(th)];
}

/** Returns a fast inverse function (x, y) → [lon, lat] for the given LCC projection. */
export function lccInverse(proj = CANADA_LCC) {
  const k = lccConstants(proj);
  const sign = Math.sign(k.n);
  return (x, y) => {
    const dx = x - proj.x0, dy = k.rho0 - (y - proj.y0);
    const rho = sign * Math.hypot(dx, dy);
    const th = Math.atan2(sign * dx, sign * dy);
    const t = (rho / (k.a * k.F)) ** (1 / k.n);
    let phi = Math.PI / 2 - 2 * Math.atan(t);
    for (let i = 0; i < 8; i++) {
      const es = k.e * Math.sin(phi);
      const next = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (k.e / 2));
      if (Math.abs(next - phi) < 1e-12) { phi = next; break; }
      phi = next;
    }
    return [th / k.n / RAD + proj.lon0, phi / RAD];
  };
}

// ---------------------------------------------------------------- rings
/** Signed area of a [lon, lat] ring in hectares (approximate, equirectangular at the ring's latitude). */
export function ringAreaHa(ring) {
  if (ring.length < 3) return 0;
  const kx = Math.cos(ring[0][1] * RAD) * R * RAD, ky = R * RAD;
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
  return (s / 2) * 100; // km² → ha
}

/** Douglas–Peucker simplification with a tolerance in metres. Iterative, so huge rings are safe. */
export function simplifyRing(ring, tolM) {
  const n = ring.length;
  if (n <= 4) return ring;
  const kx = Math.cos(ring[0][1] * RAD) * R * 1000 * RAD, ky = R * 1000 * RAD;
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = ring[i][0] * kx; Y[i] = ring[i][1] * ky; }
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tolM * tolM;
  while (stack.length) {
    const [a, b] = stack.pop();
    const dx = X[b] - X[a], dy = Y[b] - Y[a];
    const len2 = dx * dx + dy * dy;
    let best = -1, bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      let px = X[i] - X[a], py = Y[i] - Y[a];
      if (len2 > 0) {
        const u = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        px -= u * dx; py -= u * dy;
      }
      const d = px * px + py * py;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  return out;
}

/** Flatten (Multi)Polygon coordinates into a list of rings. Holes are kept; fills use even-odd. */
export function geometryRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

/**
 * Simplify and tidy a fire's rings: drop slivers and islands smaller than minHa,
 * round coordinates to ~1 m. Returns { rings, bbox: [minLon, minLat, maxLon, maxLat] }.
 */
export function prepareRings(rings, { tolM = 120, minHa = 15 } = {}) {
  const out = [];
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    if (ring.length < 4 || Math.abs(ringAreaHa(ring)) < minHa) continue;
    const s = simplifyRing(ring, tolM).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
    if (s.length < 4) continue;
    for (const [x, y] of s) {
      if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y;
      if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
    }
    out.push(s);
  }
  return { rings: out, bbox };
}

/** Even-odd point-in-polygon over all rings. */
export function pointInRings(lon, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Distance in km from a point to the nearest ring edge. */
export function distanceToRingsKm(lon, lat, rings) {
  const kx = Math.cos(lat * RAD) * R * RAD, ky = R * RAD;
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1][0] - lon) * kx, ay = (ring[i - 1][1] - lat) * ky;
      const bx = (ring[i][0] - lon) * kx, by = (ring[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const u = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const d = Math.hypot(ax + u * dx, ay + u * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- grid
/**
 * Lay a grid over a bbox with roughly square cells of at least minCellKm, at most maxCells per side.
 * Rows run north to south (row 0 is the top), matching image orientation.
 */
export function makeGrid(bbox, { maxCells = 256, minCellKm = 0.2, padKm = 1.5 } = {}) {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const kx = Math.cos(midLat * RAD) * R * RAD, ky = R * RAD;
  const padX = padKm / kx, padY = padKm / ky;
  const b = [bbox[0] - padX, bbox[1] - padY, bbox[2] + padX, bbox[3] + padY];
  const wKm = (b[2] - b[0]) * kx, hKm = (b[3] - b[1]) * ky;
  const cellKm = Math.max(minCellKm, Math.max(wKm, hKm) / maxCells);
  const w = Math.max(2, Math.ceil(wKm / cellKm)), h = Math.max(2, Math.ceil(hKm / cellKm));
  return { w, h, cellKm, bbox: [b[0], b[3] - h * cellKm / ky, b[0] + w * cellKm / kx, b[3]] };
}

export const cellLon = (g, c) => g.bbox[0] + ((c + 0.5) / g.w) * (g.bbox[2] - g.bbox[0]);
export const cellLat = (g, r) => g.bbox[3] - ((r + 0.5) / g.h) * (g.bbox[3] - g.bbox[1]);
export const lonToCol = (g, lon) => Math.floor(((lon - g.bbox[0]) / (g.bbox[2] - g.bbox[0])) * g.w);
export const latToRow = (g, lat) => Math.floor(((g.bbox[3] - lat) / (g.bbox[3] - g.bbox[1])) * g.h);

/** Scanline-fill rings onto the grid (even-odd). Returns a Uint8Array mask, 1 = burned. */
export function rasterize(rings, g) {
  const mask = new Uint8Array(g.w * g.h);
  const xs = [];
  for (let r = 0; r < g.h; r++) {
    const lat = cellLat(g, r);
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat)) xs.push(xi + ((lat - yi) / (yj - yi)) * (xj - xi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(((xs[k] - g.bbox[0]) / (g.bbox[2] - g.bbox[0])) * g.w - 0.5));
      const c1 = Math.min(g.w - 1, Math.floor(((xs[k + 1] - g.bbox[0]) / (g.bbox[2] - g.bbox[0])) * g.w - 0.5));
      for (let c = c0; c <= c1; c++) mask[r * g.w + c] = 1;
    }
  }
  return mask;
}

// ---------------------------------------------------------------- arrival time
/** Minimal binary heap keyed by Float64 priority. */
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topV = v[0], topK = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    this.lastKey = topK;
    return topV;
  }
}

/**
 * Arrival time (days since the fire's base date) for every burned cell.
 *   seeds:   [{ lon, lat, t }] detections; each seeds the cell it falls in
 *   rateKmPerDay: nominal spread rate used to fill between detections
 * Cells outside the burn mask can carry the sweep (fires do jump unburned islands) but cost
 * `outsideCost` times more, and are reported as Infinity.
 */
export function arrivalField(mask, g, seeds, { rateKmPerDay = 2, outsideCost = 4 } = {}) {
  const n = g.w * g.h;
  const arr = new Float64Array(n).fill(Infinity);
  const heap = new Heap();
  for (const s of seeds) {
    const c = lonToCol(g, s.lon), r = latToRow(g, s.lat);
    if (c < 0 || r < 0 || c >= g.w || r >= g.h) continue;
    const i = r * g.w + c;
    if (s.t < arr[i]) { arr[i] = s.t; heap.push(s.t, i); }
  }
  const step = g.cellKm / rateKmPerDay;
  const NB = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]];
  while (heap.size) {
    const i = heap.pop();
    const t = heap.lastKey;
    if (t > arr[i]) continue;
    const r = (i / g.w) | 0, c = i - r * g.w;
    for (const [dc, dr, d] of NB) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= g.w || rr >= g.h) continue;
      const j = rr * g.w + cc;
      const cost = step * d * (mask[j] && mask[i] ? 1 : outsideCost);
      if (t + cost < arr[j]) { arr[j] = t + cost; heap.push(t + cost, j); }
    }
  }
  for (let i = 0; i < n; i++) if (!mask[i]) arr[i] = Infinity;
  return arr;
}

/** Pack arrival days into Uint16 hours (0xFFFF = never burns). */
export function packArrival(arr) {
  const out = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Number.isFinite(arr[i]) ? Math.min(0xFFFE, Math.max(0, Math.round(arr[i] * 24))) : 0xFFFF;
  return out;
}
export function unpackArrival(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) out[i] = u16[i] === 0xFFFF ? Infinity : u16[i] / 24;
  return out;
}

// ---------------------------------------------------------------- daily growth and merges
/** Connected components (8-neighbour) of cells with arr < t. Returns { labels: Int32Array, sizes: number[] }. */
export function components(arr, g, t) {
  const labels = new Int32Array(arr.length).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < arr.length; i++) {
    if (labels[i] !== -1 || !(arr[i] < t)) continue;
    const id = sizes.length;
    let size = 0;
    labels[i] = id; stack.push(i);
    while (stack.length) {
      const k = stack.pop();
      size++;
      const r = (k / g.w) | 0, c = k - r * g.w;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if ((dr || dc) && rr >= 0 && cc >= 0 && rr < g.h && cc < g.w) {
          const j = rr * g.w + cc;
          if (labels[j] === -1 && arr[j] < t) { labels[j] = id; stack.push(j); }
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** [col, row, col, row, …] of a component's boundary cells, thinned to at most ~1500 cells. */
function edgeCells(labels, g, id) {
  const all = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== id) continue;
    const r = (i / g.w) | 0, c = i - r * g.w;
    if (c === 0 || r === 0 || c === g.w - 1 || r === g.h - 1 ||
        labels[i - 1] !== id || labels[i + 1] !== id || labels[i - g.w] !== id || labels[i + g.w] !== id) all.push(c, r);
  }
  const stride = Math.max(1, Math.ceil(all.length / 2 / 1500));
  if (stride === 1) return all;
  const out = [];
  for (let k = 0; k < all.length; k += 2 * stride) out.push(all[k], all[k + 1]);
  return out;
}

/**
 * Per-day growth from an arrival field.
 *   days[d] = { ha, bbox } burned by the end of day d (scaled so the last day equals areaHa)
 *   merges  = [{ day, lon, lat, ha }] moments when two separate burning areas, each at least
 *             minShare of the final area, joined into one
 */
export function dailyGrowth(arr, g, areaHa, { minShare = 0.03 } = {}) {
  let maxT = 0, total = 0;
  for (const v of arr) if (Number.isFinite(v)) { total++; if (v > maxT) maxT = v; }
  const nDays = Math.ceil(maxT + 1e-9) + 1;
  const haPerCell = total ? areaHa / total : 0;
  const minCells = Math.max(4, total * minShare);
  const days = [];
  const merges = [];
  let prev = null;
  for (let d = 0; d < nDays; d++) {
    const t = d + 1;
    let count = 0;
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < t) {
        count++;
        const r = (i / g.w) | 0, c = i - r * g.w;
        if (c < bb[0]) bb[0] = c; if (r < bb[1]) bb[1] = r; if (c > bb[2]) bb[2] = c; if (r > bb[3]) bb[3] = r;
      }
    }
    days.push({
      ha: Math.round(count * haPerCell),
      bbox: count ? [cellLon(g, bb[0]), cellLat(g, bb[3]), cellLon(g, bb[2]), cellLat(g, bb[1])].map((v) => Math.round(v * 1e4) / 1e4) : null,
    });
    const cur = components(arr, g, t);
    if (prev) {
      // A merge: one of today's components contains two or more of yesterday's big components
      const parents = new Map(); // today's label → Set(yesterday's big labels)
      for (let i = 0; i < arr.length; i++) {
        const p = prev.labels[i];
        if (p >= 0 && prev.sizes[p] >= minCells) {
          const c = cur.labels[i];
          if (!parents.has(c)) parents.set(c, new Set());
          parents.get(c).add(p);
        }
      }
      for (const [c, set] of parents) {
        if (set.size < 2) continue;
        // Where they met: midway between the closest edge cells of the two largest old components
        const [p1, p2] = [...set].sort((a, b) => prev.sizes[b] - prev.sizes[a]);
        const e1 = edgeCells(prev.labels, g, p1), e2 = edgeCells(prev.labels, g, p2);
        let best = Infinity, bx = 0, by = 0;
        for (let a = 0; a < e1.length; a += 2) {
          for (let b = 0; b < e2.length; b += 2) {
            const dd = (e1[a] - e2[b]) ** 2 + (e1[a + 1] - e2[b + 1]) ** 2;
            if (dd < best) { best = dd; bx = (e1[a] + e2[b]) / 2; by = (e1[a + 1] + e2[b + 1]) / 2; }
          }
        }
        merges.push({
          day: d,
          lon: Math.round(cellLon(g, bx) * 1e4) / 1e4,
          lat: Math.round(cellLat(g, by) * 1e4) / 1e4,
          ha: Math.round(cur.sizes[c] * haPerCell),
        });
      }
    }
    prev = cur;
  }
  return { days, merges };
}

// ---------------------------------------------------------------- front isoline
/**
 * Marching squares on the arrival field at time t. Only squares whose four corners all burn
 * eventually produce segments, so the line is the moving front, not the final perimeter.
 * Each segment carries the local spread rate in km/day, from the arrival-time gradient.
 * Returns a flat Float32Array: [lon0, lat0, lon1, lat1, rate, ...].
 */
export function frontSegments(arr, g, t, out = []) {
  out.length = 0;
  const { w, h } = g;
  const x0 = g.bbox[0], y0 = g.bbox[3];
  const dx = (g.bbox[2] - g.bbox[0]) / w, dy = (g.bbox[3] - g.bbox[1]) / h;
  const px = (c) => x0 + (c + 0.5) * dx, py = (r) => y0 - (r + 0.5) * dy;
  for (let r = 0; r < h - 1; r++) {
    for (let c = 0; c < w - 1; c++) {
      const i = r * w + c;
      const a = arr[i], b = arr[i + 1], cc = arr[i + w + 1], d = arr[i + w];
      if (!(a < Infinity && b < Infinity && cc < Infinity && d < Infinity)) continue;
      const fa = a - t, fb = b - t, fc = cc - t, fd = d - t;
      const code = (fa < 0 ? 8 : 0) | (fb < 0 ? 4 : 0) | (fc < 0 ? 2 : 0) | (fd < 0 ? 1 : 0);
      if (code === 0 || code === 15) continue;
      // Edge crossings: top (a→b), right (b→c), bottom (d→c), left (a→d)
      const top = () => [px(c + fa / (fa - fb)), py(r)];
      const right = () => [px(c + 1), py(r + fb / (fb - fc))];
      const bottom = () => [px(c + fd / (fd - fc)), py(r + 1)];
      const left = () => [px(c), py(r + fa / (fa - fd))];
      const gx = (b - a + cc - d) / 2, gy = (d - a + cc - b) / 2;
      const rate = g.cellKm / Math.max(1e-3, Math.hypot(gx, gy));
      const seg = (p, q) => out.push(p[0], p[1], q[0], q[1], rate);
      switch (code) {
        case 1: case 14: seg(left(), bottom()); break;
        case 2: case 13: seg(bottom(), right()); break;
        case 3: case 12: seg(left(), right()); break;
        case 4: case 11: seg(top(), right()); break;
        case 6: case 9: seg(top(), bottom()); break;
        case 7: case 8: seg(left(), top()); break;
        case 5: seg(left(), top()); seg(bottom(), right()); break;
        case 10: seg(top(), right()); seg(left(), bottom()); break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- hotspots
/** Parse a CWFIS WFS CSV response (FID,lat,lon,rep_date,...) into hotspot objects. */
export function parseHotspotCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length || !/lat/i.test(lines[0])) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const ix = (k) => head.indexOf(k);
  const [iLat, iLon, iDate, iSensor, iFrp, iWs, iWd] = ['lat', 'lon', 'rep_date', 'sensor', 'frp', 'ws', 'wd'].map(ix);
  if (iLat < 0 || iLon < 0 || iDate < 0) throw new Error('Hotspot CSV is missing lat/lon/rep_date');
  const num = (v) => (v === undefined || v === '' ? null : Number(v));
  const out = [];
  for (let k = 1; k < lines.length; k++) {
    const r = lines[k].split(',');
    const lat = Number(r[iLat]), lon = Number(r[iLon]);
    const date = r[iDate]?.trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !/^\d{4}-\d{2}-\d{2}/.test(date ?? '')) continue;
    out.push({
      lat, lon,
      time: date.replace(/Z?$/, 'Z').replace(/^(\d{4}-\d{2}-\d{2})Z$/, '$1T12:00:00Z'),
      sensor: iSensor >= 0 ? r[iSensor]?.trim() || null : null,
      frp: iFrp >= 0 ? num(r[iFrp]) : null,
      ws: iWs >= 0 ? num(r[iWs]) : null,
      wd: iWd >= 0 ? num(r[iWd]) : null,
    });
  }
  return out;
}

/** Days between two ISO date/datetime strings. */
export const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

/** base64 helpers that work in Node and browsers. */
export function u16ToBase64(u16) {
  const bytes = new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToU16(b64) {
  const bin = typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64') : Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const copy = new Uint8Array(bin.length);
  copy.set(bin);
  return new Uint16Array(copy.buffer);
}
