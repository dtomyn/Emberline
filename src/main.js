// Emberline: app shell, map, animation loop and UI wiring.
import { CONFIG } from './config.js';
import {
  CAUSES, SEASON_START_DOY, SEASON_END_DOY, enrich, lowerBound, summarize, byYear, weeklySeries,
  tToDate, tToISO, seasonT, yearStartT, fmtHa, fmtInt, fmtDate, EPOCH, DAY, displayName,
} from './data.js';
import { CAUSE_COLORS, createCauseDonut, createFireClock, createYearBars, createTimelineCanvas, seasonAxis } from './charts.js';
import { loadActiveIncidents, loadCommunities, loadPerimeters, haversineKm } from './services/live.js';
import { buildStory } from './story.js';
import { createSpreadMode } from './spread-mode.js';
import { createScene } from './scene.js';
import { createLightning, createLiveLightning, buildStorms } from './lightning.js';
import { createSonifier } from './sonify.js';
import { createDocumentary } from './documentary.js';
import { createSourcesView } from './sources-view.js';
import { createSearchMode } from './search-mode.js';
import { prepare as prepareSearch, compile as compileSearch } from './search.js';

const { MapboxOverlay, ScatterplotLayer, HeatmapLayer, HexagonLayer, PathLayer, LineLayer, TextLayer, GeoJsonLayer } = deck;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------------------------------------------------------------- constants
const FIRE_RAMP = [[60, 12, 8], [140, 24, 10], [214, 52, 16], [255, 104, 26], [255, 170, 60], [255, 232, 170]];
const HEAT_RAMP = [[40, 8, 6, 0], [120, 20, 10], [200, 45, 15], [255, 95, 25], [255, 165, 55], [255, 240, 190]];
const STATUS_COLORS = { 'Satellite hotspot': [255, 120, 40], 'Not contained': [255, 64, 40], 'Protecting values': [255, 150, 40], 'Ongoing assessment': [255, 205, 80], Contained: [140, 220, 160], Out: [120, 120, 120], Unknown: [200, 200, 200] };
const SASK_OUTLINE = [[-110.005, 49], [-101.36, 49], [-102.0, 60], [-110.0, 60], [-110.005, 49]];
const SASKATOON_HA = 22_800; // ~228 km²
const CFL_FIELD_HA = 0.6;    // 110 × 65 yd playing field
const ADDITIVE = {
  blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
  depthWriteEnabled: false, depthCompare: 'always',
};

// ---------------------------------------------------------------- state
const state = {
  mode: 'timeline', storyActive: false, storyIndex: 0,
  sources: [], source: null, all: [], filtered: [], ys: [],
  causes: new Set(CAUSES), minSize: 0, yrFrom: 0, yrTo: 0,
  t: 0, playing: false, speed: 21, memory: 'season', lastYear: null,
  viz: 'hex', orbit: false, hexScale: 0,
  live: null, alertKm: 50,
};

// ---------------------------------------------------------------- helpers
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (c1, c2, k) => c1.map((v, i) => lerp(v, c2[i], k));
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}
const seasonDoy = (t) => t - yearStartT(tToDate(t).getUTCFullYear()) + 1;

// ---------------------------------------------------------------- data
async function fetchSources() {
  if (CONFIG.staticDataUrl) return [{ source: 'static', fires: null }];
  const res = await fetch(`${CONFIG.apiBase}/sources`);
  if (!res.ok) throw new Error('The Emberline API is not reachable. Start it with "npm start".');
  return (await res.json()).sources;
}

async function fetchFires(source) {
  if (source === 'static') {
    const res = await fetch(CONFIG.staticDataUrl);
    if (!res.ok) throw new Error(`Could not load ${CONFIG.staticDataUrl}`);
    return enrich(await res.json());
  }
  const res = await fetch(`${CONFIG.apiBase}/fires?source=${encodeURIComponent(source)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  const { columns: c } = await res.json();
  return enrich(c.fire_id.map((id, i) => ({
    fire_id: id, ignition_date: c.ignition_date[i], size_ha: c.size_ha[i], latitude: c.latitude[i],
    longitude: c.longitude[i], general_cause: c.general_cause[i], fire_name: c.fire_name[i],
    out_date: c.out_date?.[i] ?? null, protection_zone: c.protection_zone?.[i] ?? null,
  })));
}

const SOURCE_LABELS = { cnfdb: 'CNFDB: National Fire Database (real)', spsa: 'SPSA historical export (real)', mock: 'Synthetic demo data', static: 'Static JSON file' };

async function useSource(source) {
  state.source = source;
  state.all = prepareSearch(await fetchFires(source));
  state.searchFilter = null;
  const years = [...new Set(state.all.map((f) => f.year))].sort((a, b) => a - b);
  const yearly = byYear(state.all, years);
  // Default to the continuous record (years with ≥100 fires; CNFDB is sparse before 1981)
  const firstFull = yearly.find((y) => y.count >= 100)?.year ?? years[0];
  state.minYear = years[0];
  state.maxYear = years[years.length - 1];
  state.yrFrom = firstFull;
  state.yrTo = state.maxYear;
  state.storms = buildStorms(state.all).storms;
  rebuildStory();
  for (const id of ['#yr-from', '#yr-to']) Object.assign($(id), { min: state.minYear, max: state.maxYear, step: 1 });
  $('#yr-from').value = state.yrFrom;
  $('#yr-to').value = state.yrTo;
  $('#about-source').textContent = `Loaded: ${SOURCE_LABELS[source] ?? source}, ${fmtInt(state.all.length)} fires, ${state.minYear}–${state.maxYear}.`;
  applyFilters();
  renderSearchApplied();
  state.t = seasonT(state.yrFrom, SEASON_START_DOY);
  finder.refresh();
}

/** The guided story (and documentary script), rebuilt when the dataset or the spread list changes. */
function rebuildStory() {
  if (state.all.length) state.story = buildStory(state.all, displayName, { storms: state.storms, spread: state.spreadList ?? [] });
}

function applyFilters({ keepTime = true } = {}) {
  const minHa = state.minSize > 0 ? 10 ** state.minSize : 0;
  const fromSearch = state.searchFilter?.test ?? (() => true); // "Replay these" / "Explore in 3D" from Search
  state.filtered = state.all.filter((f) => state.causes.has(f.general_cause) && f.size_ha >= minHa && fromSearch(f));
  state.ys = [];
  for (let y = state.yrFrom; y <= state.yrTo; y++) state.ys.push(y);
  state.exploreData = state.filtered.filter((f) => f.year >= state.yrFrom && f.year <= state.yrTo);
  state.axis = seasonAxis(state.ys);
  timeline.draw(weeklySeries(state.filtered, state.ys), state.ys);
  lightning.setFires(state.filtered);
  if (!keepTime || state.t < seasonT(state.yrFrom, SEASON_START_DOY) || state.t > seasonT(state.yrTo, SEASON_END_DOY)) {
    state.t = seasonT(state.yrFrom, SEASON_START_DOY);
  }
  $('#yr-out').textContent = state.yrFrom === state.yrTo ? `${state.yrFrom}` : `${state.yrFrom}–${state.yrTo}`;
  $('#size-out').textContent = minHa ? `≥ ${fmtHa(minHa)} ha` : 'any';
  $('#yearbars').classList.toggle('dense', state.ys.length > 30);
  scarCache.key = null;
  dirty = true;
  updateStats(true);
}

// ---------------------------------------------------------------- map
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [-104, 52.5], zoom: 3.3, pitch: 0, bearing: 0,
  minZoom: 3, maxZoom: 12, maxPitch: 70, attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
const overlay = new MapboxOverlay({ interleaved: false, layers: [], getTooltip });
map.addControl(overlay);
map.on('load', () => {
  // Push the basemap further into the dark so the fire glows
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#06070a');
    if (layer.id.includes('water') && layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', '#0f1824');
  }
});
map.on('dragstart', () => { if (state.orbit) setOrbit(false); });
map.on('move', () => { if (map.getTerrain()) dirty = true; }); // the terrain lift follows the map centre
const spread = createSpreadMode({ map, toast, displayName, onOpen: (f) => { if (state.mode === 'spread') history.replaceState(null, '', `#spread/${f.id}`); } });
const spreadIds = () => (state.spreadIdSet ??= new Set((state.spreadList ?? []).map((f) => f.cnfdb_fire_id).filter(Boolean)));
const finder = createSearchMode({
  map, toast, openCard: (f, fly) => openCard(f, fly),
  getFires: () => state.all,
  getCommunities: () => state.live?.communities ?? [],
  getSpreadIds: spreadIds,
  onUse: (mode, s) => useSearch(mode, s),
});
// The sun is drawn for the day on screen: the replay date, the spread date, or today
const scene = createScene({
  map, getMode: () => state.mode,
  getDate: () => (state.mode === 'timeline' ? new Date(EPOCH + Math.floor(state.t) * DAY + 12 * 3600000) : state.mode === 'spread' ? spread.date : new Date()),
});
const sound = createSonifier();
const lightning = createLightning({
  onStrike: ({ intensity }) => {
    sound.thunder(intensity);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const el = $('#sky-flash');
      el.style.setProperty('--flash', String(0.05 + 0.1 * intensity));
      el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    }
  },
});
const liveLightning = createLiveLightning({ map, statusEl: $('#cldn-status') });

const outlineLayer = () => [
  new PathLayer({ id: 'sk-glow', data: [{ path: SASK_OUTLINE }], getPath: (d) => d.path, getColor: [255, 120, 40, 40], widthMinPixels: 8, parameters: ADDITIVE }),
  new PathLayer({ id: 'sk-line', data: [{ path: SASK_OUTLINE }], getPath: (d) => d.path, getColor: [255, 170, 90, 150], widthMinPixels: 1.2 }),
];

// ---------------------------------------------------------------- layers: replay
const scarCache = { key: null, data: [] };
function timelineLayers(now) {
  const t = state.t;
  const year = tToDate(t).getUTCFullYear();
  const f = state.filtered;
  const end = lowerBound(f, t + 1e-6);
  const memStart = state.memory === 'season' ? yearStartT(year) : seasonT(state.yrFrom, 1);
  const recentStart = lowerBound(f, t - 30);
  const startIdx = lowerBound(f, memStart);
  const key = `${startIdx}|${recentStart}|${state.memory}`;
  if (scarCache.key !== key) {
    scarCache.key = key;
    scarCache.data = f.slice(startIdx, Math.max(startIdx, recentStart));
  }
  const active = f.slice(Math.max(startIdx, recentStart), end);
  const pulse = now / 1000;

  const growth = (d) => {
    const age = t - d.t;
    const days = 1.5 + Math.log10(d.size_ha + 1) * 3.5;
    const p = clamp(age / days, 0, 1);
    return Math.sqrt(1 - (1 - p) ** 3);
  };
  const heat = (age) => (age < 2 ? mix([255, 250, 225], [255, 205, 110], age / 2) : age < 10 ? mix([255, 205, 110], [255, 110, 30], (age - 2) / 8) : mix([255, 110, 30], [190, 35, 15], clamp((age - 10) / 20, 0, 1)));
  const fade = (age) => (age < 12 ? 1 : clamp(1 - (age - 12) / 18, 0, 1));
  const flicker = (d) => 0.82 + 0.18 * Math.sin(pulse * 9 + d.t * 13.7) * Math.sin(pulse * 3.1 + d.radius);
  const glowK = 1 + 0.55 * scene.night; // fires read brighter in the dark

  return [
    new ScatterplotLayer({
      id: 'scars', data: scarCache.data, getPosition: (d) => d.position, getRadius: (d) => d.radius,
      radiusMinPixels: 1, stroked: true, lineWidthMinPixels: 0.6, pickable: true,
      getFillColor: (d) => [255, 72, 28, state.memory === 'all' ? clamp(110 * 0.88 ** (year - d.year), 22, 110) : 95],
      getLineColor: (d) => [255, 140, 60, state.memory === 'all' ? clamp(150 * 0.85 ** (year - d.year), 25, 150) : 130],
      updateTriggers: { getFillColor: [year, state.memory], getLineColor: [year, state.memory] },
    }),
    new ScatterplotLayer({
      id: 'halo', data: active, getPosition: (d) => d.position,
      getRadius: (d) => d.radius * growth(d) * 1.9 + 2500, radiusMinPixels: 6,
      getFillColor: (d) => { const a = t - d.t; return [...heat(a), Math.min(255, 70 * glowK * fade(a) * flicker(d))]; },
      parameters: ADDITIVE, updateTriggers: { getRadius: t, getFillColor: [t, pulse] },
    }),
    new ScatterplotLayer({
      id: 'core', data: active, getPosition: (d) => d.position, pickable: true,
      getRadius: (d) => d.radius * growth(d), radiusMinPixels: 2.2,
      getFillColor: (d) => { const a = t - d.t; return [...heat(a), Math.min(255, 235 * glowK * fade(a) * flicker(d) + 20)]; },
      parameters: ADDITIVE, updateTriggers: { getRadius: t, getFillColor: [t, pulse] },
    }),
    new ScatterplotLayer({
      id: 'shock', data: active.filter((d) => t - d.t < 2.5), getPosition: (d) => d.position,
      radiusUnits: 'pixels', getRadius: (d) => 3 + (t - d.t) * 16, filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 1.5,
      getLineColor: (d) => [255, 230, 170, 255 * (1 - (t - d.t) / 2.5)], parameters: ADDITIVE,
      updateTriggers: { getRadius: t, getLineColor: t },
    }),
  ];
}

// ---------------------------------------------------------------- layers: explore
function exploreLayers() {
  const data = state.exploreData;
  if (state.viz === 'hex') {
    return [new HexagonLayer({
      id: 'hex', data, getPosition: (d) => d.position, radius: 12000, coverage: 0.86, extruded: true,
      getElevationWeight: (d) => Math.sqrt(d.size_ha), elevationAggregation: 'SUM', elevationRange: [0, 1000], elevationScale: state.hexScale,
      getColorWeight: (d) => d.size_ha, colorAggregation: 'SUM', colorScaleType: 'quantile', colorRange: FIRE_RAMP,
      upperPercentile: 100, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 90],
      material: { ambient: 0.55, diffuse: 0.7, shininess: 40, specularColor: [255, 200, 150] },
      updateTriggers: { getElevationWeight: state.source, getColorWeight: state.source },
    })];
  }
  if (state.viz === 'heat') {
    return [new HeatmapLayer({
      id: 'heat', data, getPosition: (d) => d.position, getWeight: (d) => Math.log10(d.size_ha + 1) + 0.25,
      radiusPixels: 32, intensity: 1.15, threshold: 0.04, colorRange: HEAT_RAMP, aggregation: 'SUM',
    })];
  }
  return [new ScatterplotLayer({
    id: 'dots', data, getPosition: (d) => d.position, getRadius: (d) => d.radius, radiusMinPixels: 1.1, pickable: true,
    getFillColor: (d) => [...hex(CAUSE_COLORS[d.causeIdx]), 120], stroked: true, lineWidthMinPixels: 0.5,
    getLineColor: (d) => [...hex(CAUSE_COLORS[d.causeIdx]), 200], parameters: ADDITIVE, autoHighlight: true, highlightColor: [255, 255, 255, 160],
  })];
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// ---------------------------------------------------------------- layers: live
function liveLayers(now) {
  const L = state.live;
  if (!L) return [];
  const pulse = (now / 1000) % 2;
  const burning = L.incidents.filter((i) => i.status !== 'Out');
  const urgent = burning.filter(isUrgent);
  return [
    new GeoJsonLayer({
      id: 'perimeters', data: L.perimeters ?? [], filled: true, stroked: true, getFillColor: [255, 70, 30, 60],
      getLineColor: [255, 150, 70, 220], lineWidthMinPixels: 1.2, pickable: true,
    }),
    new ScatterplotLayer({
      id: 'alert-radius', data: urgent, getPosition: (d) => [d.longitude, d.latitude], getRadius: state.alertKm * 1000,
      filled: true, getFillColor: [255, 60, 30, 10], stroked: true, getLineColor: [255, 90, 50, 70], lineWidthMinPixels: 1,
      updateTriggers: { getRadius: state.alertKm },
    }),
    new LineLayer({
      id: 'threat-lines', data: L.threatLinks ?? [], getSourcePosition: (d) => d.from, getTargetPosition: (d) => d.to,
      getColor: [255, 120, 60, 90 + 80 * Math.sin(now / 300)], getWidth: 1.2, widthMinPixels: 1, parameters: ADDITIVE,
      updateTriggers: { getColor: Math.round(now / 50) },
    }),
    new ScatterplotLayer({
      id: 'communities', data: L.communities ?? [], getPosition: (d) => [d.longitude, d.latitude],
      getRadius: (d) => (L.threatened?.has(d.name) ? 5 : 2.5), radiusUnits: 'pixels', pickable: true,
      getFillColor: (d) => (L.threatened?.has(d.name) ? [255, 255, 255, 255] : [200, 210, 230, 140]),
      updateTriggers: { getRadius: state.alertKm, getFillColor: state.alertKm },
    }),
    new TextLayer({
      id: 'community-labels', data: (L.communities ?? []).filter((c) => L.threatened?.has(c.name)),
      getPosition: (d) => [d.longitude, d.latitude], getText: (d) => d.name, getSize: 12, getColor: [255, 236, 210, 230],
      getPixelOffset: [0, -14], fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, outlineWidth: 3, outlineColor: [0, 0, 0, 200],
      fontSettings: { sdf: true }, updateTriggers: { getText: state.alertKm },
    }),
    new ScatterplotLayer({
      id: 'incident-pulse', data: burning, getPosition: (d) => [d.longitude, d.latitude], radiusUnits: 'pixels',
      getRadius: (d) => 6 + pulse * 14 + Math.min(10, Math.log10(d.size_ha + 1) * 2), filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2,
      getLineColor: (d) => [...STATUS_COLORS[d.status], 220 * (1 - pulse / 2)], parameters: ADDITIVE,
      updateTriggers: { getRadius: pulse, getLineColor: pulse },
    }),
    new ScatterplotLayer({
      id: 'incidents', data: burning, getPosition: (d) => [d.longitude, d.latitude], pickable: true,
      getRadius: (d) => Math.sqrt((d.size_ha * 10000) / Math.PI), radiusMinPixels: 4,
      getFillColor: (d) => [...STATUS_COLORS[d.status], 230], stroked: true, getLineColor: [255, 255, 255, 200], lineWidthMinPixels: 1,
      parameters: ADDITIVE,
    }),
  ];
}

const isUrgent = (i) => i.status === 'Not contained' || i.status === 'Protecting values' || i.status === 'Satellite hotspot';

function computeThreats() {
  const L = state.live;
  if (!L) return;
  const urgent = L.incidents.filter(isUrgent);
  const links = [];
  const nearest = new Map();
  for (const c of L.communities ?? []) {
    for (const i of urgent) {
      const km = haversineKm(c.latitude, c.longitude, i.latitude, i.longitude);
      if (km <= state.alertKm) {
        links.push({ from: [i.longitude, i.latitude], to: [c.longitude, c.latitude] });
        const prev = nearest.get(c.name);
        if (!prev || km < prev.km) nearest.set(c.name, { community: c, incident: i, km });
      }
    }
  }
  L.threatLinks = links;
  L.threatened = new Set(nearest.keys());
  L.threatList = [...nearest.values()].sort((a, b) => a.km - b.km);
  renderThreatList();
}

function renderThreatList() {
  const L = state.live;
  const el = $('#threats');
  if (!L) { el.innerHTML = ''; return; }
  const list = L.threatList ?? [];
  el.innerHTML = `<h3>Communities within ${state.alertKm} km of an active fire or hotspot</h3>` +
    (list.length
      ? list.slice(0, 40).map((x, i) => `<div class="threat" data-i="${i}"><span>${x.community.name} <small class="muted">${x.community.kind}</small></span><span>${Math.round(x.km)} km</span></div>`).join('')
      : `<p class="muted" style="font-size:13px">None right now.</p>`);
  el.querySelectorAll('.threat').forEach((row) => row.addEventListener('click', () => {
    const x = list[row.dataset.i];
    map.flyTo({ center: [x.community.longitude, x.community.latitude], zoom: 8, pitch: 40, duration: 2200 });
  }));
}

async function refreshLive(force = false) {
  $('#live-source').innerHTML = 'Connecting to SPSA services…';
  let body;
  try {
    const res = await fetch(`${CONFIG.apiBase}/live${force ? '?refresh' : ''}`);
    if (!res.ok) throw new Error();
    body = await res.json();
  } catch {
    // No server: resolve live sources directly from the browser (SPSA's server sends CORS headers)
    const [inc, com, perimeters] = await Promise.all([loadActiveIncidents(state.all), loadCommunities(), loadPerimeters().catch(() => [])]);
    body = { ...inc, ...com, perimeters, fetchedAt: new Date().toISOString() };
  }
  state.live = body;
  computeThreats();
  finder.communitiesChanged();
  const lis = body.log.map((l) => `<li class="${l.ok ? 'ok' : 'bad'}">${l.source}: ${l.ok ? `${l.n ?? 0}${l.note ? `, ${l.note}` : ''}` : l.error}</li>`).join('');
  $('#live-source').innerHTML = `
    <div class="src">${body.label} <span class="badge ${body.simulated ? '' : 'real'}">${body.simulated ? 'SIMULATED' : 'LIVE'}</span></div>
    ${fmtInt(body.incidents.length)} incidents · ${fmtInt(body.perimeters?.length ?? 0)} satellite perimeters · ${fmtInt(body.communities?.length ?? 0)} SPSA communities<br/>
    <small>Fetched ${new Date(body.fetchedAt).toLocaleTimeString()}</small>
    <ul>${lis}</ul>`;
  if (body.simulated && state.mode === 'live') toast('Off-season: no active incidents published. Showing a labelled simulation.');
  dirty = true;
  updateStats(true);
}

// ---------------------------------------------------------------- render loop
let dirty = true, lastFrame = performance.now(), lastStats = 0;
function frame(now) {
  requestAnimationFrame(frame); // schedule first, so one bad frame can't stop the animation
  const dt = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000));
  lastFrame = now;
  const prevT = state.t;
  if (state.playing && state.mode === 'timeline') advance(dt * state.speed);
  if (state.mode === 'timeline' && state.playing) seasonEvents(prevT, state.t, now, dt);
  scene.update(now);
  if (state.mode === 'live') liveLightning.tick(now);
  if (state.orbit && state.mode === 'explore') map.setBearing(map.getBearing() + dt * 5);
  if (state.mode === 'explore' && state.viz === 'hex' && state.hexScale < 60) { state.hexScale = Math.min(60, state.hexScale + dt * 70); dirty = true; }
  tickCounters(dt);
  const animated = state.mode === 'timeline' || state.mode === 'live' || state.mode === 'spread' || state.mode === 'search';
  if (animated || dirty) {
    const layers = [...outlineLayer()];
    if (state.mode === 'timeline') layers.push(...lightning.under(now), ...timelineLayers(now), ...lightning.over(now, ADDITIVE, map.getZoom(), map.getCenter().lat));
    else if (state.mode === 'explore') layers.push(...exploreLayers());
    else if (state.mode === 'live') layers.push(...liveLayers(now));
    else if (state.mode === 'spread') layers.push(...spread.layers(now, dt));
    else if (state.mode === 'search') layers.push(...finder.layers(now, dt));
    // With 3D terrain, deck.gl still draws at sea level: lift everything to the ground height at
    // the map centre so fires sit on the terrain (residual error is the local height difference)
    const lift = map.getTerrain() ? map.transform.elevation || 0 : 0;
    overlay.setProps({ layers: lift ? layers.map((l) => l.clone({ modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, lift, 1] })) : layers });
    dirty = false;
  }
  if (now - lastStats > 120) { updateStats(); lastStats = now; }
  updatePlayhead();
}

// Lightning strikes and notes for ignitions crossed this frame (skipped for scrubs and season jumps)
function seasonEvents(prevT, t, now, dt) {
  if (!(t > prevT) || t - prevT > 20) return;
  lightning.tick(prevT, t, now, state.speed);
  if (!sound.enabled) return;
  const f = state.filtered;
  sound.ignitions(f.slice(lowerBound(f, prevT + 1e-9), lowerBound(f, t + 1e-9)), dt);
  const r0 = lowerBound(f, t - 14), r1 = lowerBound(f, t + 1e-9);
  let ha = 0;
  for (let i = r0; i < r1; i++) ha += f[i].size_ha;
  sound.ambience(r1 - r0, ha);
}

function advance(days) {
  let t = state.t + days;
  const d = tToDate(t);
  const y = d.getUTCFullYear();
  if (seasonDoy(t) > SEASON_END_DOY || seasonDoy(t) < SEASON_START_DOY) {
    const next = seasonDoy(t) > SEASON_END_DOY ? y + 1 : y;
    if (next > state.yrTo) { setPlaying(false); t = seasonT(state.yrTo, SEASON_END_DOY); }
    else t = seasonT(next, SEASON_START_DOY);
  }
  state.t = t;
}

function setPlaying(on) {
  state.playing = on;
  if (!on) sound.silence();
  $('#play').classList.toggle('playing', on);
  $('#play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  if (on && state.t >= seasonT(state.yrTo, SEASON_END_DOY) - 1) state.t = seasonT(state.yrFrom, SEASON_START_DOY);
}

function updatePlayhead() {
  if (!state.axis) return;
  const d = tToDate(state.t);
  const y = d.getUTCFullYear();
  const x = state.axis.toX(y, seasonDoy(state.t));
  const w = $('#track').clientWidth;
  $('#playhead').style.transform = `translateX(${x * w}px)`;
  $('#playhead-label').textContent = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  if (state.mode === 'timeline') {
    $('#date-year').textContent = y;
    $('#date-day').textContent = d.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', timeZone: 'UTC' });
    if (state.lastYear !== null && y !== state.lastYear && state.playing) {
      const flash = $('#year-flash');
      flash.textContent = y;
      flash.classList.remove('show');
      void flash.offsetWidth;
      flash.classList.add('show');
    }
    state.lastYear = y;
  }
}

// ---------------------------------------------------------------- stats panel
const donut = createCauseDonut($('#donut'));
const clock = createFireClock($('#clock'));
const yearBars = createYearBars($('#yearbars'), (year) => {
  if (state.mode === 'explore') { state.yrFrom = state.yrTo = year; syncYearInputs(); applyFilters(); }
  else { setMode('timeline'); state.t = seasonT(year, SEASON_START_DOY); scarCache.key = null; setPlaying(true); }
});
const timeline = createTimelineCanvas($('#tl-canvas'));
const counters = { fires: { v: 0, target: 0 }, ha: { v: 0, target: 0 }, active: { v: 0, target: 0 } };
function tickCounters(dt) {
  for (const [k, c] of Object.entries(counters)) {
    c.v = Math.abs(c.target - c.v) < 0.5 ? c.target : lerp(c.v, c.target, 1 - Math.exp(-dt * 8));
    const el = $(`#k-${k}`);
    const text = k === 'ha' ? fmtHa(c.v) : fmtInt(c.v);
    if (el.textContent !== text) el.textContent = text;
  }
}

let statsKey = '';
function updateStats(force = false) {
  if (state.mode === 'spread' || state.mode === 'search') return; // those panels keep their own figures
  let list, active = 0, highlightMonth = -1, activeYear = null;
  if (state.mode === 'timeline') {
    const d = tToDate(state.t);
    const y = d.getUTCFullYear();
    activeYear = y;
    highlightMonth = d.getUTCMonth();
    const s = lowerBound(state.filtered, yearStartT(y)), e = lowerBound(state.filtered, state.t + 1e-6);
    list = state.filtered.slice(s, e);
    active = e - lowerBound(state.filtered, state.t - 14);
    $('#k-fires-l').textContent = `fires in ${y}`;
    $('#k-active-l').textContent = 'started in last 14 days';
  } else if (state.mode === 'live' && state.live) {
    const inc = state.live.incidents;
    list = [];
    active = inc.filter((i) => i.status === 'Not contained').length;
    counters.fires.target = inc.length;
    counters.ha.target = inc.reduce((s, i) => s + i.size_ha, 0);
    counters.active.target = active;
    $('#k-fires-l').textContent = 'active incidents';
    $('#k-active-l').textContent = 'not contained';
    $('#largest').innerHTML = '';
    return;
  } else {
    list = state.exploreData ?? [];
    $('#k-fires-l').textContent = 'fires';
    $('#k-active-l').textContent = 'seasons';
    active = state.ys.length;
  }
  const key = `${state.mode}|${list.length}|${active}|${state.filtered.length}|${state.yrFrom}|${state.yrTo}`;
  if (!force && key === statsKey) return;
  statsKey = key;
  const s = summarize(list);
  counters.fires.target = s.count;
  counters.ha.target = s.ha;
  counters.active.target = active;
  donut(s);
  clock(s, highlightMonth);
  yearBars(byYear(state.filtered, state.ys), activeYear);
  $('#largest').innerHTML = s.largest
    ? `Largest${state.mode === 'timeline' ? ' so far' : ''}: <button data-fire="${s.largest.fire_id}">${displayName(s.largest)}</button>, <b>${fmtHa(s.largest.size_ha)} ha</b>, ${fmtDate(s.largest.ignition_date)} · ${s.largest.general_cause}`
    : '<span class="muted">No fires yet this season.</span>';
  $('#largest button')?.addEventListener('click', () => openCard(s.largest, true));
}

// ---------------------------------------------------------------- tooltips & detail card
function getTooltip({ object, layer, index }) {
  if (layer?.id.startsWith('spread-')) return spread.tooltip({ object, layer, index });
  if (layer?.id.startsWith('sx-')) return finder.tooltip({ object, layer, index });
  if (!object || !layer) return null;
  const id = layer.id;
  if (id === 'hex') {
    const pts = object.points ?? [];
    const n = object.count ?? pts.length;
    const ha = object.colorValue ?? pts.reduce((s, p) => s + (p.source ?? p).size_ha, 0);
    return { html: `<b>${fmtInt(n)} fires</b><br/>${fmtHa(ha)} ha burned<br/><small>12 km cell</small>`, className: 'deck-tooltip' };
  }
  if (id === 'perimeters') return { html: `<b>Satellite fire perimeter</b><br/>${fmtHa(Number(object.properties?.area) || 0)} ha<br/><small>CWFIS M3 · last seen ${object.properties?.lastdate?.slice(0, 10) ?? ''}</small>`, className: 'deck-tooltip' };
  if (id === 'communities') return { html: `<b>${object.name}</b><br/><small>${object.kind} · SPSA live layer</small>`, className: 'deck-tooltip' };
  if (id === 'incidents') return { html: `<b>${object.name ?? object.id}</b><br/>${object.status}<br/>${fmtHa(object.size_ha)} ha${object.start ? ` · since ${fmtDate(object.start)}` : ''}`, className: 'deck-tooltip' };
  if (object.fire_id) return { html: `<b>${displayName(object)}</b><br/>${fmtDate(object.ignition_date)} · ${object.general_cause}<br/>${fmtHa(object.size_ha)} ha<br/><small>click for details</small>`, className: 'deck-tooltip' };
  return null;
}

map.on('click', (e) => {
  if (finder.consumeClick()) return; // the click dropped a search pin
  const info = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 4 });
  if (info?.object?.fire_id) { openCard(info.object); if (state.mode === 'search') finder.select(info.object); }
  else if (!info) closeCard();
});

function compare(ha) {
  if (ha < 300) return `≈ <b>${fmtInt(Math.max(1, ha / CFL_FIELD_HA))}</b> CFL football fields`;
  const k = ha / SASKATOON_HA;
  return k < 1 ? `≈ <b>${Math.round(k * 100)}%</b> of the area of Saskatoon` : `≈ <b>${k.toFixed(k < 10 ? 1 : 0)}×</b> the area of Saskatoon`;
}

function openCard(f, fly = false) {
  const card = $('#card');
  let nearest = '';
  const com = state.live?.communities;
  if (com?.length) {
    let best = null;
    for (const c of com) {
      const km = haversineKm(f.latitude, f.longitude, c.latitude, c.longitude);
      if (!best || km < best.km) best = { c, km };
    }
    nearest = `<dt>Nearest community</dt><dd>${best.c.name} · ${Math.round(best.km)} km</dd>`;
  }
  card.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <div class="kicker">${f.general_cause} · ${f.fire_id}</div>
    <h2>${displayName(f)}</h2>
    <dl>
      <dt>Reported</dt><dd>${fmtDate(f.ignition_date)}</dd>
      <dt>Size</dt><dd>${fmtInt(f.size_ha)} ha (${fmtInt(f.size_ha / 100)} km²)</dd>
      <dt>Location</dt><dd>${f.latitude.toFixed(3)}°N, ${Math.abs(f.longitude).toFixed(3)}°W</dd>
      ${nearest}
    </dl>
    <div class="compare">${compare(f.size_ha)}. The burn circle on the map has this same area.</div>
    <div class="actions"><button class="cta small" id="card-replay">▶ Replay this fire</button>${spread.forCnfdb(f.fire_id) ? '<button class="cta small spread-btn" id="card-spread">True spread</button>' : ''}<button class="ghost" id="card-zoom">Zoom in</button></div>`;
  card.hidden = false;
  card.querySelector('.close').onclick = closeCard;
  $('#card-zoom').onclick = () => map.flyTo({ center: f.position, zoom: clamp(11 - Math.log10(f.size_ha + 10) * 1.2, 5.5, 10), pitch: 45, duration: 2500 });
  $('#card-replay').onclick = () => {
    exitStory();
    if (f.year < state.yrFrom || f.year > state.yrTo) { state.yrFrom = Math.min(state.yrFrom, f.year); state.yrTo = Math.max(state.yrTo, f.year); syncYearInputs(); applyFilters(); }
    setMode('timeline');
    state.t = Math.max(seasonT(f.year, SEASON_START_DOY), f.t - 4);
    scarCache.key = null;
    state.speed = 7; syncSpeed();
    setPlaying(true);
    map.flyTo({ center: f.position, zoom: clamp(10 - Math.log10(f.size_ha + 10) * 1.1, 5.5, 9.5), pitch: 40, duration: 2500 });
    closeCard();
  };
  const sp = spread.forCnfdb(f.fire_id);
  if (sp) $('#card-spread').onclick = () => { exitStory(); closeCard(); setMode('spread'); spread.open(sp.id); };
  if (fly) map.flyTo({ center: f.position, zoom: clamp(10.5 - Math.log10(f.size_ha + 10) * 1.1, 5.5, 9.5), duration: 2200 });
}
function closeCard() { $('#card').hidden = true; }

// ---------------------------------------------------------------- search → replay / explore
/** Replay or Explore just the fires a search found (the cause and size controls still apply on top). */
function useSearch(mode, s) {
  state.searchFilter = { test: compileSearch(s.query, { spreadIds: spreadIds() }), parts: s.parts, count: s.count, query: s.query };
  state.yrFrom = clamp(s.from, state.minYear, state.maxYear);
  state.yrTo = clamp(s.to, state.minYear, state.maxYear);
  syncYearInputs();
  applyFilters({ keepTime: false });
  renderSearchApplied();
  closeCard();
  setMode(mode);
  if (mode === 'explore') setViz(state.viz);
  if (mode === 'timeline') {
    // Start a few days before the first match, at a pace that suits how many seasons it spans
    const first = state.filtered.find((f) => f.year >= state.yrFrom);
    if (first) state.t = Math.max(seasonT(first.year, SEASON_START_DOY), first.t - 5);
    state.speed = state.yrTo - state.yrFrom > 3 ? 60 : 21; syncSpeed();
    setPlaying(true);
  }
  toast(`${mode === 'timeline' ? 'Replaying' : 'Exploring'} ${fmtInt(s.count)} fires from your search.`);
}
function renderSearchApplied() {
  const sf = state.searchFilter;
  $('#sx-applied').hidden = !sf;
  if (!sf) return;
  $('#sx-applied-n').textContent = `${fmtInt(sf.count)} fires`;
  $('#sx-applied-q').textContent = sf.parts.length ? sf.parts.join(' · ') : 'All fires';
}
function clearSearchFilter() {
  state.searchFilter = null;
  renderSearchApplied();
  applyFilters();
  if (state.mode === 'explore') setMode('explore');
}

// ---------------------------------------------------------------- modes & story
function setMode(mode) {
  const was = state.mode;
  state.mode = mode;
  document.body.classList.remove('mode-timeline', 'mode-explore', 'mode-live', 'mode-spread', 'mode-search');
  document.body.classList.add(`mode-${mode}`);
  $$('.modes button').forEach((b) => b.setAttribute('aria-selected', String(state.storyActive ? b.dataset.mode === 'story' : b.dataset.mode === mode)));
  const tab = $('.modes [aria-selected="true"]'); // on narrow screens the tab bar scrolls
  if (tab && tab.parentElement.scrollWidth > tab.parentElement.clientWidth) tab.parentElement.scrollTo({ left: tab.offsetLeft - 40, behavior: 'smooth' });
  if (mode !== 'timeline') setPlaying(false);
  if (mode === 'explore') {
    state.hexScale = 0;
    $('#date-year').textContent = state.yrFrom === state.yrTo ? state.yrFrom : `${String(state.yrFrom)}–${String(state.yrTo).slice(2)}`;
    $('#date-day').textContent = `${state.ys.length} season${state.ys.length > 1 ? 's' : ''} · ${fmtInt(state.exploreData.length)} fires`;
  }
  if (mode === 'live') {
    $('#date-year').textContent = 'Live';
    $('#date-day').textContent = state.live?.asOf ? `as of ${fmtDate(state.live.asOf)}` : 'connecting…';
    if (!state.live) refreshLive().then(() => { $('#date-day').textContent = `as of ${fmtDate(state.live.asOf)}`; });
    else if (state.live.simulated) toast('Off-season: no active incidents published. Showing a labelled simulation.');
  }
  if (mode !== 'explore') setOrbit(false);
  liveLightning.show(mode === 'live' && $('#cldn-toggle').checked);
  if (mode !== 'timeline') lightning.reset();
  if (mode === 'spread' && was !== 'spread') spread.enter();
  if (mode !== 'spread' && was === 'spread') spread.exit();
  if (mode === 'search' && was !== 'search') finder.enter();
  if (mode !== 'search' && was === 'search') finder.exit();
  scarCache.key = null;
  dirty = true;
  updateStats(true);
  history.replaceState(null, '', `#${state.storyActive ? 'story' : mode === 'spread' ? spread.hash : mode === 'search' ? finder.hash : mode}`);
}

const app = {
  set(opts) {
    if (opts.causes) { state.causes = new Set(opts.causes); syncCauseChips(); }
    if ('minSize' in opts) { state.minSize = opts.minSize; $('#min-size').value = opts.minSize; }
    if (opts.yrFrom) { state.yrFrom = opts.yrFrom; state.yrTo = opts.yrTo; syncYearInputs(); }
    if (opts.viz) setViz(opts.viz);
    if (opts.memory) setMemory(opts.memory);
    if (opts.causes || 'minSize' in opts || opts.yrFrom) applyFilters({ keepTime: false });
    if (opts.mode) setMode(opts.mode);
    if ('orbit' in opts) setOrbit(opts.orbit);
  },
  fly: (cam) => map.flyTo({ ...cam, duration: 3200, essential: true, curve: 1.5 }),
  jump: (t) => { state.t = t; scarCache.key = null; },
  play: (speed) => { if (speed) { state.speed = speed; syncSpeed(); } setPlaying(true); },
  spread: (id) => {
    spread.prefer(id);
    setMode('spread');
    if (spread.state.fire && spread.state.fire.id !== id) spread.open(id);
  },
  /** Freeze whatever is moving (replay, spread, orbit) and return a function that restores it. */
  pause: () => {
    const was = { playing: state.playing, spread: spread.state.playing, orbit: state.orbit };
    setPlaying(false); spread.setPlaying(false); setOrbit(false);
    return () => { if (was.playing) setPlaying(true); if (was.spread) spread.setPlaying(true); if (was.orbit) setOrbit(true); };
  },
};

const doc = createDocumentary({
  app,
  getStory: () => state.story,
  showChapter,
  onStart: () => { closeCard(); state.storyActive = true; document.body.classList.add('story-mode'); $('#story').hidden = false; },
  onStop: () => exitStory(),
  dataset: () => ({ label: SOURCE_LABELS[state.source] ?? state.source, simulated: state.source === 'mock' }),
});

const sources = createSourcesView({ getFires: () => state.all, getLive: () => state.live });

function showChapter(i, { doc = false } = {}) {
  const chapters = state.story.chapters;
  state.storyIndex = clamp(i, 0, chapters.length - 1);
  const ch = chapters[state.storyIndex];
  $('#story-progress').innerHTML = chapters.map((_, k) => `<i class="${k <= state.storyIndex ? 'on' : ''}"></i>`).join('');
  for (const [sel, text] of [['#story-kicker', ch.kicker], ['#story-title', ch.title], ['#story-body', ch.body]]) {
    const el = $(sel);
    el.innerHTML = text;
    el.classList.remove('text-swap'); void el.offsetWidth; el.classList.add('text-swap');
  }
  $('#story-prev').disabled = state.storyIndex === 0;
  $('#story-next').textContent = state.storyIndex === chapters.length - 1 ? 'Finish ✓' : 'Next →';
  ch.apply(app);
  // In the documentary the cues wait for their spoken word; clicking through, they run at once
  if (!doc) ch.cues?.forEach((c) => c.run(app));
}
function enterStory() {
  state.storyActive = true;
  document.body.classList.add('story-mode');
  $('#story').hidden = false;
  closeCard();
  showChapter(0);
}
function exitStory() {
  if (doc.active) { doc.stop(); return; } // stopping the film calls back here
  if (!state.storyActive) return;
  state.storyActive = false;
  document.body.classList.remove('story-mode');
  $('#story').hidden = true;
  setMode(state.mode);
}

// ---------------------------------------------------------------- controls
function setViz(v) { state.viz = v; state.hexScale = 0; $$('#explore-viz button').forEach((b) => b.classList.toggle('on', b.dataset.viz === v)); dirty = true; }
function setOrbit(on) { state.orbit = on; $('#orbit').checked = on; }
function setMemory(m) { state.memory = m; $$('#memory button').forEach((b) => b.classList.toggle('on', b.dataset.mem === m)); scarCache.key = null; }
function syncSpeed() { $$('#speed button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === state.speed)); }
function syncYearInputs() { $('#yr-from').value = state.yrFrom; $('#yr-to').value = state.yrTo; }
function syncCauseChips() { $$('.chip').forEach((c) => c.classList.toggle('on', state.causes.has(c.dataset.cause))); }

function wireControls() {
  $('#sound').addEventListener('click', () => toggleSound());
  $('#lightning-toggle').addEventListener('change', (e) => lightning.setEnabled(e.target.checked));
  $('#cldn-toggle').addEventListener('change', (e) => liveLightning.show(e.target.checked && state.mode === 'live'));
  $('#cldn-refresh').addEventListener('click', () => liveLightning.refresh());
  $('#cause-chips').innerHTML = CAUSES.map((c, i) => `<button class="chip on" data-cause="${c}" style="--c:${CAUSE_COLORS[i]}" aria-pressed="true"><i></i>${c}</button>`).join('');
  $$('.chip').forEach((chip) => chip.addEventListener('click', () => {
    const c = chip.dataset.cause;
    if (state.causes.has(c) && state.causes.size === 1) return; // keep at least one
    state.causes.has(c) ? state.causes.delete(c) : state.causes.add(c);
    chip.setAttribute('aria-pressed', String(state.causes.has(c)));
    syncCauseChips();
    applyFilters();
  }));
  $('#min-size').addEventListener('input', (e) => { state.minSize = Number(e.target.value); applyFilters(); });
  const onYears = (e) => {
    let a = Number($('#yr-from').value), b = Number($('#yr-to').value);
    if (a > b) e.target.id === 'yr-from' ? (b = a) : (a = b);
    state.yrFrom = a; state.yrTo = b;
    syncYearInputs();
    applyFilters();
    if (state.mode === 'explore') setMode('explore');
  };
  $('#yr-from').addEventListener('input', onYears);
  $('#yr-to').addEventListener('input', onYears);
  $$('#explore-viz button').forEach((b) => b.addEventListener('click', () => {
    setViz(b.dataset.viz);
    if (b.dataset.viz === 'hex' && map.getPitch() < 30) map.easeTo({ pitch: 52, bearing: 20, duration: 1500 });
    if (b.dataset.viz !== 'hex' && map.getPitch() > 30) map.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
  }));
  $('#orbit').addEventListener('change', (e) => setOrbit(e.target.checked));
  $$('#memory button').forEach((b) => b.addEventListener('click', () => setMemory(b.dataset.mem)));
  $$('#speed button').forEach((b) => b.addEventListener('click', () => { state.speed = Number(b.dataset.speed); syncSpeed(); }));
  $('#play').addEventListener('click', () => setPlaying(!state.playing));
  $('#alert-radius').addEventListener('input', (e) => { state.alertKm = Number(e.target.value); $('#radius-out').textContent = `${state.alertKm} km`; computeThreats(); dirty = true; });
  $('#live-refresh').addEventListener('click', () => refreshLive(true));
  $('#source').addEventListener('change', async (e) => {
    setPlaying(false);
    toast('Loading dataset…');
    try { await useSource(e.target.value); setMode(state.mode); toast(`${fmtInt(state.all.length)} fires loaded`); } catch (err) { toast(err.message); }
  });
  $$('.modes button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === 'story') { if (!state.storyActive) enterStory(); return; }
    exitStory();
    setMode(b.dataset.mode);
  }));
  $('#story-next').addEventListener('click', () => (state.storyIndex === state.story.chapters.length - 1 ? (exitStory(), setMode('explore')) : showChapter(state.storyIndex + 1)));
  $('#story-prev').addEventListener('click', () => showChapter(state.storyIndex - 1));
  $('#about-btn').addEventListener('click', () => $('#about').showModal());
  $('#sources-btn').addEventListener('click', () => sources.open());
  $('#intro-sources').addEventListener('click', () => sources.open());
  $('#about-sources').addEventListener('click', () => { $('#about').close(); sources.open(); });
  $('#watch').addEventListener('click', () => doc.start());
  $('#sx-applied-clear').addEventListener('click', clearSearchFilter);
  $('#sx-applied-edit').addEventListener('click', () => { const q = state.searchFilter?.query; if (q) finder.setQuery(q, { fit: false }); setMode('search'); });

  // Timeline scrubbing
  const track = $('#track');
  const posToT = (ev) => {
    const r = track.getBoundingClientRect();
    const { year, doy } = state.axis.fromX((ev.clientX - r.left) / r.width);
    return seasonT(year, doy);
  };
  let scrubbing = false, wasPlaying = false;
  track.addEventListener('pointerdown', (ev) => { scrubbing = true; wasPlaying = state.playing; setPlaying(false); track.setPointerCapture(ev.pointerId); state.t = posToT(ev); scarCache.key = null; });
  track.addEventListener('pointermove', (ev) => {
    const t = posToT(ev);
    const tip = $('#hover-tip');
    tip.style.left = `${ev.clientX - track.getBoundingClientRect().left}px`;
    tip.textContent = fmtDate(tToISO(t));
    if (scrubbing) { state.t = t; scarCache.key = null; }
  });
  track.addEventListener('pointerup', () => { scrubbing = false; if (wasPlaying) setPlaying(true); });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || sources.isOpen) return;
    if (doc.active && [' ', 'ArrowRight', 'Escape'].includes(e.key)) {
      e.preventDefault();
      if (e.key === ' ') doc.toggle(); else if (e.key === 'ArrowRight') doc.next(); else exitStory();
      return;
    }
    if ((e.key === 'w' || e.key === 'W') && $('#intro').classList.contains('gone')) doc.start();
    if (e.key === ' ') { e.preventDefault(); e.target.blur?.(); if (state.mode === 'timeline') setPlaying(!state.playing); if (state.mode === 'spread') spread.toggle(); }
    if (e.key === 'ArrowRight' && state.mode === 'timeline') { advance(7); scarCache.key = null; }
    if (e.key === 'ArrowLeft' && state.mode === 'timeline') { state.t = Math.max(seasonT(state.yrFrom, SEASON_START_DOY), state.t - 7); scarCache.key = null; }
    if (e.key === 'ArrowRight' && state.mode === 'spread') spread.step(1);
    if (e.key === 'ArrowLeft' && state.mode === 'spread') spread.step(-1);
    if (['1', '2', '3', '4'].includes(e.key)) { exitStory(); setMode(['timeline', 'spread', 'explore', 'live'][Number(e.key) - 1]); }
    if (e.key === '5') enterStory();
    if (e.key === '/') { e.preventDefault(); exitStory(); setMode('search'); finder.focus(); }
    if (e.key === 'Escape') { closeCard(); exitStory(); }
    if (e.key === 'm' || e.key === 'M') toggleSound();
    if ((e.key === 's' || e.key === 'S') && !doc.active) sources.open();
  });
}

// ---------------------------------------------------------------- intro embers
function startEmbers() {
  const c = $('#embers'), ctx = c.getContext('2d');
  const parts = [];
  const resize = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; };
  resize(); addEventListener('resize', resize);
  const spawn = () => ({ x: Math.random() * c.width, y: c.height + Math.random() * 100, r: (Math.random() * 2.2 + 0.6) * devicePixelRatio, vy: -(0.4 + Math.random() * 1.4) * devicePixelRatio, ph: Math.random() * 6, life: 1 });
  for (let i = 0; i < 160; i++) { const p = spawn(); p.y = Math.random() * c.height; parts.push(p); }
  let running = true;
  const loop = (t) => {
    if (!running) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      p.y += p.vy; p.x += Math.sin(t / 900 + p.ph) * 0.5; p.life -= 0.0016;
      if (p.y < -20 || p.life <= 0) Object.assign(p, spawn());
      const a = Math.max(0, p.life) * (0.6 + 0.4 * Math.sin(t / 120 + p.ph * 5));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      g.addColorStop(0, `rgba(255,220,150,${a})`); g.addColorStop(0.4, `rgba(255,120,30,${a * 0.6})`); g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return () => { running = false; };
}

// ---------------------------------------------------------------- boot
async function boot() {
  const start = location.hash.slice(1);
  const stopEmbers = startEmbers();
  wireControls();
  setMode('timeline');
  requestAnimationFrame(frame);
  const btn = $('#enter');
  try {
    state.sources = await fetchSources();
    if (!state.sources.length) throw new Error('The database is empty. Run "npm run load:cnfdb" to load the National Fire Database, then reload.');
    $('#source').innerHTML = state.sources.map((s) => `<option value="${s.source}">${SOURCE_LABELS[s.source] ?? s.source}${s.fires ? ` · ${fmtInt(s.fires)}` : ''}</option>`).join('');
    await useSource(state.sources[0].source);
    $('#intro-eyebrow').textContent = `Saskatchewan · ${state.minYear} – ${state.maxYear}`;
    $('#intro-foot').textContent = `${fmtInt(state.all.length)} fires · ${fmtHa(state.all.reduce((s, f) => s + f.size_ha, 0))} ha · ${SOURCE_LABELS[state.source] ?? state.source}`;
    btn.disabled = false;
    btn.querySelector('.cta-label').textContent = 'Enter the atlas';
    if (start === 'sources') sources.open();
  } catch (err) {
    btn.querySelector('.cta-label').textContent = 'Data unavailable';
    $('#intro-foot').textContent = err.message;
    return;
  }
  refreshLive().catch(() => {}); // warm live data in the background (communities power the detail card)
  // Opens the first fire itself if Spread mode is already showing; the story then gains its spread chapter
  spread.loadList().then((list) => { state.spreadList = list; state.spreadIdSet = null; rebuildStory(); finder.refresh(); });

  $('#intro-watch').disabled = false;
  const enter = (watch) => {
    $('#intro').classList.add('gone');
    setTimeout(stopEmbers, 1400);
    map.flyTo({ center: [-105.7, 54.9], zoom: 4.85, pitch: 20, bearing: -4, duration: 3500, curve: 1.6 });
    if (watch || start === 'watch') { doc.start(); return; }
    if (start === 'story') { enterStory(); return; }
    if (start.startsWith('spread')) spread.prefer(start.split('/')[1]);
    if (['explore', 'live'].includes(start) || start.startsWith('spread')) { setMode(start.split('/')[0]); return; }
    if (start === 'search' || start.startsWith('search?')) { finder.setQuery(start); setMode('search'); return; }
    // Open on the most dramatic recent stretch of the record
    state.t = seasonT(Math.max(state.yrFrom, state.yrTo - 4), SEASON_START_DOY);
    setTimeout(() => setPlaying(true), 1800);
  };
  btn.addEventListener('click', () => enter(false), { once: true });
  $('#intro-watch').addEventListener('click', () => enter(true), { once: true });
}

function toggleSound(on = !sound.enabled) {
  sound.setEnabled(on);
  $('#sound').classList.toggle('on', on);
  $('#sound').setAttribute('aria-pressed', String(on));
  $('#sound').title = on ? 'Sound on (M)' : 'Hear the season (M)';
  if (on) toast('Sound on: each ignition plays a note. Bigger fires sound lower; lightning rings like a bell.');
}

window.emberline = { state, map, app, spread, finder, scene, lightning, liveLightning, sound, doc, sources }; // for the console, and for film/director.js
boot();
