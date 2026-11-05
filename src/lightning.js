/**
 * lightning.js: Lightning Storms.
 *
 * History: every lightning-caused fire in the record gets a bolt that strikes where it started.
 *   Lightning ignitions within 1 day and 60 km of each other are linked into one storm (union-find),
 *   and storms of 3+ fires get a drifting storm cell. Dates and places are recorded; the hour of
 *   each strike within its day and the cell's shape are illustrative, and the UI says so.
 * Live: the Canadian Lightning Detection Network's 10-minute flash density for the last 3 hours,
 *   from ECCC MSC GeoMet (WMS, public, CORS-enabled), looped as an animation over the province.
 */
import { esc } from './data.js';
import { CONFIG } from './config.js';

const { ScatterplotLayer, PathLayer } = globalThis.deck ?? {};

export const STORM_LINK_DAYS = 1;
export const STORM_LINK_KM = 60;
export const STORM_MIN_FIRES = 3;

const KM_PER_DEG = 111.32;
const distKm = (a, b) => {
  const dx = (a.longitude - b.longitude) * KM_PER_DEG * Math.cos(((a.latitude + b.latitude) / 2) * (Math.PI / 180));
  const dy = (a.latitude - b.latitude) * KM_PER_DEG;
  return Math.hypot(dx, dy);
};
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 100000) / 100000; };

/**
 * Group lightning ignitions into storms. `fires` need { t, latitude, longitude, size_ha, fire_id, general_cause }
 * and must be sorted by t. Returns { storms, strikes } with strikes sorted by strike time.
 */
export function buildStorms(fires, { days = STORM_LINK_DAYS, km = STORM_LINK_KM, minFires = STORM_MIN_FIRES } = {}) {
  const L = fires.filter((f) => f.general_cause === 'Lightning');
  const parent = L.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length && L[j].t - L[i].t <= days; j++) {
      if (distKm(L[i], L[j]) <= km) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  L.forEach((f, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(f); });

  const storms = [];
  const stormOf = new Map();
  for (const members of groups.values()) {
    if (members.length < minFires) continue;
    const lon = members.reduce((s, f) => s + f.longitude, 0) / members.length;
    const lat = members.reduce((s, f) => s + f.latitude, 0) / members.length;
    const center = { longitude: lon, latitude: lat };
    const radiusKm = Math.max(...members.map((f) => distKm(f, center))) + 18;
    const t0 = Math.min(...members.map((f) => f.t)), t1 = Math.max(...members.map((f) => f.t));
    // Drift direction: from the first day's fires to the last day's, else the prevailing westerly
    const first = members.filter((f) => f.t === t0), last = members.filter((f) => f.t === t1);
    let dir = [1, 0.15];
    if (t1 > t0) {
      const c = (g) => [g.reduce((s, f) => s + f.longitude, 0) / g.length, g.reduce((s, f) => s + f.latitude, 0) / g.length];
      const [a, b] = [c(first), c(last)];
      const v = [b[0] - a[0], b[1] - a[1]], n = Math.hypot(...v);
      if (n > 0.05) dir = [v[0] / n, v[1] / n];
    }
    const storm = {
      id: `storm-${members[0].fire_id}`, fires: members, count: members.length, center: [lon, lat], radiusKm, t0, t1, dir,
      ha: members.reduce((s, f) => s + f.size_ha, 0),
      // One cloud cell per day, made of puffs over that day's strikes (a multi-day outbreak moves)
      days: [...new Set(members.map((f) => f.t))].sort((a, b) => a - b).map((t) => {
        const today = members.filter((f) => f.t === t);
        const step = Math.max(1, Math.ceil(today.length / 12));
        return {
          t, count: today.length,
          puffs: today.filter((_, k) => k % step === 0).map((f) => ({
            position: [f.longitude, f.latitude], km: 22 + 18 * hash(`p${f.fire_id}`), a: hash(`a${f.fire_id}`) * Math.PI * 2,
          })),
        };
      }),
    };
    storms.push(storm);
    for (const f of members) stormOf.set(f.fire_id, storm);
  }
  // A strike lands shortly before its fire appears in the replay (fires are recorded by day)
  const strikes = L.map((f) => {
    const h = hash(f.fire_id);
    return { fire: f, storm: stormOf.get(f.fire_id) ?? null, t: f.t - 0.03 - 0.22 * h, seed: h };
  }).sort((a, b) => a.t - b.t);
  storms.sort((a, b) => b.count - a.count);
  return { storms, strikes };
}

/**
 * A jagged bolt from the cloud to the ground, with a fork. Positions are [lon, lat, metres] for a
 * 9 km bolt; scaleBolt() stretches it so it reads at any zoom.
 */
export function boltPaths(lon, lat, seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const kx = 1 / (KM_PER_DEG * Math.cos(lat * (Math.PI / 180))), ky = 1 / KM_PER_DEG;
  const top = 9000, steps = 14;
  const sx = (rnd() - 0.5) * 6, sy = (rnd() - 0.5) * 6; // cloud origin offset in km
  const main = [];
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const jag = i === 0 || i === steps ? 0 : (rnd() - 0.5) * 2.4;
    main.push([lon + (sx * (1 - p) + jag) * kx, lat + (sy * (1 - p) + (rnd() - 0.5) * 1.6 * (i && i < steps)) * ky, top * (1 - p)]);
  }
  const forkAt = 3 + Math.floor(rnd() * 5);
  const fork = [main[forkAt]];
  for (let i = 1; i <= 4; i++) {
    const [x, y, z] = fork[i - 1];
    fork.push([x + (rnd() - 0.2) * 1.8 * kx, y + (rnd() - 0.5) * 1.8 * ky, z - top / steps * 1.1]);
  }
  return [main, fork];
}

/** Stretch a bolt about its ground point: k = 1 keeps the 9 km shape. */
export function scaleBolt(path, ground, k) {
  return path.map(([x, y, z]) => [ground[0] + (x - ground[0]) * k, ground[1] + (y - ground[1]) * k, z * k]);
}

export function createLightning({ onStrike } = {}) {
  const S = { enabled: true, storms: [], strikes: [], bolts: [], cells: new Map(), lastFlash: 0 };

  function setFires(fires) {
    const built = buildStorms(fires);
    S.storms = built.storms; S.strikes = built.strikes;
    S.bolts = []; S.cells.clear();
  }

  const lowerBound = (v) => {
    let lo = 0, hi = S.strikes.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (S.strikes[m].t < v) lo = m + 1; else hi = m; }
    return lo;
  };

  /** Trigger strikes whose time falls in (prevT, t]. Bolts then live on the wall clock. */
  function tick(prevT, t, now, speed) {
    if (!S.enabled || !(t > prevT) || t - prevT > 20) return;
    let hits = S.strikes.slice(lowerBound(prevT + 1e-9), lowerBound(t + 1e-9));
    if (hits.length > 24) hits = hits.sort((a, b) => b.fire.size_ha - a.fire.size_ha).slice(0, 24);
    for (const h of hits) {
      const [main, fork] = boltPaths(h.fire.longitude, h.fire.latitude, h.seed);
      S.bolts.push({ strike: h, start: now + h.seed * 120, main, fork });
      const key = h.storm && `${h.storm.id}:${h.fire.t}`;
      if (h.storm && !S.cells.has(key)) {
        const day = h.storm.days.find((d) => d.t === h.fire.t);
        S.cells.set(key, { storm: h.storm, day, start: now, dur: Math.min(5000, Math.max(1500, (1.2 / speed) * 1000)) });

      }
      if (onStrike && now - S.lastFlash > 220) {
        S.lastFlash = now;
        onStrike({ fire: h.fire, storm: h.storm, intensity: Math.min(1, 0.35 + Math.log10(h.fire.size_ha + 1) / 5) });
      }
    }
    if (S.bolts.length > 80) S.bolts.splice(0, S.bolts.length - 80);
  }

  /** Storm cells: drawn under the fires so they darken the ground. */
  function under(now) {
    if (!S.enabled || !S.cells.size) return [];
    const puffs = [];
    for (const [id, c] of S.cells) {
      const p = (now - c.start) / c.dur;
      if (p > 1) { S.cells.delete(id); continue; }
      const fade = Math.min(1, p * 5) * Math.min(1, (1 - p) * 3);
      const st = c.storm, kx = 1 / (KM_PER_DEG * Math.cos(st.center[1] * (Math.PI / 180)));
      const drift = (p - 0.5) * 40; // km along the storm's direction of travel
      for (const pf of c.day.puffs) {
        const wob = 6 * Math.sin(now / 900 + pf.a);
        puffs.push({
          position: [pf.position[0] + (st.dir[0] * drift + Math.cos(pf.a) * wob) * kx, pf.position[1] + (st.dir[1] * drift + Math.sin(pf.a) * wob) / KM_PER_DEG],
          radius: pf.km * 1000, alpha: 105 * fade,
        });
      }
    }
    return [new ScatterplotLayer({
      id: 'storm-cells', data: puffs, getPosition: (d) => d.position, getRadius: (d) => d.radius,
      getFillColor: (d) => [10, 12, 24, d.alpha], stroked: false, radiusMinPixels: 10,
      updateTriggers: { getFillColor: now, getPosition: now },
    })];
  }

  /** Bolts, ground flashes and in-cloud glow: drawn over everything. */
  function over(now, additive, zoom = 6, lat = 55) {
    if (!S.enabled) return [];
    // About 90 px tall on screen whatever the zoom (a real 9 km bolt is a speck at province scale)
    const mpp = (156543 * Math.cos(lat * (Math.PI / 180))) / 2 ** zoom;
    const k = Math.min(7, Math.max(0.5, (90 * mpp) / 9000));
    const LIFE = 620;
    S.bolts = S.bolts.filter((b) => now - b.start < LIFE);
    const live = S.bolts.filter((b) => now >= b.start);
    // Return-stroke flicker: bright, dim, bright again, then fade
    const glow = (b) => {
      const e = now - b.start;
      const k = e < 70 ? 1 : e < 140 ? 0.35 : e < 210 ? 0.95 : Math.max(0, 1 - (e - 210) / (LIFE - 210));
      return k;
    };
    const ground = (b) => [b.strike.fire.longitude, b.strike.fire.latitude];
    const paths = live.flatMap((b) => [
      { path: scaleBolt(b.main, ground(b), k), k: glow(b), main: true },
      { path: scaleBolt(b.fork, ground(b), k), k: glow(b) * 0.7, main: false },
    ]);
    const cellGlow = live.filter((b) => b.strike.storm && now - b.start < 220);
    return [
      new ScatterplotLayer({
        id: 'storm-glow', data: cellGlow, getPosition: (b) => [b.strike.fire.longitude, b.strike.fire.latitude],
        getRadius: 4500 * k, getFillColor: [120, 140, 255, 24], parameters: additive, radiusMinPixels: 12,
        updateTriggers: { getFillColor: now },
      }),
      new PathLayer({
        id: 'bolt-glow', data: paths, getPath: (d) => d.path, getWidth: (d) => (d.main ? 9 : 5), widthUnits: 'pixels',
        getColor: (d) => [120, 150, 255, 90 * d.k], parameters: additive, billboard: true, capRounded: true, jointRounded: true,
        updateTriggers: { getColor: now },
      }),
      new PathLayer({
        id: 'bolts', data: paths, getPath: (d) => d.path, getWidth: (d) => (d.main ? 2.2 : 1.2), widthUnits: 'pixels',
        getColor: (d) => [235, 240, 255, 255 * d.k], parameters: additive, billboard: true,
        updateTriggers: { getColor: now },
      }),
      new ScatterplotLayer({
        id: 'strike-flash', data: live, getPosition: (b) => [b.strike.fire.longitude, b.strike.fire.latitude],
        radiusUnits: 'pixels', getRadius: (b) => 4 + ((now - b.start) / LIFE) * 34,
        getFillColor: (b) => [200, 215, 255, 150 * glow(b)], parameters: additive,
        updateTriggers: { getRadius: now, getFillColor: now },
      }),
    ];
  }

  return {
    state: S, setFires, tick, under, over,
    get storms() { return S.storms; },
    setEnabled(on) { S.enabled = on; if (!on) { S.bolts = []; S.cells.clear(); } },
    reset() { S.bolts = []; S.cells.clear(); },
  };
}

// ---------------------------------------------------------------- live CLDN lightning
const { wmsUrl: GEOMET, lightningLayer: LAYER } = CONFIG.geomet;
const REGION = { west: -121, east: -91, south: 47, north: 62.5 };
const SK_BOX = { west: -110, east: -101.4, south: 49, north: 60 };
const mx = (lon) => (lon * 20037508.34) / 180;
const my = (lat) => (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.34) / Math.PI;

/** Parse a WMS time dimension like "2026-11-03T14:00:00Z/2026-11-03T17:00:00Z/PT10M". */
export function parseTimeDimension(text) {
  const [start, end, step] = text.trim().split('/');
  const m = step?.match(/^PT(\d+)M$/);
  if (!m) return text.split(',').map((s) => s.trim());
  const out = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += Number(m[1]) * 60000) out.push(new Date(t).toISOString().replace('.000', ''));
  return out;
}

export function createLiveLightning({ map, statusEl }) {
  const S = { on: false, times: [], frames: [], idx: 0, last: 0, active: 0, loaded: false, error: null, pending: false };
  // Only ask for the next frame once the last one has landed (MapLibre aborts overlapping loads)
  map.on('data', (e) => { if (e.sourceId === 'cldn-lightning' && e.dataType === 'source') S.pending = false; });
  const W = 900, H = Math.round((W * (my(REGION.north) - my(REGION.south))) / (mx(REGION.east) - mx(REGION.west)));
  const url = (time) => `${GEOMET}?service=WMS&version=1.3.0&request=GetMap&layers=${LAYER}&styles=&crs=EPSG:3857` +
    `&bbox=${mx(REGION.west)},${my(REGION.south)},${mx(REGION.east)},${my(REGION.north)}&width=${W}&height=${H}&format=image/png&transparent=true&time=${encodeURIComponent(time)}`;
  const coords = [[REGION.west, REGION.north], [REGION.east, REGION.north], [REGION.east, REGION.south], [REGION.west, REGION.south]];

  function status(html) { if (statusEl) statusEl.innerHTML = html; }

  async function load() {
    status('Loading CLDN lightning frames…');
    try {
      const caps = await (await fetch(`${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${LAYER}`)).text();
      const dim = caps.match(new RegExp(`<Name>${LAYER}</Name>[\\s\\S]*?<Dimension name="time"[^>]*>([^<]+)</Dimension>`));
      if (!dim) throw new Error('no time dimension');
      S.times = parseTimeDimension(dim[1]);
      // Fetch each frame once into a blob URL, so looping never re-downloads
      S.frames.forEach((f) => f.url && URL.revokeObjectURL(f.url));
      S.frames = await Promise.all(S.times.map(async (time) => {
        try {
          const blob = await (await fetch(url(time))).blob();
          const src = URL.createObjectURL(blob);
          const im = new Image();
          await new Promise((ok, fail) => { im.onload = ok; im.onerror = fail; im.src = src; });
          return { time, url: src, flashes: countFlashes(im) };
        } catch { return { time, url: null, flashes: 0 }; }
      }));
      S.frames = S.frames.filter((f) => f.url);
      S.loaded = true;
      const active = S.frames.filter((f) => f.flashes > 0).length;
      S.active = active;
      const span = S.frames.length ? `${S.frames[0].time.slice(11, 16)}–${S.frames.at(-1).time.slice(11, 16)} UTC` : '';
      status(active
        ? `<b>⚡ Lightning over Saskatchewan</b> in ${active} of ${S.frames.length} ten-minute frames (${esc(span)}).`
        : `No lightning detected over Saskatchewan in the last 3 hours (${esc(span)}). The loop will show flashes when storms are active.`);
      if (S.on) attach();
    } catch (e) {
      S.error = e.message;
      status(`Live lightning unavailable (${esc(e.message)}).`);
    }
  }

  // Count coloured pixels inside Saskatchewan (GeoMet sends CORS headers, so the canvas stays readable)
  function countFlashes(im) {
    try {
      const c = document.createElement('canvas');
      c.width = 180; c.height = Math.round((180 * H) / W);
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0, c.width, c.height);
      const fx = (lon) => ((mx(lon) - mx(REGION.west)) / (mx(REGION.east) - mx(REGION.west))) * c.width;
      const fy = (lat) => ((my(REGION.north) - my(lat)) / (my(REGION.north) - my(REGION.south))) * c.height;
      const x0 = Math.floor(fx(SK_BOX.west)), x1 = Math.ceil(fx(SK_BOX.east)), y0 = Math.floor(fy(SK_BOX.north)), y1 = Math.ceil(fy(SK_BOX.south));
      const data = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 40) n++;
      return n;
    } catch { return 0; }
  }

  function attach() {
    if (!S.frames.length || map.getSource('cldn-lightning')) return;
    const beforeLabels = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addSource('cldn-lightning', { type: 'image', url: S.frames[0].url, coordinates: coords });
    map.addLayer({
      id: 'cldn-lightning', type: 'raster', source: 'cldn-lightning',
      paint: { 'raster-opacity': 0.95, 'raster-fade-duration': 0, 'raster-brightness-min': 0.15, 'raster-saturation': 0.3 },
    }, beforeLabels);
    S.idx = 0;
    S.pending = false;
  }
  function detach() {
    if (map.getLayer('cldn-lightning')) map.removeLayer('cldn-lightning');
    if (map.getSource('cldn-lightning')) map.removeSource('cldn-lightning');
  }

  /** Advance the loop: 10-minute frames at ~3 per second, holding the latest frame. */
  function tick(now) {
    if (!S.on || !S.frames.length || !map.getSource('cldn-lightning')) return;
    const hold = S.idx === S.frames.length - 1 ? 1600 : 320;
    if (now - S.last > hold && !S.pending) {
      S.last = now;
      S.pending = true;
      S.idx = (S.idx + 1) % S.frames.length;
      map.getSource('cldn-lightning').updateImage({ url: S.frames[S.idx].url, coordinates: coords });
      const label = document.getElementById('cldn-time');
      if (label) label.textContent = `${S.frames[S.idx].time.slice(11, 16)} UTC`;
    }
    if (map.getLayer('cldn-lightning')) map.setPaintProperty('cldn-lightning', 'raster-opacity', 0.75 + 0.25 * Math.abs(Math.sin(now / 140)));
  }

  return {
    state: S, tick,
    show(on) {
      S.on = on;
      if (!on) { detach(); return; }
      if (!S.loaded && !S.error) load(); else attach();
    },
    refresh() { S.loaded = false; S.error = null; detach(); if (S.on) load(); },
  };
}
