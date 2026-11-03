/**
 * arcgis.js: a small, dependency-free client for ArcGIS REST Map/Feature Services.
 *
 * Works in the browser and in Node 18+ (both have fetch). Handles:
 *  - catalog browsing (folders → services → layers)
 *  - layer metadata (fields, geometry type, maxRecordCount, supported formats)
 *  - paginated /query requests that return GeoJSON (f=geojson), with an Esri JSON
 *    fallback for servers or layers that don't support GeoJSON
 *
 * Typical use:
 *   const fc = await queryGeoJSON(
 *     'https://gis.saskatchewan.ca/arcgis/rest/services/SPSA/Communities/MapServer/1',
 *     { where: '1=1', outFields: '*' });
 */

const DEFAULT_TIMEOUT = 15000;

async function getJSON(url, { signal, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const body = await res.json();
    // ArcGIS reports most errors as HTTP 200 with an { error } body
    if (body?.error) throw new Error(`ArcGIS error ${body.error.code}: ${body.error.message}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const withParams = (base, params) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
};

/** Resolve a layer path like "SPSA/Communities/MapServer/1" against a REST root. */
export const resolveLayerUrl = (root, path) => (/^https?:/i.test(path) ? path : `${root.replace(/\/$/, '')}/${path}`);

/** List the folders and services in a catalog folder (root when folder is ''). */
export async function listCatalog(root, folder = '', opts) {
  const url = folder ? `${root}/${folder}` : root;
  const { folders = [], services = [] } = await getJSON(withParams(url, { f: 'json' }), opts);
  return { folders, services };
}

/** Layer metadata: name, geometryType, fields, maxRecordCount, supportedQueryFormats. */
export const describeLayer = (layerUrl, opts) => getJSON(withParams(layerUrl, { f: 'json' }), opts);

/**
 * Crawl catalog folders for layers whose names look like wildfire incidents.
 * Returns [{ url, name, geometryType, service }] in the order found.
 */
export async function discoverLayers(root, folders, pattern = /(active|current).*(fire|incident)|wildfire|fire.?(point|perimeter|location)/i, opts) {
  const found = [];
  for (const folder of folders) {
    let services;
    try { ({ services } = await listCatalog(root, folder, opts)); } catch { continue; }
    for (const s of services.filter((s) => s.type === 'MapServer' || s.type === 'FeatureServer')) {
      const svcUrl = `${root}/${s.name}/${s.type}`;
      try {
        const meta = await getJSON(withParams(svcUrl, { f: 'json' }), opts);
        for (const l of meta.layers ?? []) {
          if (l.subLayerIds?.length) continue; // skip group layers
          if (pattern.test(l.name) || pattern.test(s.name)) {
            found.push({ url: `${svcUrl}/${l.id}`, name: l.name, geometryType: l.geometryType, service: s.name });
          }
        }
      } catch { /* service unreachable; keep crawling */ }
    }
  }
  return found;
}

/**
 * Query a layer and return a GeoJSON FeatureCollection in WGS84.
 * Follows exceededTransferLimit with resultOffset paging until done or maxFeatures is reached.
 */
export async function queryGeoJSON(layerUrl, {
  where = '1=1', outFields = '*', bbox, maxAllowableOffset, pageSize = 1000, maxFeatures = 20000,
  signal, timeoutMs,
} = {}) {
  const base = `${layerUrl.replace(/\/$/, '')}/query`;
  const params = {
    where, outFields, returnGeometry: true, outSR: 4326, maxAllowableOffset,
    resultRecordCount: pageSize,
    ...(bbox && {
      geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: 4326, spatialRel: 'esriSpatialRelIntersects',
    }),
  };
  const features = [];
  let format = 'geojson';
  for (let offset = 0; features.length < maxFeatures; ) {
    let page;
    try {
      page = await getJSON(withParams(base, { ...params, resultOffset: offset, f: format }), { signal, timeoutMs });
    } catch (err) {
      if (format === 'geojson' && offset === 0) { format = 'json'; continue; } // older server: retry as Esri JSON
      throw err;
    }
    const batch = format === 'geojson' ? page.features ?? [] : esriToGeoJSON(page).features;
    features.push(...batch);
    const more = page.exceededTransferLimit || page.properties?.exceededTransferLimit;
    if (!more || batch.length === 0) break;
    offset += batch.length;
  }
  return { type: 'FeatureCollection', features: features.slice(0, maxFeatures) };
}

/** Minimal Esri JSON → GeoJSON conversion (points, multipoints, polylines, polygons). */
export function esriToGeoJSON(esri) {
  const conv = (g) => {
    if (!g) return null;
    if ('x' in g) return { type: 'Point', coordinates: [g.x, g.y] };
    if (g.points) return { type: 'MultiPoint', coordinates: g.points };
    if (g.paths) return { type: 'MultiLineString', coordinates: g.paths };
    if (g.rings) {
      // Esri outer rings run clockwise, holes run counter-clockwise
      const polys = [];
      for (const ring of g.rings) {
        if (signedArea(ring) < 0 || polys.length === 0) polys.push([ring]);
        else polys[polys.length - 1].push(ring);
      }
      return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
    }
    return null;
  };
  return {
    type: 'FeatureCollection',
    features: (esri.features ?? []).map((f) => ({ type: 'Feature', geometry: conv(f.geometry), properties: f.attributes ?? {} })),
  };
}
const signedArea = (ring) => {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2; // negative = clockwise
};

/** Representative [lon, lat] for any geometry (point itself, or vertex-average for lines/polygons). */
export function centroid(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') return geom.coordinates;
  const pts = [];
  const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk));
  walk(geom.coordinates);
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}
