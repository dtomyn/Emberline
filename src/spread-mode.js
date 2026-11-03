// spread-mode.js: True Spread Replay. Shows one large fire growing day by day from real satellite
// detections, inside its real NBAC burned-area perimeter.
//
// Layers, bottom to top: charred scar → glowing burn field → moving front (coloured by spread rate)
// → hotspot flares → satellite "pings" (vertical beams) → embers drifting downwind → final perimeter.
// A director camera frames the burning area as it grows; fronts merging triggers a slow-motion beat.
import { CONFIG } from './config.js';
import { base64ToU16, unpackArrival, frontSegments, ringAreaHa } from './spread.js';
import { fmtHa, fmtInt, fmtDate } from './data.js';

const { ScatterplotLayer, LineLayer, PathLayer, BitmapLayer, TextLayer } = deck;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ADDITIVE = {
  blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
  depthWriteEnabled: false, depthCompare: 'always',
};
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' };
const DAY_MS = 86400000;

// Burn-field colour by age in days since the front arrived (negative = just ahead of the front)
const GLOW_STOPS = [[-0.3, 255, 120, 30, 0], [0, 255, 248, 225, 235], [0.3, 255, 205, 110, 200], [0.9, 255, 120, 35, 120], [2.2, 210, 50, 14, 55], [4.5, 120, 20, 8, 12], [7, 90, 16, 6, 0]];
// Front colour by spread rate (km/day)
const RATE_STOPS = [[0, 255, 70, 20], [1.5, 255, 140, 40], [4, 255, 205, 90], [8, 255, 248, 220]];
export const RATE_LEGEND = RATE_STOPS.map(([, r, g, b]) => `rgb(${r},${g},${b})`);

function ramp(stops, x) {
  if (x <= stops[0][0]) return stops[0].slice(1);
  for (let k = 1; k < stops.length; k++) {
    if (x <= stops[k][0]) {
      const a = stops[k - 1], b = stops[k], u = (x - a[0]) / (b[0] - a[0]);
      return a.slice(1).map((v, i) => v + (b[i + 1] - v) * u);
    }
  }
  return stops[stops.length - 1].slice(1);
}
// Pre-baked glow lookup: 1/48-day steps from -0.3 to 7 days
const GLOW_LUT = (() => {
  const n = Math.ceil(7.3 * 48) + 1, lut = new Uint8ClampedArray(n * 4);
  for (let k = 0; k < n; k++) lut.set(ramp(GLOW_STOPS, -0.3 + k / 48), k * 4);
  return lut;
})();

const firstAtLeast = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; };
const dateAt = (fire, t) => new Date(Date.parse(`${fire.base_date}T00:00:00Z`) + Math.max(0, t) * DAY_MS);
const fmtDay = (d, opts = {}) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC', ...opts });

export function createSpreadMode({ map, toast, displayName, onOpen }) {
  const S = {
    list: [], fire: null, t: 0, playing: false, speed: 2, director: true, flying: false, slow: 1,
    show: { hotspots: true, embers: true, ghost: true }, cam: null, lastMerge: -1, available: null,
  };
  const embers = [];
  let segs = [];
  let segT = NaN;

  // ---------------------------------------------------------------- data
  async function loadList() {
    if (CONFIG.staticDataUrl) { S.available = false; renderList(); return []; }
    try {
      const res = await fetch(`${CONFIG.apiBase}/spread`);
      S.list = res.ok ? await res.json() : [];
    } catch { S.list = []; }
    S.available = S.list.length > 0;
    renderList();
    if (S.active && !S.fire) openFirst();
    return S.list;
  }

  function openFirst() {
    const wanted = S.wanted ?? location.hash.match(/^#spread\/([\w-]+)/)?.[1];
    S.wanted = null;
    const first = S.list.find((f) => f.id === wanted) ?? S.list[0];
    if (first) open(first.id);
  }

  const nameOf = (f) => {
    const n = f.cnfdb_fire_id ? displayName({ fire_id: f.cnfdb_fire_id, fire_name: f.fire_name }) : null;
    return n && n !== f.cnfdb_fire_id ? n : `Fire ${f.id.split('-').pop()}, ${f.year}`;
  };
  const forCnfdb = (fireId) => S.list.find((f) => f.cnfdb_fire_id === fireId) ?? null;

  async function open(id, { autoplay = true } = {}) {
    const meta = S.list.find((f) => f.id === id);
    if (!meta) { toast('That fire has no spread replay loaded.'); return; }
    $('#spread-loading').classList.add('show');
    let raw;
    try {
      const res = await fetch(`${CONFIG.apiBase}/spread/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      toast(err.message);
      return;
    } finally {
      $('#spread-loading').classList.remove('show');
    }
    S.fire = prepare(raw);
    S.t = S.fire.tStart;
    S.lastMerge = -1;
    embers.length = 0;
    segT = NaN;
    setPlaying(false);
    renderList();
    renderPanel();
    drawTrack();
    titleCard();
    onOpen?.(S.fire);
    // Drop in from wherever we are to a low, tilted view over the first days of burning
    const b = S.fire.growth.days[Math.min(S.fire.growth.days.length - 1, Math.floor(S.fire.tStart) + 3)]?.bbox ?? S.fire.bbox;
    const cam = camFor(b);
    S.cam = { ...cam };
    S.flying = true;
    map.flyTo({ center: cam.center, zoom: cam.zoom, pitch: 58, bearing: -18, duration: 3600, curve: 1.7, essential: true });
    map.once('moveend', () => { S.flying = false; });
    if (autoplay) setTimeout(() => { if (S.fire?.id === id) setPlaying(true); }, 2600);
  }

  function prepare(raw) {
    const arr = unpackArrival(base64ToU16(raw.grid.arrival));
    let first = Infinity, last = 0;
    for (const v of arr) if (v < Infinity) { if (v < first) first = v; if (v > last) last = v; }
    const h = raw.hotspots;
    const n = h.t.length;
    const nDays = Math.ceil(last) + 4;
    const det = new Float32Array(nDays), frp = new Float32Array(nDays);
    const windX = new Float32Array(nDays), windY = new Float32Array(nDays);
    for (let i = 0; i < n; i++) {
      const d = Math.floor(h.t[i]);
      if (d < 0 || d >= nDays) continue;
      det[d]++;
      frp[d] += h.frp[i] ?? 0;
      if (h.wd[i] != null && h.ws[i] != null) {
        // wd is where the wind blows FROM (meteorological); embers travel the other way
        const a = ((h.wd[i] + 180) * Math.PI) / 180;
        windX[d] += Math.sin(a) * h.ws[i];
        windY[d] += Math.cos(a) * h.ws[i];
      }
    }
    const days = raw.growth.days;
    const daily = days.map((d, i) => Math.max(0, d.ha - (days[i - 1]?.ha ?? 0)));
    const peak = daily.reduce((best, v, i) => (v > daily[best] ? i : best), 0);
    const sensors = {};
    for (const s of h.sensor) sensors[s ?? 'other'] = (sensors[s ?? 'other'] ?? 0) + 1;
    return {
      ...raw, arr, first, last, n, det, frp, windX, windY, daily, peak, sensors,
      name: nameOf(raw),
      majorRings: raw.rings.filter((r) => Math.abs(ringAreaHa(r)) >= raw.area_ha * 0.004),
      tStart: Math.max(0, first - 0.6), tEnd: last + 3.5,
      g: raw.grid,
      // Two pairs of canvases: the deck.gl texture only refreshes when the image reference changes
      cv: { small: canvas(raw.grid.w, raw.grid.h), scar: [canvas(raw.grid.w, raw.grid.h), canvas(raw.grid.w, raw.grid.h)], glow: [canvas(raw.grid.w * 2, raw.grid.h * 2), canvas(raw.grid.w * 2, raw.grid.h * 2)], flip: 0 },
      img: { scar: new ImageData(raw.grid.w, raw.grid.h), glow: new ImageData(raw.grid.w, raw.grid.h) },
      hashes: Float32Array.from({ length: arr.length }, (_, i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1),
    };
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ---------------------------------------------------------------- camera
  function camFor(b) {
    const pad = 0.06;
    const minSpan = 0.35;
    let [x0, y0, x1, y1] = b;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const sx = Math.max(minSpan / Math.cos((cy * Math.PI) / 180), x1 - x0) / 2 + pad, sy = Math.max(minSpan, y1 - y0) / 2 + pad;
    [x0, x1, y0, y1] = [cx - sx, cx + sx, cy - sy, cy + sy];
    const narrow = innerWidth < 900;
    // Keep the fire clear of the panels (on phones the controls sit in the bottom half)
    const padding = narrow ? { top: 70, bottom: Math.round(innerHeight * 0.5), left: 24, right: 24 } : { top: 110, bottom: 130, left: 320, right: 350 };
    const c = map.cameraForBounds([[x0, y0], [x1, y1]], { padding });
    return { center: [c.center.lng ?? c.center[0], c.center.lat ?? c.center[1]], zoom: (c.zoom ?? 7) - 0.35 };
  }

  function steerCamera(dt) {
    if (!S.fire || !S.director || S.flying) return;
    const days = S.fire.growth.days;
    const b = days[clamp(Math.floor(S.t + 1.5), 0, days.length - 1)]?.bbox ?? S.fire.bbox;
    const target = camFor(b);
    const k = 1 - Math.exp(-dt * 0.9);
    S.cam ??= { center: map.getCenter().toArray(), zoom: map.getZoom() };
    S.cam.center = [lerp(S.cam.center[0], target.center[0], k), lerp(S.cam.center[1], target.center[1], k)];
    S.cam.zoom = lerp(S.cam.zoom, target.zoom, k);
    map.jumpTo({ center: S.cam.center, zoom: S.cam.zoom, pitch: lerp(map.getPitch(), 56, k), bearing: map.getBearing() + dt * (S.playing ? 1.6 : 0.6) });
  }
  function setDirector(on) {
    S.director = on;
    $('#spread-director').checked = on;
    if (on) S.cam = { center: map.getCenter().toArray(), zoom: map.getZoom() };
  }
  map.on('movestart', (e) => { if (e.originalEvent && S.active && S.director) { setDirector(false); toast('Director camera off: you have the controls'); } });

  // ---------------------------------------------------------------- playback
  function setPlaying(on) {
    if (on && S.fire && S.t >= S.fire.tEnd - 0.01) { S.t = S.fire.tStart; S.lastMerge = -1; }
    S.playing = on && !!S.fire;
    $('#spread-play').classList.toggle('playing', S.playing);
    $('#spread-play').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  }
  function seek(t) {
    if (!S.fire) return;
    S.t = clamp(t, S.fire.tStart, S.fire.tEnd);
    S.lastMerge = S.fire.growth.merges.filter((m) => m.day + 0.5 <= S.t).length - 1;
  }

  function tick(dt) {
    if (!S.fire) return;
    // Merge moments: ease into slow motion around each one
    const merges = S.fire.growth.merges;
    let target = 1;
    for (const m of merges) {
      const dm = S.t - (m.day + 0.5);
      if (dm > -0.7 && dm < 0.5) target = 0.18;
    }
    S.slow = lerp(S.slow, target, 1 - Math.exp(-dt * 5));
    if (S.playing) {
      S.t += dt * S.speed * S.slow;
      if (S.t >= S.fire.tEnd) { S.t = S.fire.tEnd; setPlaying(false); finale(); }
    }
    const idx = merges.filter((m) => m.day + 0.5 <= S.t).length - 1;
    if (idx > S.lastMerge && S.playing) mergeCallout(merges[idx], idx);
    S.lastMerge = idx;
    steerCamera(dt);
    updateHud(dt);
  }

  // ---------------------------------------------------------------- burn field bitmaps
  function paintField(now) {
    const F = S.fire, t = S.t, arr = F.arr, hs = F.hashes;
    const scar = F.img.scar.data, glow = F.img.glow.data;
    const fl = now / 1000;
    for (let i = 0; i < arr.length; i++) {
      const a = t - arr[i];
      const o = i * 4;
      if (!(a > -0.3)) { scar[o + 3] = 0; glow[o + 3] = 0; continue; }
      // Charred scar settles in over the first two days; old embers keep a faint red speckle
      if (a > 0) {
        const k = Math.min(1, a / 2);
        const ember = a < 12 && hs[i] > 0.86 ? (1 - a / 12) * (0.5 + 0.5 * Math.sin(fl * 3 + hs[i] * 40)) : 0;
        scar[o] = 46 + 60 * ember; scar[o + 1] = 14 + 8 * ember; scar[o + 2] = 10;
        scar[o + 3] = 120 + 70 * k;
      } else scar[o + 3] = 0;
      if (a < 7) {
        const l = Math.min(GLOW_LUT.length / 4 - 1, Math.round((a + 0.3) * 48)) * 4;
        const flick = 0.82 + 0.18 * Math.sin(fl * 7 + hs[i] * 60);
        glow[o] = GLOW_LUT[l]; glow[o + 1] = GLOW_LUT[l + 1]; glow[o + 2] = GLOW_LUT[l + 2];
        glow[o + 3] = GLOW_LUT[l + 3] * flick;
      } else glow[o + 3] = 0;
    }
    const cv = F.cv;
    cv.flip ^= 1;
    const scarC = cv.scar[cv.flip], glowC = cv.glow[cv.flip];
    scarC.getContext('2d').putImageData(F.img.scar, 0, 0);
    const sm = cv.small.getContext('2d');
    sm.putImageData(F.img.glow, 0, 0);
    const gx = glowC.getContext('2d');
    gx.clearRect(0, 0, glowC.width, glowC.height);
    gx.globalCompositeOperation = 'lighter';
    gx.filter = 'blur(3px)';
    gx.drawImage(cv.small, 0, 0, glowC.width, glowC.height);
    gx.filter = 'none';
    gx.drawImage(cv.small, 0, 0, glowC.width, glowC.height);
    return { scarC, glowC };
  }

  // ---------------------------------------------------------------- embers
  function stepEmbers(dt) {
    const F = S.fire;
    const lat = (F.bbox[1] + F.bbox[3]) / 2;
    const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom(); // metres per pixel
    const d = clamp(Math.floor(S.t), 0, F.windX.length - 1);
    const wn = Math.max(1, F.det[d]);
    const wx = F.windX[d] / wn, wy = F.windY[d] / wn; // km/h, toward
    const nSeg = segs.length / 5;
    const spawn = S.playing || S.t < F.tEnd ? Math.min(60, nSeg * 0.08 + 4) * dt * 10 : 0;
    for (let k = 0; k < spawn && embers.length < 1100 && nSeg; k++) {
      const s = (Math.random() * nSeg | 0) * 5;
      const u = Math.random();
      const lon = lerp(segs[s], segs[s + 2], u), la = lerp(segs[s + 1], segs[s + 3], u);
      const hot = clamp(segs[s + 4] / 6, 0.2, 1);
      embers.push({ lon, lat: la, z: 0, vz: (24 + Math.random() * 40) * mpp * (0.6 + hot), life: 0, max: 1.4 + Math.random() * 2.4, r: 0.9 + Math.random() * 1.7 * hot, ph: Math.random() * 6 });
    }
    const kx = 1 / (111320 * Math.cos((lat * Math.PI) / 180)), ky = 1 / 110540;
    const drift = 2.2 * mpp; // px/s per km/h of wind
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.life += dt;
      if (e.life > e.max) { embers[i] = embers[embers.length - 1]; embers.pop(); continue; }
      const wob = Math.sin(e.life * 5 + e.ph) * 6 * mpp;
      e.lon += (wx * drift + wob) * dt * kx;
      e.lat += (wy * drift) * dt * ky;
      e.z += e.vz * dt;
      e.vz *= 1 - dt * 0.35;
    }
  }

  // ---------------------------------------------------------------- layers
  function layers(now, dt) {
    const F = S.fire;
    if (!F || !S.active) return [];
    tick(dt);
    const t = S.t;
    if (t !== segT || S.playing) { segs = frontSegments(F.arr, F.g, t, segs); segT = t; }
    if (S.show.embers) stepEmbers(dt); else embers.length = 0;
    const { scarC, glowC } = paintField(now);
    const bounds = F.g.bbox;
    const h = F.hotspots;
    const kNow = firstAtLeast(h.t, t);
    const kOld = firstAtLeast(h.t, t - 1.5);
    const kBeam = firstAtLeast(h.t, t - 0.35);
    S.hotFrom = kOld; // picking index offset for tooltips
    const range = (a, b) => ({ length: Math.max(0, b - a), a });
    const ix = (_, { index, data }) => data.a + index; // non-iterable data: deck passes no object, only index + data
    const nSeg = segs.length / 5;
    const segData = { length: nSeg };
    const segPos0 = (_, { index }) => [segs[index * 5], segs[index * 5 + 1]];
    const segPos1 = (_, { index }) => [segs[index * 5 + 2], segs[index * 5 + 3]];
    const done = clamp((t - F.last) / 2.5, 0, 1); // finale: the real perimeter resolves
    const out = [
      new BitmapLayer({ id: 'spread-scar', image: scarC, bounds, parameters: NO_DEPTH }),
      new BitmapLayer({ id: 'spread-glow', image: glowC, bounds, parameters: ADDITIVE }),
    ];
    if (S.show.ghost || done > 0) {
      out.push(
        new PathLayer({
          id: 'spread-perimeter-glow', data: F.majorRings, getPath: (r) => r, getColor: [255, 150, 70, 90 * done], widthUnits: 'pixels', getWidth: 5,
          parameters: ADDITIVE, updateTriggers: { getColor: done },
        }),
        new PathLayer({
          id: 'spread-perimeter', data: F.rings, getPath: (r) => r, widthUnits: 'pixels', getWidth: 1 + done * 0.6, pickable: true,
          getColor: [255, 214, 160, (S.show.ghost ? 38 : 0) + 130 * done], parameters: NO_DEPTH, updateTriggers: { getColor: [done, S.show.ghost], getWidth: done },
        }),
      );
    }
    out.push(
      new LineLayer({
        id: 'spread-front-glow', data: segData, getSourcePosition: segPos0, getTargetPosition: segPos1,
        getColor: (_, { index }) => [...ramp(RATE_STOPS, segs[index * 5 + 4]), 70], getWidth: 9, widthUnits: 'pixels',
        parameters: ADDITIVE, updateTriggers: { getSourcePosition: t, getTargetPosition: t, getColor: t },
      }),
      new LineLayer({
        id: 'spread-front', data: segData, getSourcePosition: segPos0, getTargetPosition: segPos1,
        getColor: (_, { index }) => [...ramp(RATE_STOPS, segs[index * 5 + 4]), 235], getWidth: 1.8, widthUnits: 'pixels',
        parameters: ADDITIVE, updateTriggers: { getSourcePosition: t, getTargetPosition: t, getColor: t },
      }),
    );
    if (S.show.hotspots) {
      const pos = (d, o) => { const i = ix(d, o); return [h.lon[i], h.lat[i]]; };
      out.push(
        new ScatterplotLayer({
          // Last week's detections linger as faint sparks; older ones are left to the char scar
          id: 'spread-hot-old', data: range(firstAtLeast(h.t, t - 7), kOld), getPosition: pos, radiusUnits: 'pixels', getRadius: 1.1,
          getFillColor: (d, o) => [255, 90, 40, 46 * (1 - (t - h.t[ix(d, o)]) / 7)], parameters: ADDITIVE,
          updateTriggers: { getPosition: kOld, getFillColor: Math.round(t * 4) },
        }),
        new ScatterplotLayer({
          id: 'spread-hot', data: range(kOld, kNow), getPosition: pos, radiusUnits: 'pixels', pickable: true,
          getRadius: (d, o) => {
            const i = ix(d, o), a = t - h.t[i];
            return clamp(1.4 + Math.sqrt(h.frp[i] ?? 10) * 0.18, 1.4, 4.5) * (1 + 1.3 * Math.max(0, 1 - a / 0.15));
          },
          getFillColor: (d, o) => {
            const a = t - h.t[ix(d, o)];
            const c = ramp([[0, 255, 250, 225], [0.2, 255, 215, 120], [0.7, 255, 140, 50], [1.5, 255, 90, 40]], a);
            return [...c, lerp(170, 50, clamp(a / 1.5, 0, 1))];
          },
          parameters: ADDITIVE, updateTriggers: { getPosition: [kOld, kNow], getRadius: t, getFillColor: t },
        }),
      );
      // Satellite "pings": a short-lived beam of light where each detection lands
      out.push(new LineLayer({
        id: 'spread-beams', data: range(Math.max(kBeam, kNow - 500), kNow),
        getSourcePosition: (d, o) => { const i = ix(d, o); return [h.lon[i], h.lat[i], 0]; },
        getTargetPosition: (d, o) => { const i = ix(d, o); return [h.lon[i], h.lat[i], 1800 + Math.min(9000, (h.frp[i] ?? 10) * 40)]; },
        getColor: (d, o) => { const a = (t - h.t[ix(d, o)]) / 0.35; return [255, lerp(250, 150, a), lerp(220, 60, a), 200 * (1 - a) ** 1.5]; },
        getWidth: 1.5, widthUnits: 'pixels', parameters: ADDITIVE, updateTriggers: { getSourcePosition: kNow, getTargetPosition: kNow, getColor: t },
      }));
    }
    if (embers.length) {
      out.push(new ScatterplotLayer({
        id: 'spread-embers', data: embers, getPosition: (e) => [e.lon, e.lat, e.z], radiusUnits: 'pixels', getRadius: (e) => e.r,
        getFillColor: (e) => { const k = e.life / e.max; return [255, lerp(230, 80, k), lerp(140, 20, k), 255 * Math.min(1, e.life * 4) * (1 - k) * (0.6 + 0.4 * Math.sin(e.life * 20 + e.ph))]; },
        parameters: ADDITIVE, updateTriggers: { getPosition: now, getFillColor: now },
      }));
    }
    // Ignition marker and merge shockwaves
    const k0 = firstAtLeast(h.t, F.first + 0.001);
    if (t - F.first < 2.5 && F.n) {
      const a = (t - F.first) / 2.5, i = Math.max(0, k0 - 1);
      out.push(new ScatterplotLayer({
        id: 'spread-ignition', data: [0, 1, 2], getPosition: () => [h.lon[i], h.lat[i]], radiusUnits: 'pixels', filled: false, stroked: true,
        lineWidthUnits: 'pixels', getLineWidth: 1.5, getRadius: (k) => 8 + (((now / 1400 + k / 3) % 1) * 60),
        getLineColor: (k) => [255, 230, 170, 200 * (1 - ((now / 1400 + k / 3) % 1)) * (1 - a)], parameters: ADDITIVE,
        updateTriggers: { getRadius: now, getLineColor: now },
      }));
    }
    const live = F.growth.merges.filter((m) => { const dm = t - (m.day + 0.5); return dm > -0.05 && dm < 1.4; });
    if (live.length) {
      out.push(
        new ScatterplotLayer({
          id: 'spread-merge-rings', data: live.flatMap((m) => [0, 1, 2].map((k) => ({ m, k }))), getPosition: ({ m }) => [m.lon, m.lat],
          radiusUnits: 'pixels', filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2,
          getRadius: ({ m, k }) => 10 + clamp((t - m.day - 0.5) / 1.4 - k * 0.15, 0, 1) * 160,
          getLineColor: ({ m, k }) => [255, 240, 200, 255 * (1 - clamp((t - m.day - 0.5) / 1.4 - k * 0.15, 0, 1))],
          parameters: ADDITIVE, updateTriggers: { getRadius: t, getLineColor: t },
        }),
        new TextLayer({
          id: 'spread-merge-label', data: live, getPosition: (m) => [m.lon, m.lat], getText: () => 'FRONTS MERGE', getSize: 13,
          getColor: (m) => [255, 236, 210, 255 * (1 - clamp((t - m.day - 0.5) / 1.4, 0, 1))], getPixelOffset: [0, -26],
          fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, outlineWidth: 3, outlineColor: [0, 0, 0, 200], fontSettings: { sdf: true },
          characterSet: 'FRONTS MERGE', updateTriggers: { getColor: t },
        }),
      );
    }
    return out;
  }

  function tooltip({ layer, index }) {
    const F = S.fire;
    if (!F) return null;
    if (layer.id === 'spread-hot') {
      const i = (S.hotFrom ?? 0) + index;
      const h = F.hotspots;
      const when = dateAt(F, h.t[i]);
      return { html: `<b>Satellite detection</b><br/>${h.sensor[i] ?? 'Sensor n/a'}${h.frp[i] != null ? ` · ${Math.round(h.frp[i])} MW` : ''}<br/><small>${fmtDay(when, { year: 'numeric' })} ${when.toISOString().slice(11, 16)} UTC</small>`, className: 'deck-tooltip' };
    }
    if (layer.id === 'spread-perimeter') return { html: `<b>${F.name}</b><br/>Final burned area ${fmtInt(F.area_ha)} ha<br/><small>NBAC perimeter (NRCan)</small>`, className: 'deck-tooltip' };
    return null;
  }

  // ---------------------------------------------------------------- HUD
  const counter = { v: 0 };
  function updateHud(dt) {
    const F = S.fire;
    const t = S.t;
    const d = clamp(Math.floor(t), 0, F.growth.days.length - 1);
    const frac = clamp(t - Math.floor(t), 0, 1);
    const prevHa = F.growth.days[d - 1]?.ha ?? 0;
    const ha = t < F.first ? 0 : lerp(prevHa, F.growth.days[d].ha, frac);
    counter.v = Math.abs(ha - counter.v) > F.area_ha * 0.08 ? ha : lerp(counter.v, ha, 1 - Math.exp(-dt * 10)); // snap on seeks
    const day = Math.max(0, Math.floor(t - F.first) + 1);
    const date = dateAt(F, t);
    $('#date-year').textContent = t < F.first ? 'Day 0' : `Day ${day}`;
    $('#date-day').textContent = fmtDay(date, { year: 'numeric' }).replace(',', ' ·');
    $('#sk-ha').textContent = fmtInt(counter.v);
    $('#sk-det').textContent = fmtInt(firstAtLeast(F.hotspots.t, t));
    $('#sk-pct').textContent = `${Math.round((100 * counter.v) / F.area_ha)}%`;
    const today = F.daily[d] ?? 0;
    $('#sk-today').innerHTML = t < F.first || t > F.last + 1 ? '&nbsp;' : `<b>+${fmtInt(today)} ha</b> on ${fmtDay(dateAt(F, d))}${d === F.peak ? ' <span class="peak">peak day</span>' : ''}`;
    // Track and chart playheads
    const span = F.tEnd - F.tStart;
    const x = (t - F.tStart) / span;
    $('#spread-playhead').style.transform = `translateX(${x * $('#spread-track').clientWidth}px)`;
    $('#spread-playhead-label').textContent = t < F.first ? fmtDay(date) : `Day ${day} · ${fmtDay(date)}`;
    const chart = $('#spread-chart svg');
    if (chart) {
      const cx = 4 + x * 262;
      chart.querySelector('.reveal').setAttribute('width', Math.max(0, cx - 4));
      chart.querySelector('.ph').setAttribute('transform', `translate(${cx},0)`);
      chart.querySelector('.ph-dot').setAttribute('cy', 96 - (counter.v / F.area_ha) * 84);
    }
    $('#spread-slow').classList.toggle('on', S.slow < 0.6 && S.playing);
  }

  function renderPanel() {
    const F = S.fire;
    $('#spread-kicker').textContent = `${F.year} · ${F.cause ?? 'Cause unknown'}${F.cause && !/undetermined/i.test(F.cause) ? ' cause' : ''}`;
    $('#spread-name').textContent = F.name;
    const sens = Object.entries(F.sensors).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmtInt(v)}`).join(' · ');
    const peakDate = dateAt(F, F.peak);
    const fmtIso = (d) => (d ? fmtDate(d) : 'n/a');
    $('#spread-facts').innerHTML = `
      <dt>Final area</dt><dd>${fmtInt(F.area_ha)} ha <small>(${fmtInt(F.area_ha / 100)} km²)</small></dd>
      <dt>Detected</dt><dd>${fmtIso(F.hs_sdate)} → ${fmtIso(F.hs_edate)}</dd>
      <dt>Peak growth</dt><dd><b>+${fmtInt(F.daily[F.peak])} ha</b> on ${fmtDay(peakDate)}</dd>
      <dt>Fronts merged</dt><dd>${F.growth.merges.length ? `${F.growth.merges.length}×` : 'none'}</dd>
      <dt>Detections</dt><dd>${fmtInt(F.n)} <small>${sens}</small></dd>
      ${F.cnfdb_fire_id ? `<dt>CNFDB</dt><dd><small>${F.cnfdb_fire_id}</small></dd>` : ''}`;
    $('#spread-method').innerHTML = `The front is interpolated from <b>${fmtInt(F.n)}</b> real satellite detections and constrained to the final NBAC burned-area perimeter. Between detections its exact shape is estimated.`;
    drawChart();
  }

  function drawChart() {
    const F = S.fire;
    const W = 270, H = 112, X = (t) => 4 + ((t - F.tStart) / (F.tEnd - F.tStart)) * 262, Y = (ha) => 96 - (ha / F.area_ha) * 84;
    const pts = F.growth.days.map((d, i) => `${X(i + 1).toFixed(1)},${Y(d.ha).toFixed(1)}`);
    const line = `M${X(F.tStart).toFixed(1)},96 L${X(F.first).toFixed(1)},96 L${pts.join(' L')}`;
    const maxDaily = Math.max(1, ...F.daily);
    const bars = F.daily.map((v, i) => {
      const h = (v / maxDaily) * 22;
      return h > 0.3 ? `<rect x="${(X(i) + 0.2).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(0.6, X(i + 1) - X(i) - 0.4).toFixed(1)}" height="${h.toFixed(1)}" class="${i === F.peak ? 'pk' : ''}"/>` : '';
    }).join('');
    const merges = F.growth.merges.map((m) => `<path d="M${X(m.day + 0.5)},${Y(F.growth.days[m.day].ha) - 7} l3,3 l-3,3 l-3,-3z" class="mg"/>`).join('');
    $('#spread-chart').innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="growth">
        <defs>
          <linearGradient id="sg-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a1f" stop-opacity=".55"/><stop offset="1" stop-color="#ff3d1f" stop-opacity="0"/></linearGradient>
          <clipPath id="sg-clip"><rect class="reveal" x="4" y="0" width="0" height="${H}"/></clipPath>
        </defs>
        <line x1="4" x2="266" y1="12" y2="12" class="grid"/><text x="266" y="9" class="lbl" text-anchor="end">${fmtHa(F.area_ha)} ha</text>
        <line x1="4" x2="266" y1="96" y2="96" class="grid"/>
        <path d="${line}" class="ghost"/>
        <g clip-path="url(#sg-clip)">
          <path d="${line} L${X(F.growth.days.length)},96 Z" fill="url(#sg-fill)"/>
          <path d="${line}" class="curve"/>
          <g class="bars">${bars}</g>
        </g>
        ${merges}
        <g class="ph"><line y1="6" y2="${H}" /><circle class="ph-dot" r="3.5" cy="96"/></g>
      </svg>`;
  }

  // Timeline track: daily detections, coloured by fire radiative power
  function drawTrack() {
    const F = S.fire;
    const c = $('#spread-canvas');
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const X = (t) => ((t - F.tStart) / (F.tEnd - F.tStart)) * w;
    const maxDet = Math.max(1, ...F.det);
    const maxFrp = Math.max(1, ...F.frp.map((v, i) => v / Math.max(1, F.det[i])));
    for (let d = 0; d < F.det.length; d++) {
      if (!F.det[d]) continue;
      const bh = Math.max(1.5, Math.sqrt(F.det[d] / maxDet) * (h - 16));
      const heat = clamp((F.frp[d] / F.det[d]) / maxFrp, 0, 1);
      const [r, g, b] = ramp([[0, 160, 40, 20], [0.4, 255, 110, 30], [1, 255, 235, 170]], Math.sqrt(heat));
      ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      ctx.fillRect(X(d) + 0.5, h - 12 - bh, Math.max(1, X(d + 1) - X(d) - 1), bh);
    }
    ctx.fillStyle = '#5f5b56';
    ctx.font = '9px JetBrains Mono, monospace';
    let lastMonth = -1;
    for (let d = Math.ceil(F.tStart); d < F.tEnd; d++) {
      const dt = dateAt(F, d);
      if (dt.getUTCDate() === 1 || (lastMonth < 0 && d === Math.ceil(F.tStart))) {
        if (dt.getUTCMonth() !== lastMonth) ctx.fillText(fmtDay(dt, { day: undefined }).toUpperCase(), X(d) + 2, h - 2);
        lastMonth = dt.getUTCMonth();
      }
    }
    for (const m of F.growth.merges) {
      ctx.fillStyle = '#fff3d6';
      ctx.beginPath(); ctx.arc(X(m.day + 0.5), 5, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------------------------------------------------------------- moments
  function titleCard() {
    const F = S.fire;
    const el = $('#spread-title');
    el.innerHTML = `<p class="eyebrow">True spread replay</p><h2>${F.name}</h2><p>${F.year} · ${fmtInt(F.area_ha)} ha · ${fmtInt(F.n)} satellite detections</p>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(titleCard.timer);
    titleCard.timer = setTimeout(() => el.classList.remove('show'), 4300); // even if the animation was throttled
  }
  function mergeCallout(m, i) {
    const el = $('#spread-callout');
    el.innerHTML = `<b>Fronts merge</b> · ${fmtDay(dateAt(S.fire, m.day))} · now ${fmtInt(m.ha)} ha as one fire${S.fire.growth.merges.length > 1 ? ` <small>${i + 1}/${S.fire.growth.merges.length}</small>` : ''}`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  function finale() {
    const el = $('#spread-callout');
    el.innerHTML = `<b>Final perimeter</b> · ${fmtInt(S.fire.area_ha)} ha · NBAC`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  // ---------------------------------------------------------------- list
  function renderList() {
    const el = $('#spread-list');
    if (S.available === false) {
      el.innerHTML = `<p class="muted small">No spread replays loaded. Run <code>npm run load:spread</code>, then reload.</p>`;
      return;
    }
    if (S.available === null) { el.innerHTML = '<p class="muted small">Loading…</p>'; return; }
    const q = $('#spread-search').value.trim().toLowerCase();
    const max = Math.max(...S.list.map((f) => f.area_ha));
    let lastYear = null;
    el.innerHTML = S.list.filter((f) => !q || `${nameOf(f)} ${f.year}`.toLowerCase().includes(q)).map((f) => {
      const head = f.year !== lastYear ? `<div class="sl-year">${f.year}</div>` : '';
      lastYear = f.year;
      return `${head}<button class="sl-row${S.fire?.id === f.id ? ' on' : ''}" data-id="${f.id}">
        <span class="sl-name">${nameOf(f)}</span><span class="sl-ha">${fmtHa(f.area_ha)} ha</span>
        <i style="--w:${(Math.sqrt(f.area_ha / max) * 100).toFixed(1)}%"></i></button>`;
    }).join('') || '<p class="muted small">No match.</p>';
    el.querySelectorAll('.sl-row').forEach((b) => b.addEventListener('click', () => { open(b.dataset.id); history.replaceState(null, '', `#spread/${b.dataset.id}`); }));
    el.querySelector('.sl-row.on')?.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    $('#spread-search').addEventListener('input', renderList);
    $('#spread-play').addEventListener('click', () => setPlaying(!S.playing));
    $('#spread-director').addEventListener('change', (e) => setDirector(e.target.checked));
    for (const k of ['hotspots', 'embers', 'ghost']) $(`#spread-show-${k}`).addEventListener('change', (e) => { S.show[k] = e.target.checked; });
    $$('#spread-speed button').forEach((b) => b.addEventListener('click', () => {
      S.speed = Number(b.dataset.speed);
      $$('#spread-speed button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('#spread-legend').innerHTML = `<span>slow</span><i style="background:linear-gradient(90deg,${RATE_LEGEND.join(',')})"></i><span>fast</span>`;
    const track = $('#spread-track');
    const posToT = (ev) => { const r = track.getBoundingClientRect(); return S.fire.tStart + clamp((ev.clientX - r.left) / r.width, 0, 1) * (S.fire.tEnd - S.fire.tStart); };
    let scrubbing = false, was = false;
    track.addEventListener('pointerdown', (ev) => { if (!S.fire) return; scrubbing = true; was = S.playing; setPlaying(false); track.setPointerCapture(ev.pointerId); seek(posToT(ev)); });
    track.addEventListener('pointermove', (ev) => {
      if (!S.fire) return;
      const t = posToT(ev);
      const tip = $('#spread-tip');
      tip.style.left = `${ev.clientX - track.getBoundingClientRect().left}px`;
      const d = Math.floor(t);
      tip.textContent = `${fmtDay(dateAt(S.fire, t))} · ${fmtInt(S.fire.det[d] ?? 0)} detections`;
      if (scrubbing) seek(t);
    });
    track.addEventListener('pointerup', () => { scrubbing = false; if (was) setPlaying(true); });
    addEventListener('resize', () => { if (S.fire && S.active) drawTrack(); });
  }
  wire();

  return {
    state: S, loadList, open, forCnfdb, layers, tooltip, setPlaying, seek,
    prefer(id) { S.wanted = id || null; },
    enter() {
      S.active = true;
      if (S.fire) { drawTrack(); S.cam = { center: map.getCenter().toArray(), zoom: map.getZoom() }; return; }
      openFirst();
    },
    exit() { S.active = false; setPlaying(false); map.easeTo({ pitch: 20, bearing: 0, duration: 1200 }); },
    toggle() { setPlaying(!S.playing); },
    step(days) { if (S.fire) { setPlaying(false); seek(S.t + days); } },
    get hash() { return S.fire ? `spread/${S.fire.id}` : 'spread'; },
    /** The calendar moment shown, for lighting (null before a fire is open). */
    get date() { return S.fire ? dateAt(S.fire, S.t) : null; },
  };
}
