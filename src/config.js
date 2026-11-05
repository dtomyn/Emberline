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

export const CONFIG = {
  // Historical record comes from the server's SQLite-backed API. For static hosting without
  // the server, pass ?data=./data/fires.json (written by `npm run export:json`).
  apiBase: sameOrigin(qs.get('api')) ?? './api',
  staticDataUrl: sameOrigin(qs.get('data')),

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
  scene: {
    basemapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    terrainTiles: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    terrainPage: 'https://registry.opendata.aws/terrain-tiles/',
  },

  liveRefreshMinutes: Number.isFinite(minutes) && minutes >= 1 ? Math.min(minutes, 1440) : 5,
  requestTimeoutMs: 15000,
};
