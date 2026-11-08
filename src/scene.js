/**
 * scene.js: 3D terrain, sun-lit hillshade, sky and the moving day/night terminator.
 *
 * Terrain:  Terrarium elevation tiles (AWS Open Data, public, no key) as a MapLibre raster-dem
 *           source, used twice: once for 3D terrain and once for hillshade.
 * Lighting: the real sun position (src/sun.js) for the date being shown. The hillshade is lit
 *           from the sun's azimuth, and a low-resolution canvas source shades every pixel by
 *           the local sun altitude, so dawn and dusk sweep across the province as a real terminator.
 *
 * Sky modes: auto (Live uses the real clock; other modes run a slow day cycle on the shown date),
 *            day, golden (evening golden hour) and night.
 */
import { solarTerms, sunAt, sunAltitude, atLocalTime, localClock } from './sun.js';
import { CONFIG } from './config.js';

const TERRARIUM = CONFIG.scene.terrainTiles;
const CYCLE_MS = 48000;               // one full day/night every 48 s in cycle mode
// Covers the whole view at the minimum zoom; edges are feathered so no box ever shows
const SHADE = { w: 192, h: 128, west: -172, east: -38, south: 18, north: 78, feather: 14 };
const CENTER = [-105.6, 54.6];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const hex = (c) => `#${c.map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('')}`;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

export function createScene({ map, getDate, getMode }) {
  const S = {
    terrain: true, exaggeration: 2, sky: 'auto', night: 0, altitude: 0, azimuth: 0,
    shown: null, lastUpdate: 0, cycle0: performance.now(), ready: false, installing: false,
  };
  const canvas = document.createElement('canvas');
  canvas.width = SHADE.w; canvas.height = SHADE.h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SHADE.w, SHADE.h);
  // Latitude of each canvas row: the canvas source stretches linearly in Web Mercator
  const rowLat = Array.from({ length: SHADE.h }, (_, j) => {
    const y = mercY(SHADE.north) + ((mercY(SHADE.south) - mercY(SHADE.north)) * (j + 0.5)) / SHADE.h;
    return invMercY(y);
  });
  const colLon = Array.from({ length: SHADE.w }, (_, i) => SHADE.west + ((SHADE.east - SHADE.west) * (i + 0.5)) / SHADE.w);

  function install() {
    if (S.ready || S.installing) return;
    S.installing = true; // adding sources fires 'styledata' synchronously; don't re-enter
    try {
      const dem = { type: 'raster-dem', tiles: [TERRARIUM], tileSize: 256, encoding: 'terrarium', maxzoom: 12 }; // credited in CONFIG.credits.terrain
      if (!map.getSource('emberline-dem')) map.addSource('emberline-dem', dem);
      if (!map.getSource('emberline-hillshade-dem')) map.addSource('emberline-hillshade-dem', dem);
      if (!map.getSource('emberline-daylight')) {
        map.addSource('emberline-daylight', {
          type: 'canvas', canvas, animate: true,
          coordinates: [[SHADE.west, SHADE.north], [SHADE.east, SHADE.north], [SHADE.east, SHADE.south], [SHADE.west, SHADE.south]],
        });
      }
      const beforeLabels = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      if (!map.getLayer('emberline-hillshade')) {
        map.addLayer({
          id: 'emberline-hillshade', type: 'hillshade', source: 'emberline-hillshade-dem',
          paint: {
            'hillshade-exaggeration': 0.55, 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': 315,
            'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#3a4152', 'hillshade-accent-color': '#05060a',
          },
        }, beforeLabels);
      }
      if (!map.getLayer('emberline-daylight')) {
        map.addLayer({ id: 'emberline-daylight', type: 'raster', source: 'emberline-daylight', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } }, beforeLabels);
      }
      S.ready = true;
    } catch (err) {
      console.warn('Scene install will retry:', err.message);
    } finally {
      S.installing = false;
    }
    if (S.ready) { applyTerrain(); update(performance.now(), true); }
  }
  // Install as soon as the style is ready (the 'load' event also waits for every tile)
  // The style definition is enough; isStyleLoaded() also waits for basemap tiles
  const styleReady = () => map.style?._loaded ?? map.isStyleLoaded();
  const tryInstall = () => {
    if (S.ready || !styleReady()) return;
    install();
    if (S.ready) map.off('styledata', tryInstall);
  };
  map.on('styledata', tryInstall);
  map.once('style.load', tryInstall);
  map.once('load', tryInstall);

  function applyTerrain() {
    if (!S.ready) return;
    map.setTerrain(S.terrain ? { source: 'emberline-dem', exaggeration: S.exaggeration } : null);
  }

  /** The instant whose sunlight is drawn. */
  function lightingDate(now) {
    const mode = getMode();
    const day = getDate() ?? new Date();
    if (S.sky === 'day') return atLocalTime(day, 13);
    if (S.sky === 'night') return atLocalTime(day, 1.5);
    if (S.sky === 'golden') return goldenHour(day);
    if (mode === 'live') return new Date();
    const hours = (7 + (((now - S.cycle0) / CYCLE_MS) * 24)) % 24; // the cycle starts at 07:00
    return atLocalTime(day, hours);
  }
  function goldenHour(day) {
    // The evening moment the sun sits ~4° above the horizon at the province's centre
    let best = atLocalTime(day, 19), err = Infinity;
    for (let h = 15; h <= 22.5; h += 1 / 12) {
      const d = atLocalTime(day, h);
      const e = Math.abs(sunAltitude(solarTerms(d), CENTER[1], CENTER[0]) - 4);
      if (e < err) { err = e; best = d; }
    }
    return best;
  }

  function drawShade(terms) {
    const px = img.data;
    for (let j = 0; j < SHADE.h; j++) {
      const lat = rowLat[j];
      for (let i = 0; i < SHADE.w; i++) {
        const alt = sunAltitude(terms, lat, colLon[i]);
        const night = smooth(3, -14, alt) * 0.62;             // deep blue-black after dusk
        const warm = Math.max(0, 1 - Math.abs(alt - 1.5) / 7.5) * 0.2; // orange band at the terminator
        const day = smooth(4, 20, alt) * 0.075;               // faint cool daylight lift
        const edge = Math.min(1, Math.min(i, j, SHADE.w - 1 - i, SHADE.h - 1 - j) / SHADE.feather);
        const a = Math.min(0.85, night + warm + day);
        const k = (j * SHADE.w + i) * 4;
        if (a * edge < 0.004) { px[k + 3] = 0; continue; }
        px[k] = (255 * warm + 150 * day) / a;
        px[k + 1] = (110 * warm + 175 * day + 4 * night) / a;
        px[k + 2] = (45 * warm + 215 * day + 22 * night) / a;
        px[k + 3] = a * edge * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function applyLight() {
    const alt = S.altitude, low = smooth(25, 2, alt), night = S.night;
    map.setPaintProperty('emberline-hillshade', 'hillshade-illumination-direction', Math.round(S.azimuth) % 360);
    map.setPaintProperty('emberline-hillshade', 'hillshade-exaggeration', +(0.38 + 0.4 * low - 0.25 * night).toFixed(2));
    map.setPaintProperty('emberline-hillshade', 'hillshade-highlight-color', hex(mix(mix([58, 65, 82], [120, 78, 52], low), [24, 30, 46], night)));
    if (typeof map.setSky === 'function') {
      map.setSky({
        'sky-color': hex(mix(mix([24, 40, 66], [52, 34, 54], low), [3, 5, 12], night)),
        'horizon-color': hex(mix(mix([60, 80, 110], [232, 116, 58], low), [70, 24, 10], night)), // night horizon glows with fire
        'fog-color': '#06070a', 'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.35,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
      });
    }
  }

  /** Call every frame; recomputes lighting at most 10 times a second. */
  function update(now, force = false) {
    if (!S.ready || (!force && now - S.lastUpdate < 100)) return;
    S.lastUpdate = now;
    const d = lightingDate(now);
    const terms = solarTerms(d);
    const c = sunAt(terms, CENTER[1], CENTER[0]);
    S.shown = d; S.altitude = c.altitude; S.azimuth = c.azimuth;
    S.night = smooth(2, -12, c.altitude);
    drawShade(terms);
    applyLight();
    renderClock();
  }

  function renderClock() {
    const el = document.getElementById('sky-clock');
    if (!el || !S.shown) return;
    const icon = S.altitude > 0 ? '☀' : S.altitude > -12 ? '◐' : '☾';
    el.textContent = `${icon} ${localClock(S.shown)} CST${getMode() === 'live' && S.sky === 'auto' ? ' · now' : ''}`;
  }

  // Controls
  const $ = (id) => document.getElementById(id);
  $('terrain')?.addEventListener('change', (e) => { S.terrain = e.target.checked; applyTerrain(); });
  $('relief')?.addEventListener('input', (e) => {
    S.exaggeration = Number(e.target.value);
    $('relief-out').textContent = `${S.exaggeration}×`;
    applyTerrain();
  });
  document.querySelectorAll('#sky button').forEach((b) => b.addEventListener('click', () => {
    S.sky = b.dataset.sky;
    document.querySelectorAll('#sky button').forEach((x) => x.classList.toggle('on', x === b));
    update(performance.now(), true);
  }));

  return {
    state: S, update,
    /** 0 in daylight, 1 at night, at the province's centre. Fires glow brighter in the dark. */
    get night() { return S.night; },
    setSky(mode) { document.querySelector(`#sky button[data-sky="${mode}"]`)?.click(); },
  };
}
