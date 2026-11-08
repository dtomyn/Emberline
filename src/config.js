// Central configuration. Everything that points at an external service lives here.
//
// A few values can be overridden at runtime with a URL query parameter, e.g.
//   ?activeFires=https://gis.saskatchewan.ca/arcgis/rest/services/<Folder>/<Service>/MapServer/0
// which makes it easy to test a new endpoint during fire season without a redeploy.
//
// Overrides arrive in links anyone can craft, so each is confined: ?api= and ?data= must stay on
// this site, and ?activeFires= must be a layer on the SPSA ArcGIS server. Anything else is ignored.

const qs = new URLSearchParams(globalThis.location?.search ?? '');
const REST_ROOT = 'https://gis.saskatchewan.ca/arcgis/rest/services';

/** A same-origin URL for `value`, or null (blocks "https://elsewhere", "//elsewhere", "javascript:"). */
export function sameOrigin(value, base = globalThis.location?.href) {
  if (!value || !base) return null;
  try {
    const u = new URL(value, base);
    return u.origin === new URL(base).origin ? value : null;
  } catch { return null; }
}

/** A layer path relative to the SPSA REST root, or an https URL on that same server; otherwise null. */
export function spsaLayer(value, root = REST_ROOT) {
  if (!value) return null;
  if (!/^[a-z][\w+.-]*:|^\/\//i.test(value)) return value; // relative path, resolved against the REST root
  try {
    const u = new URL(value), r = new URL(root);
    return u.protocol === 'https:' && u.host === r.host && u.pathname.startsWith(r.pathname) ? u.href : null;
  } catch { return null; }
}

const minutes = Number(qs.get('refresh'));

// The static build (`npm run build:pages`, for GitHub Pages) adds <meta name="emberline-static"> to
// index.html. There is no server then: ./api holds JSON snapshots of the API, and the browser asks
// live services itself.
const staticSite = Boolean(globalThis.document?.querySelector?.('meta[name="emberline-static"]'));

export const CONFIG = {
  // Historical record comes from the server's SQLite-backed API, or its static snapshot (see apiUrl).
  // A single JSON file also works without either: ?data=./data/fires.json (`npm run export:json`).
  apiBase: sameOrigin(qs.get('api')) ?? './api',
  staticDataUrl: sameOrigin(qs.get('data')),
  staticSite,

  arcgis: {
    // Saskatchewan's public ArcGIS Enterprise (v11.5). Verified 2026-11 to return
    // f=geojson and to send Access-Control-Allow-Origin for browser requests.
    restRoot: REST_ROOT,

    // Folders the discovery crawler checks for an active-fire layer when none is configured.
    // "Wildfire" exists but is empty outside fire season; SPSA publishes there in season.
    discoveryFolders: ['Wildfire', 'SPSA'],

    // Full layer URL for active wildfire incidents (points or polygons).
    // Leave null to auto-discover; set it when SPSA publishes a layer for the season.
    activeFiresLayer: spsaLayer(qs.get('activeFires')),

    // Live SPSA layers that are always available (used for community proximity analysis)
    communityLayers: [
      { url: 'SPSA/Communities/MapServer/6', kind: 'City' },
      { url: 'SPSA/Communities/MapServer/4', kind: 'Northern Town' },
      { url: 'SPSA/Communities/MapServer/1', kind: 'Northern Hamlet' },
      { url: 'SPSA/Communities/MapServer/5', kind: 'Northern Settlement' },
      { url: 'SPSA/Communities/MapServer/3', kind: 'Town' },
    ],
  },

  // National fallback: CWFIS (Natural Resources Canada) GeoServer WFS. Verified 2026-11:
  // satellite hotspots carry an `agency` attribute ('SK'); M3 perimeters are filtered by bbox.
  cwfis: {
    wfsUrl: 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows',
    hotspots: 'public:hotspots_last24hrs',
    perimeters: 'public:m3_polygons_current',
    agency: 'SK',
    bbox: [-110.1, 48.9, -101.2, 60.1],
  },

  // ECCC MSC GeoMet WMS. Lightning_2.5km_Density has a 3-hour, 10-minute time dimension and sends
  // Access-Control-Allow-Origin: * (verified 2026-11).
  geomet: {
    wmsUrl: 'https://geo.weather.gc.ca/geomet',
    lightningLayer: 'Lightning_2.5km_Density',
  },

  // What the map is drawn on: CARTO's Dark Matter vector style (OpenStreetMap data) and the
  // public Terrarium elevation tiles on AWS Open Data (no key), used for 3D terrain and hillshade.
  // CARTO's Basemap Terms (2026-09) require your own API key on every basemaps.cartocdn.com URL
  // (style, tiles, glyphs, sprites). Keys are free for non-commercial use (5M tiles a month) at
  // https://carto.com/basemaps/apikey/. It is a public browser key: put it in basemapKey.
  // Vector styles still load without one (checked 2026-11-08), but CARTO may watermark or cut them off.
  scene: {
    basemapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    basemapKey: '',
    terrainTiles: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    terrainPage: 'https://registry.opendata.aws/terrain-tiles/',
  },

  // Credits on the map itself (MapLibre attribution control, kept expanded: CARTO's terms say the credit
  // can't sit behind a click). All of them are fixed here rather than taken from the style's sources, which
  // MapLibre only lists once their tiles have drawn. They are short to fit a phone; the About dialog gives
  // the full statements each licence asks for (OGL – Canada, ECCC end-use licence, Government of Saskatchewan).
  credits: {
    basemap: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors © <a href="https://carto.com/attribution/" target="_blank" rel="noopener">CARTO</a>',
    record: 'Fire data: <a href="https://cwfis.cfs.nrcan.gc.ca/" target="_blank" rel="noopener">NRCan</a>, <a href="https://open.canada.ca/en/open-government-licence-canada" target="_blank" rel="noopener">Open Government Licence – Canada</a>',
    spsa: 'Communities: SPSA, <a href="https://gisappl.saskatchewan.ca/Html5Ext/Resources/GOS_Standard_Unrestricted_Use_Data_Licence_v2.0.pdf" target="_blank" rel="noopener">Gov. of Saskatchewan licence</a>',
    lightning: 'Lightning: <a href="https://eccc-msc.github.io/open-data/licence/readme_en/" target="_blank" rel="noopener">ECCC</a>',
    terrain: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen, USGS, NOAA, NRCan</a>',
  },

  liveRefreshMinutes: Number.isFinite(minutes) && minutes >= 1 ? Math.min(minutes, 1440) : 5,
  requestTimeoutMs: 15000,
};

/**
 * `url` with the CARTO basemap key added, if it is a basemaps.cartocdn.com URL (style, tiles, glyphs,
 * sprites) and a key is set. Anything else comes back unchanged. MapLibre calls this for every request.
 */
export function withBasemapKey(url, key = CONFIG.scene.basemapKey) {
  if (!key || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)basemaps\.cartocdn\.com$/.test(u.hostname) || u.searchParams.has('key')) return url;
    u.searchParams.set('key', key);
    return u.href.replace(/%7B/g, '{').replace(/%7D/g, '}'); // keep {z}/{x}/{y} templates intact
  } catch { return url; }
}

/**
 * The URL of an API route. On the server: "/fires", { source: 'cnfdb' } → ./api/fires?source=cnfdb.
 * On the static site, the snapshot file the build wrote for it: ./api/fires/cnfdb.json. Files that
 * already have an extension (voice clips) keep their name. Routes the static build can't snapshot
 * (/live, /search, /provenance/ping) return null there, and callers fall back to the browser.
 */
export function apiUrl(path, params = {}, { staticSite: isStatic = CONFIG.staticSite, base = CONFIG.apiBase } = {}) {
  const values = Object.values(params).filter((v) => v != null && v !== '');
  if (!isStatic) return `${base}${path}${values.length ? `?${new URLSearchParams(params)}` : ''}`;
  if (/^\/(live|search|provenance\/ping)\b/.test(path)) return null;
  const file = `${path}${values.map((v) => `/${encodeURIComponent(v)}`).join('')}`;
  return `${base}${file}${/\.\w+$/.test(file) ? '' : '.json'}`;
}
