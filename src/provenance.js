// Provenance: every source of data, sound and code behind Emberline, in one catalogue.
//
// The Sources view (src/sources-view.js) draws this as a fire-scarred tree cross-section, and the
// server (/api/provenance/ping/<id>) uses each entry's `ping` to ask the source for its current state.
// Endpoints come from CONFIG so this list can't drift from what the app actually calls.
// Counts are never written here: they come from the database (/api/provenance) at view time.
//
// Groups, from the pith outward:
//   record: the historical record, drawn as wedges through the rings of the years it covers
//   live:   fetched while you watch, drawn in the bark (the living layer)
//   scene:  what the map and its light are drawn on
//   made:   what Emberline computes, synthesizes or speaks itself
//   engine: the open-source code and type that render it
import { CONFIG } from './config.js';

const { arcgis, cwfis } = CONFIG;
const OGL = { name: 'Open Government Licence – Canada', url: 'https://open.canada.ca/en/open-government-licence-canada' };
const CNFDB_ZIP = 'https://cwfis.cfs.nrcan.gc.ca/downloads/nfdb/fire_pnt/current_version/NFDB_point_txt.zip';
const GEOMET = 'https://geo.weather.gc.ca/geomet';
const CARTO_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const TERRARIUM_TILE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/7/10.png';
const [w, s, e, n] = cwfis.bbox;

const wfsUrl = (params) => `${cwfis.wfsUrl}?${new URLSearchParams({ service: 'WFS', version: '1.1.0', request: 'GetFeature', ...params })}`;
const countUrl = (layer) => `${arcgis.restRoot}/${layer}/query?where=1%3D1&returnCountOnly=true&f=json`;

export const GROUPS = [
  { id: 'record', name: 'The record', where: 'Heartwood', blurb: 'Recorded history, one wedge per source, spanning the rings of the years it covers.' },
  { id: 'live', name: 'Live feeds', where: 'Bark', blurb: 'Fetched while you watch. The living layer of the tree.' },
  { id: 'scene', name: 'The scene', where: 'Halo', blurb: 'The ground and light the fires are drawn on.' },
  { id: 'made', name: 'Made here', where: 'Halo', blurb: 'Computed, interpolated, synthesized or spoken by Emberline itself.' },
  { id: 'engine', name: 'Engine', where: 'Halo', blurb: 'Open-source code and type that render it.' },
];

// Truth levels from docs/intent/05-data.md. The UI must not blur them.
export const TRUTH = {
  recorded: 'Recorded', derived: 'Derived', interpolated: 'Interpolated', illustrative: 'Illustrative',
  simulated: 'Simulated', synthetic: 'Synthetic voice', code: 'Software',
};

export const SOURCES = [
  // ------------------------------------------------------------ record
  {
    id: 'cnfdb', group: 'record', color: '#ff7a1f', truth: 'recorded', dbSource: 'cnfdb',
    name: 'Canadian National Fire Database', short: 'CNFDB',
    owner: 'Natural Resources Canada, Canadian Forest Service. Records reported by Saskatchewan (SPSA and its predecessors).',
    gives: 'Every recorded Saskatchewan wildfire: ignition date, location, final size and cause. The historical record behind Replay, Explore, Story and the film.',
    how: 'Point file filtered to SRC_AGENCY = \'SK\'. REP_DATE wins when it disagrees with YEAR/MONTH/DAY. Prescribed burns and assistance requests are dropped.',
    request: `GET ${CNFDB_ZIP}\n  → NFDB_point_<date>.txt, rows where SRC_AGENCY = 'SK'`,
    loader: 'npm run load:cnfdb',
    page: 'https://cwfis.cfs.nrcan.gc.ca/ha/nfdb', licence: OGL,
    ping: { kind: 'head', url: CNFDB_ZIP },
  },
  {
    id: 'nbac', group: 'record', color: '#ff3d1f', truth: 'recorded', spread: 'perimeters',
    name: 'National Burned Area Composite', short: 'NBAC',
    owner: 'Natural Resources Canada, Canadian Forest Service, with provincial agencies.',
    gives: 'The mapped final burned area of each large fire, which Spread grows into day by day.',
    how: 'WFS layer public:nbac (admin_area = \'SK\') for years it carries; the per-year shapefile zip (Canada Lambert, reprojected) for newer years. Large perimeters are simplified on load; the area total stays NBAC\'s.',
    request: `GET ${wfsUrl({ typeName: 'public:nbac', outputFormat: 'application/json', srsName: 'EPSG:4326', CQL_FILTER: "admin_area='SK' AND year=<year>" })}\nGET https://cwfis.cfs.nrcan.gc.ca/downloads/nbac/NBAC_<year>_<date>.zip`,
    loader: 'npm run load:spread',
    page: 'https://cwfis.cfs.nrcan.gc.ca/ha/nbac', licence: OGL,
    ping: { kind: 'hits', url: wfsUrl({ typeName: 'public:nbac', resultType: 'hits', CQL_FILTER: "admin_area='SK'" }) },
  },
  {
    id: 'hotspots', group: 'record', color: '#ffd27a', truth: 'recorded', spread: 'hotspots',
    name: 'Satellite fire hotspots archive', short: 'Hotspots',
    owner: 'Natural Resources Canada (CWFIS), from MODIS, VIIRS, AVHRR and other sensors.',
    gives: 'Real detections of burning pixels, with time, fire radiative power and wind. They turn a final perimeter into observed growth.',
    how: 'Fetched one report day at a time with agency = \'SK\' (multi-month queries time out at the gateway) and cached. Detections inside or within 800 m of the perimeter seed the arrival-time grid.',
    request: `GET ${wfsUrl({ typeName: 'public:hotspots', outputFormat: 'csv', CQL_FILTER: "agency='SK' AND rep_day='<yyyy-mm-dd>'" })}`,
    loader: 'npm run load:spread',
    page: 'https://cwfis.cfs.nrcan.gc.ca/ha/hotspots', licence: OGL,
  },
  {
    id: 'spsa-csv', group: 'record', color: '#ffb066', truth: 'recorded', dbSource: 'spsa', optional: true,
    name: 'SPSA historical fire export', short: 'SPSA CSV',
    owner: 'Saskatchewan Public Safety Agency.',
    gives: 'An alternative historical record: the 2006–2025 Open Government CSV named in the original brief.',
    how: 'Could not be found on open.canada.ca (searched 2026-11). The loader accepts an SPSA-schema CSV if one turns up.',
    request: 'node scripts/load-csv.mjs <file.csv> --source spsa',
    loader: 'npm run load:spsa',
    page: 'https://www.saskpublicsafety.ca/', licence: null,
  },
  {
    id: 'mock', group: 'record', color: '#a99bff', truth: 'simulated', dbSource: 'mock', optional: true,
    name: 'Synthetic demo data', short: 'Mock',
    owner: 'Generated by Emberline (scripts/generate-mock.mjs).',
    gives: 'An offline fallback so the app runs without a network. Labelled wherever it is selected. Never real fires.',
    how: 'Random ignitions shaped like a Saskatchewan season, written to a CSV and loaded like any other source.',
    request: 'node scripts/generate-mock.mjs',
    loader: 'npm run load:mock',
    page: null, licence: { name: 'MIT (this repository)', url: null },
  },

  // ------------------------------------------------------------ live
  {
    id: 'spsa-communities', group: 'live', color: '#7fe0e8', truth: 'recorded',
    name: 'SPSA communities', short: 'Communities',
    owner: 'Saskatchewan Public Safety Agency, on the Government of Saskatchewan ArcGIS server.',
    gives: 'Cities, towns, northern hamlets and settlements. They power the Live alert radius and "nearest community" on every fire card.',
    how: `Layers ${arcgis.communityLayers.map((l) => l.url.split('/').pop()).sort().join(', ')} of SPSA/Communities, as GeoJSON.`,
    request: arcgis.communityLayers.map((l) => `GET ${arcgis.restRoot}/${l.url}/query?where=1=1&outFields=UMNM,UMTYPE&f=geojson`).join('\n'),
    page: `${arcgis.restRoot}/SPSA/Communities/MapServer`, licence: null,
    ping: { kind: 'arcgis-count', urls: arcgis.communityLayers.map((l) => countUrl(l.url)) },
  },
  {
    id: 'spsa-incidents', group: 'live', color: '#5ad1ff', truth: 'recorded',
    name: 'SPSA active wildfire layer', short: 'SPSA fires',
    owner: 'Saskatchewan Public Safety Agency.',
    gives: 'Active incidents and their status in Live mode, when SPSA publishes a seasonal layer.',
    how: `Tier 1 of Live. A configured layer wins; otherwise Emberline crawls the ${arcgis.discoveryFolders.map((f) => `"${f}"`).join(' and ')} folders for one. The Wildfire folder is empty off-season.`,
    request: `GET ${arcgis.restRoot}/${arcgis.discoveryFolders[0]}?f=json\nGET <discovered layer>/query?where=1=1&outFields=*&f=geojson`,
    page: `${arcgis.restRoot}/${arcgis.discoveryFolders[0]}`, licence: null,
    ping: { kind: 'arcgis-folder', url: `${arcgis.restRoot}/${arcgis.discoveryFolders[0]}?f=json` },
  },
  {
    id: 'cwfis-24h', group: 'live', color: '#9be7ff', truth: 'recorded',
    name: 'CWFIS hotspots, last 24 hours', short: 'Hotspots 24 h',
    owner: 'Natural Resources Canada, Canadian Wildland Fire Information System.',
    gives: 'Tier 2 of Live: today\'s satellite detections in Saskatchewan when no SPSA layer is up.',
    how: `WFS ${cwfis.hotspots}, filtered to agency = '${cwfis.agency}'.`,
    request: `GET ${wfsUrl({ typeName: cwfis.hotspots, outputFormat: 'application/json', srsName: 'EPSG:4326', CQL_FILTER: `agency='${cwfis.agency}'` })}`,
    page: 'https://cwfis.cfs.nrcan.gc.ca/maps/fm3', licence: OGL,
    ping: { kind: 'hits', url: wfsUrl({ typeName: cwfis.hotspots, resultType: 'hits', CQL_FILTER: `agency='${cwfis.agency}'` }) },
  },
  {
    id: 'cwfis-m3', group: 'live', color: '#6fb8ff', truth: 'recorded',
    name: 'CWFIS satellite perimeters (M3)', short: 'M3 perimeters',
    owner: 'Natural Resources Canada, Canadian Wildland Fire Information System.',
    gives: 'Current fire perimeters mapped from satellite, outlined in Live mode.',
    how: `WFS ${cwfis.perimeters}, clipped with a CQL BBOX (the WFS bbox= parameter errors).`,
    request: `GET ${wfsUrl({ typeName: cwfis.perimeters, outputFormat: 'application/json', srsName: 'EPSG:4326', CQL_FILTER: `BBOX(geometry,${w},${s},${e},${n},'EPSG:4326')` })}`,
    page: 'https://cwfis.cfs.nrcan.gc.ca/maps/fm3', licence: OGL,
    ping: { kind: 'hits', url: wfsUrl({ typeName: cwfis.perimeters, resultType: 'hits', CQL_FILTER: `BBOX(geometry,${w},${s},${e},${n},'EPSG:4326')` }) },
  },
  {
    id: 'cldn', group: 'live', color: '#ffe066', truth: 'recorded',
    name: 'Canadian Lightning Detection Network', short: 'CLDN lightning',
    owner: 'Environment and Climate Change Canada, Meteorological Service of Canada (MSC GeoMet).',
    gives: 'The last 3 hours of lightning flash density over the province, looped in Live mode.',
    how: 'WMS layer Lightning_2.5km_Density, one frame per 10-minute step of its time dimension, fetched once as images.',
    request: `GET ${GEOMET}?service=WMS&version=1.3.0&request=GetMap&layers=Lightning_2.5km_Density&crs=EPSG:3857&time=<step>&…`,
    page: 'https://eccc-msc.github.io/open-data/msc-geomet/readme_en/', licence: OGL,
    ping: { kind: 'wms-time', url: `${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=Lightning_2.5km_Density` },
  },
  {
    id: 'live-sim', group: 'live', color: '#c9b8ff', truth: 'simulated',
    name: 'Simulated incidents (last resort)', short: 'Simulation',
    owner: 'Generated by Emberline from the historical record.',
    gives: 'Tier 3 of Live: plausible incidents when every real feed is down or empty. Badged SIMULATED on screen, and never stored as a snapshot.',
    how: 'Replays the busiest two weeks of the latest season in the record, labelled with that date; see src/services/live.js.',
    request: '(none: computed on the server)',
    page: null, licence: null,
  },

  // ------------------------------------------------------------ scene
  {
    id: 'basemap', group: 'scene', color: '#b8c0cc', truth: 'recorded',
    name: 'Dark Matter basemap', short: 'Basemap',
    owner: 'CARTO, drawing OpenStreetMap data (© OpenStreetMap contributors).',
    gives: 'Roads, lakes, places and labels under the fires, darkened further so the fire glows.',
    request: `GET ${CARTO_STYLE}`,
    how: 'MapLibre vector style with CARTO vector tiles of OpenStreetMap, loaded as published.',
    page: 'https://carto.com/basemaps', licence: { name: 'OSM data: ODbL; CARTO basemap terms', url: 'https://www.openstreetmap.org/copyright' },
    ping: { kind: 'get', url: CARTO_STYLE },
  },
  {
    id: 'terrain', group: 'scene', color: '#d9c7a3', truth: 'recorded',
    name: 'Terrarium elevation tiles', short: 'Terrain',
    owner: 'Mapzen terrain tiles on the AWS Registry of Open Data, blended from SRTM, GMTED2010, ETOPO1, NRCan CDEM and others.',
    gives: '3D terrain and hillshade relief, lit by the real sun.',
    how: 'raster-dem source, Terrarium encoding, up to zoom 12.',
    request: 'GET https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    page: 'https://registry.opendata.aws/terrain-tiles/', licence: { name: 'Per-source attribution (see the registry page)', url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' },
    ping: { kind: 'get', url: TERRARIUM_TILE },
  },

  // ------------------------------------------------------------ made here
  {
    id: 'derived', group: 'made', color: '#ff9a5a', truth: 'derived',
    name: 'Emberline\'s own derivations', short: 'Derivations',
    owner: 'Computed by Emberline from the sources above, every time the page loads.',
    gives: 'Season totals, story and film figures, lightning storms (ignitions within 1 day and 60 km), nearest communities, merge moments. Never hard-coded.',
    how: 'src/data.js, src/story.js, src/lightning.js. Storm cells\' shape and strike hours are illustrative and labelled so.',
    request: '(none: computed from the loaded data)',
    page: null, licence: { name: 'MIT (this repository)', url: null },
  },
  {
    id: 'spread-front', group: 'made', color: '#ff5a36', truth: 'interpolated',
    name: 'Spread front interpolation', short: 'Spread front',
    owner: 'Computed by Emberline (src/spread.js).',
    gives: 'The glowing front in Spread: the line where arrival time equals the moment shown.',
    how: 'Each detection inside a perimeter seeds an arrival-time grid; between detections the shape is interpolated.',
    request: '(none: precomputed by npm run load:spread)',
    page: null, licence: { name: 'MIT (this repository)', url: null },
  },
  {
    id: 'sun', group: 'made', color: '#ffcf6b', truth: 'derived',
    name: 'Sun position', short: 'Sun',
    owner: 'Computed by Emberline (src/sun.js), from the standard low-precision solar formulas.',
    gives: 'Shading, golden hour and the day/night line, for the date shown in Saskatchewan time (CST).',
    how: 'Declination, right ascension and sidereal time per instant; accurate to well under a degree.',
    request: '(none: computed)',
    page: null, licence: { name: 'MIT (this repository)', url: null },
  },
  {
    id: 'voice', group: 'made', color: '#f2a0c8', truth: 'synthetic', voice: true,
    name: 'Kokoro narration voice', short: 'Voice',
    owner: 'Kokoro text-to-speech (voice af_heart), run locally. The browser\'s own speech voice stands in for missing clips.',
    gives: 'The narrator of Emberline Presents. A synthetic voice, named as such on the title card.',
    how: 'npm run make:voice rebuilds the story in Node from SQLite and renders each line; clips are keyed by exact text.',
    request: 'python -I scripts/kokoro-voice.py  (via npm run make:voice)',
    page: 'https://huggingface.co/hexgrad/Kokoro-82M', licence: { name: 'Apache 2.0 (model weights)', url: 'https://huggingface.co/hexgrad/Kokoro-82M' },
  },
  {
    id: 'sound', group: 'made', color: '#e0b48a', truth: 'synthetic',
    name: 'Fire and season sound', short: 'Sound',
    owner: 'Synthesized in the browser with Web Audio (src/fireplace.js, src/sonify.js). No recordings.',
    gives: 'The crackling bed under the film and the notes of Hear the Season. The louder pops are real fires.',
    how: 'Filtered noise and oscillators; pitch from fire size, timbre from cause, pan from longitude.',
    request: '(none: synthesized)',
    page: null, licence: { name: 'MIT (this repository)', url: null },
  },

  // ------------------------------------------------------------ engine
  {
    id: 'maplibre', group: 'engine', color: '#8fb3ff', truth: 'code',
    name: 'MapLibre GL JS 4.7.1', short: 'MapLibre',
    owner: 'MapLibre contributors.',
    gives: 'The map, camera, terrain and sky.',
    how: 'Pinned CDN build; no bundler.',
    request: 'GET https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
    page: 'https://maplibre.org/', licence: { name: 'BSD 3-Clause', url: 'https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt' },
  },
  {
    id: 'deckgl', group: 'engine', color: '#a6a0ff', truth: 'code',
    name: 'deck.gl 9.0.38', short: 'deck.gl',
    owner: 'vis.gl, OpenJS Foundation.',
    gives: 'Glowing fires, hex columns, heat, perimeters and embers on the GPU.',
    how: 'Pinned CDN build, interleaved with MapLibre.',
    request: 'GET https://unpkg.com/deck.gl@9.0.38/dist.min.js',
    page: 'https://deck.gl/', licence: { name: 'MIT', url: 'https://github.com/visgl/deck.gl/blob/master/LICENSE' },
  },
  {
    id: 'fonts', group: 'engine', color: '#c8c3bb', truth: 'code',
    name: 'Space Grotesk and JetBrains Mono', short: 'Type',
    owner: 'Florian Karsten; JetBrains. Served by Google Fonts.',
    gives: 'Every letter on screen.',
    how: 'Google Fonts stylesheet.',
    request: 'GET https://fonts.googleapis.com/css2?family=Space+Grotesk…&family=JetBrains+Mono…',
    page: 'https://fonts.google.com/', licence: { name: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org/' },
  },
];

export const sourceById = (id) => SOURCES.find((src) => src.id === id);

/**
 * The years a source covers in this database, or null when it has no year span
 * (live feeds, scene, code) or nothing is loaded for it. `info` is the /api/provenance body.
 */
export function sourceYears(src, info) {
  if (src.dbSource) {
    const s = info?.sources?.find((x) => x.source === src.dbSource);
    return s ? [s.min_year, s.max_year] : null;
  }
  if (src.spread === 'perimeters' && info?.spread?.fires) return [info.spread.minYear, info.spread.maxYear];
  if (src.spread === 'hotspots' && info?.spread?.hotspots) return [info.spread.minYear, info.spread.maxYear];
  return null;
}

/** Which record sources cover a given year. */
export function coverageOf(year, info) {
  return SOURCES.filter((src) => {
    const span = sourceYears(src, info);
    return span && year >= span[0] && year <= span[1];
  });
}

/**
 * The CNFDB-style funnel for an import run: rows read, each rejection reason, rows loaded.
 * `notes` is the JSON object of reason → count stored in import_runs.
 */
export function funnel(run) {
  if (!run) return [];
  let notes = {};
  try { notes = typeof run.notes === 'string' ? JSON.parse(run.notes) : (run.notes ?? {}); } catch { /* not JSON */ }
  const reasons = Object.entries(notes).filter(([, v]) => Number.isFinite(v) && v > 0).sort((a, b) => b[1] - a[1]);
  return [
    { label: 'Rows read', n: run.rows_read },
    ...reasons.map(([k, v]) => ({ label: REJECT_LABELS[k] ?? k, n: -v })),
    { label: 'Loaded', n: run.rows_loaded },
  ].filter((r) => Number.isFinite(r.n));
}
const REJECT_LABELS = {
  prescribed: 'Prescribed burns', assistRequest: 'Assistance requests', badCoord: 'Bad coordinates', badDate: 'Unusable dates',
  duplicate: 'Duplicates', outOfProvince: 'Outside Saskatchewan', badSize: 'Bad sizes', noDates: 'No dates', tooFewHotspots: 'Too few hotspots', preHotspotEra: 'Before the hotspot era',
};

/** A citation to copy, in a plain "Owner. Title. Accessed via <url>, <date>." form. */
export function citation(src, accessed) {
  const owner = src.owner.split('.')[0];
  const where = src.page ?? src.request.split('\n')[0].replace(/^GET /, '');
  const lic = src.licence?.name ? ` ${src.licence.name}.` : '';
  return `${owner}. ${src.name}. ${where}. Accessed ${accessed}.${lic}`;
}

/**
 * Reads what a source's reply says about its current state. Pure, so it can be tested
 * without a network. `body` is the response text; `headers` a plain lower-case object.
 */
export function readPing(kind, body, headers = {}) {
  if (kind === 'hits') {
    const m = body.match(/number(?:OfFeatures|Matched)="(\d+)"/);
    return m ? { count: Number(m[1]) } : {};
  }
  if (kind === 'arcgis-count') return { count: JSON.parse(body).count };
  if (kind === 'arcgis-folder') return { services: (JSON.parse(body).services ?? []).length };
  if (kind === 'wms-time') {
    const m = body.match(/<Dimension[^>]*name="time"[^>]*>([^<]+)</i);
    const latest = m?.[1].split('/')[1] ?? m?.[1].split(',').pop();
    return latest ? { latest: latest.trim().replace('T', ' ').replace(/:00Z$/, ' UTC') } : {};
  }
  if (kind === 'head') {
    const out = {};
    if (headers['content-length']) out.bytes = Number(headers['content-length']);
    if (headers['last-modified']) out.modified = new Date(headers['last-modified']).toISOString().slice(0, 10);
    return out;
  }
  return {};
}

const UNITS = { nbac: 'SK perimeters', 'spsa-communities': 'communities', 'cwfis-24h': 'SK detections', 'cwfis-m3': 'perimeters' };

/** Asks a source for its state right now. Runs on the server, so CORS never decides the answer. */
export async function pingSource(src, { timeoutMs = 20000 } = {}) {
  if (!src?.ping) return { ok: false, error: 'not checkable' };
  const { kind } = src.ping;
  const urls = src.ping.urls ?? [src.ping.url];
  const t0 = Date.now();
  try {
    const replies = await Promise.all(urls.map(async (url) => {
      const res = await fetch(url, { method: kind === 'head' ? 'HEAD' : 'GET', signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const body = kind === 'head' ? '' : await res.text();
      return readPing(kind, body, Object.fromEntries(res.headers));
    }));
    const out = { ok: true, ms: Date.now() - t0, unit: UNITS[src.id], ...replies[0] };
    if (replies.length > 1) out.count = replies.reduce((sum, r) => sum + (r.count ?? 0), 0);
    return out;
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, status: err.status, error: err.name === 'TimeoutError' ? 'timed out' : err.message };
  }
}

/** Turns a server-side ping response into one short line for the card. */
export function describePing(p) {
  if (!p) return '';
  if (!p.ok) return `Did not answer (${p.error ?? `HTTP ${p.status}`}) after ${p.ms} ms`;
  const bits = [`Answered in ${p.ms} ms`];
  if (Number.isFinite(p.count)) bits.push(`${p.count.toLocaleString('en-CA')} ${p.unit ?? 'features'} right now`);
  if (p.services !== undefined) bits.push(p.services ? `${p.services} service${p.services === 1 ? '' : 's'} published` : 'folder empty (off-season)');
  if (p.latest) bits.push(`latest frame ${p.latest}`);
  if (p.modified) bits.push(`file dated ${p.modified}`);
  if (Number.isFinite(p.bytes)) bits.push(`${(p.bytes / 1048576).toFixed(1)} MB`);
  return bits.join(' · ');
}
