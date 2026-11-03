// Central configuration. Everything that points at an external service lives here.
//
// Every value can be overridden at runtime with a URL query parameter, e.g.
//   ?activeFires=https://gis.saskatchewan.ca/arcgis/rest/services/<Folder>/<Service>/MapServer/0
// which makes it easy to test a new endpoint during fire season without a redeploy.

const qs = new URLSearchParams(globalThis.location?.search ?? '');

export const CONFIG = {
  // Historical record comes from the server's SQLite-backed API. For static hosting without
  // the server, pass ?data=./data/fires.json (written by `npm run export:json`).
  apiBase: qs.get('api') ?? './api',
  staticDataUrl: qs.get('data'),

  arcgis: {
    // Saskatchewan's public ArcGIS Enterprise (v11.5). Verified 2026-11 to return
    // f=geojson and to send Access-Control-Allow-Origin for browser requests.
    restRoot: 'https://gis.saskatchewan.ca/arcgis/rest/services',

    // Folders the discovery crawler checks for an active-fire layer when none is configured.
    // "Wildfire" exists but is empty outside fire season; SPSA publishes there in season.
    discoveryFolders: ['Wildfire', 'SPSA'],

    // Full layer URL for active wildfire incidents (points or polygons).
    // Leave null to auto-discover; set it when SPSA publishes a layer for the season.
    activeFiresLayer: qs.get('activeFires'),

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

  liveRefreshMinutes: Number(qs.get('refresh') ?? 5),
  requestTimeoutMs: 15000,
};
