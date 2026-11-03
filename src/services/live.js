/**
 * live.js: pulls active wildfire incidents during fire season.
 *
 * Source priority (the first one with data wins):
 *   1. SPSA ArcGIS layer set in CONFIG.arcgis.activeFiresLayer (or ?activeFires=<url>)
 *   2. A layer auto-discovered in the SPSA/Wildfire catalog folders
 *   3. CWFIS satellite hotspots from the last 24 h, filtered to agency = 'SK'
 *   4. Simulation: replays the busiest fortnight of the latest season in the
 *      historical record, clearly labelled as simulated in the UI
 *
 * SPSA community points are always fetched live from gis.saskatchewan.ca and used
 * to compute "communities within X km" for every incident.
 */
import { CONFIG } from '../config.js';
import { queryGeoJSON, discoverLayers, resolveLayerUrl, centroid } from './arcgis.js';

const pickField = (props, patterns) => {
  const keys = Object.keys(props);
  for (const p of patterns) {
    const k = keys.find((k) => p.test(k));
    if (k && props[k] !== null && props[k] !== '') return props[k];
  }
  return undefined;
};

/** Map SPSA / CIFFC stage-of-control vocabularies onto four display states. */
export function normalizeStatus(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (/^(oc|ooc)$|out of control|not contained|uncontained/.test(s)) return 'Not contained';
  if (/^(bh)$|being held|protecting|values/.test(s)) return 'Protecting values';
  if (/^(uc|cont)$|under control|contained/.test(s)) return 'Contained';
  if (/^(ex|out)$|extinguish|^out/.test(s)) return 'Out';
  return s ? 'Ongoing assessment' : 'Unknown';
}

const toDate = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v).replace(' ', 'T'));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

/** Normalize an arbitrary incident feature into the shape the UI renders. */
export function normalizeIncident(feature, i) {
  const p = feature.properties ?? {};
  const c = centroid(feature.geometry) ?? [Number(pickField(p, [/^lon/i, /^long/i, /^x$/i])), Number(pickField(p, [/^lat/i, /^y$/i]))];
  return {
    id: String(pickField(p, [/fire_?(num|id|no)/i, /^firename$/i, /incident_?(num|id|name)/i, /^name$/i, /objectid/i]) ?? `incident-${i}`),
    name: pickField(p, [/^firename$/i, /fire_?name/i, /incident_?name/i, /^name$/i]) ?? null,
    status: normalizeStatus(pickField(p, [/stage/i, /status/i, /control/i, /state/i])),
    size_ha: Number(pickField(p, [/hect/i, /size/i, /area/i])) || 0,
    start: toDate(pickField(p, [/start/i, /ignit/i, /rep_?date/i, /discover/i, /date/i])),
    longitude: c[0],
    latitude: c[1],
    geometry: feature.geometry?.type?.includes('Polygon') ? feature.geometry : null,
  };
}

async function fromArcGIS(url) {
  const fc = await queryGeoJSON(url, { where: '1=1', outFields: '*', timeoutMs: CONFIG.requestTimeoutMs });
  return fc.features.map(normalizeIncident).filter((f) => Number.isFinite(f.latitude));
}

async function wfs(typeName, cql) {
  const u = new URL(CONFIG.cwfis.wfsUrl);
  Object.entries({
    service: 'WFS', version: '1.1.0', request: 'GetFeature', typeName, outputFormat: 'application/json',
    srsName: 'EPSG:4326', CQL_FILTER: cql,
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
  if (!res.ok) throw new Error(`CWFIS HTTP ${res.status}`);
  const text = await res.text();
  if (text.startsWith('<')) throw new Error('CWFIS returned a service exception');
  return JSON.parse(text);
}

/** Satellite hotspots detected in Saskatchewan in the last 24 h (MODIS / VIIRS / SLSTR). */
async function fromCWFISHotspots() {
  const fc = await wfs(CONFIG.cwfis.hotspots, `agency='${CONFIG.cwfis.agency}'`);
  return fc.features.map((f) => ({
    id: `${f.properties.satellite ?? 'sat'}-${f.id}`,
    name: `${f.properties.sensor ?? 'Satellite'} hotspot`,
    status: 'Satellite hotspot',
    size_ha: Number(f.properties.estarea) || 0,
    start: toDate(f.properties.rep_date),
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1],
    frp: f.properties.frp,
    geometry: null,
  }));
}

/** Current satellite-derived fire perimeters (M3) intersecting Saskatchewan. */
export async function loadPerimeters() {
  const [w, s, e, n] = CONFIG.cwfis.bbox;
  const fc = await wfs(CONFIG.cwfis.perimeters, `BBOX(geometry,${w},${s},${e},${n})`);
  return fc.features.filter((f) => f.geometry);
}

/** Busiest 14 days of the latest season → pseudo "active" incidents for demos off-season. */
export function simulateFromHistory(fires) {
  if (!fires.length) return { incidents: [], asOf: null };
  const lastYear = fires[fires.length - 1].year;
  const season = fires.filter((f) => f.year === lastYear);
  let best = { n: 0, day: 0 };
  for (let d = 100; d < 300; d += 2) {
    const n = season.filter((f) => f.doy > d - 14 && f.doy <= d).length;
    if (n > best.n) best = { n, day: d };
  }
  const active = season.filter((f) => f.doy > best.day - 14 && f.doy <= best.day);
  const asOf = new Date(Date.UTC(lastYear, 0, best.day)).toISOString().slice(0, 10);
  const incidents = active.map((f) => {
    const age = best.day - f.doy;
    const status = f.size_ha > 5000 ? 'Not contained' : f.size_ha > 200 ? (age < 5 ? 'Not contained' : 'Protecting values') : age > 6 ? 'Contained' : 'Ongoing assessment';
    return { id: f.fire_id, name: null, status, size_ha: f.size_ha, start: f.ignition_date, latitude: f.latitude, longitude: f.longitude, geometry: null };
  });
  return { incidents, asOf };
}

/** Live SPSA community points (cities, towns, northern hamlets/settlements). */
export async function loadCommunities() {
  const { restRoot, communityLayers } = CONFIG.arcgis;
  const results = await Promise.allSettled(
    communityLayers.map(async ({ url, kind }) => {
      const fc = await queryGeoJSON(resolveLayerUrl(restRoot, url), { outFields: 'UMNM,UMTYPE', timeoutMs: CONFIG.requestTimeoutMs });
      return fc.features
        .filter((f) => f.geometry?.type === 'Point')
        .map((f) => ({ name: f.properties.UMNM, kind, longitude: f.geometry.coordinates[0], latitude: f.geometry.coordinates[1] }));
    })
  );
  const ok = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  return { communities: ok, failed: results.filter((r) => r.status === 'rejected').length };
}

/**
 * Resolve live incidents. Returns { source, label, simulated, incidents, asOf, log }.
 * `log` records each source tried, for the in-app data-source panel.
 */
export async function loadActiveIncidents(historicalFires) {
  const log = [];
  const { restRoot, activeFiresLayer, discoveryFolders } = CONFIG.arcgis;
  const today = new Date().toISOString().slice(0, 10);

  if (activeFiresLayer) {
    try {
      const incidents = await fromArcGIS(resolveLayerUrl(restRoot, activeFiresLayer));
      log.push({ source: 'SPSA configured layer', ok: true, n: incidents.length });
      if (incidents.length) return { source: 'spsa', label: 'SPSA ArcGIS (configured layer)', simulated: false, incidents, asOf: today, log };
    } catch (e) { log.push({ source: 'SPSA configured layer', ok: false, error: e.message }); }
  }

  try {
    const layers = await discoverLayers(restRoot, discoveryFolders, undefined, { timeoutMs: CONFIG.requestTimeoutMs });
    log.push({ source: `SPSA discovery (${discoveryFolders.join(', ')})`, ok: true, n: layers.length, note: layers.length ? layers.map((l) => l.name).join(', ') : 'no active-fire layer published' });
    for (const layer of layers) {
      const incidents = await fromArcGIS(layer.url).catch(() => []);
      if (incidents.length) return { source: 'spsa', label: `SPSA ArcGIS: ${layer.name}`, simulated: false, incidents, asOf: today, log };
    }
  } catch (e) { log.push({ source: 'SPSA discovery', ok: false, error: e.message }); }

  try {
    const incidents = await fromCWFISHotspots();
    log.push({ source: 'CWFIS satellite hotspots, 24 h (NRCan)', ok: true, n: incidents.length });
    if (incidents.length) return { source: 'cwfis', label: 'CWFIS satellite hotspots, last 24 h (agency = SK)', simulated: false, incidents, asOf: today, log };
  } catch (e) { log.push({ source: 'CWFIS satellite hotspots (NRCan)', ok: false, error: e.message }); }

  const sim = simulateFromHistory(historicalFires);
  log.push({ source: 'Simulation from historical record', ok: true, n: sim.incidents.length });
  return { source: 'simulated', label: `Simulated: replay of ${sim.asOf}`, simulated: true, incidents: sim.incidents, asOf: sim.asOf, log };
}

/** Great-circle distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
