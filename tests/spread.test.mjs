import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lccForward, lccInverse, ringAreaHa, simplifyRing, prepareRings, pointInRings, makeGrid, rasterize,
  arrivalField, packArrival, unpackArrival, dailyGrowth, frontSegments, parseHotspotCsv, u16ToBase64, base64ToU16,
} from '../src/spread.js';
import { readShpPolygons, readDbf } from '../scripts/lib/shapefile.mjs';
import { normalizeNbac, fireWindow, parsePrj, assignHotspots } from '../scripts/load-spread.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
// 0.2° × 0.1° box near La Ronge: about 14,190 ha
const BOX = [[-105, 55], [-104.8, 55], [-104.8, 55.1], [-105, 55.1], [-105, 55]];

test('Canada LCC inverse undoes the forward projection and hits the origin', () => {
  const inv = lccInverse();
  const [lon0, lat0] = inv(0, 0);
  near(lon0, -95, 1e-9); near(lat0, 49, 1e-9);
  for (const [lon, lat] of [[-104.5, 55.2], [-109.9, 59.9], [-101.4, 49.1]]) {
    const [x, y] = lccForward(lon, lat);
    const [lo, la] = inv(x, y);
    near(lo, lon, 1e-7); near(la, lat, 1e-7);
  }
});

test('parsePrj reads the NBAC Canada Lambert parameters', () => {
  const prj = 'PROJCS["Canada_Lambert_Conformal_Conic",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-95.0],PARAMETER["Standard_Parallel_1",49.0],PARAMETER["Standard_Parallel_2",77.0],PARAMETER["Latitude_Of_Origin",49.0],UNIT["Meter",1.0]]';
  assert.deepEqual(parsePrj(prj), { lat1: 49, lat2: 77, lat0: 49, lon0: -95, x0: 0, y0: 0 });
});

test('ring area, simplification and tidy-up', () => {
  near(ringAreaHa(BOX), 14190, 30, 'area');
  // A dense, nearly straight edge collapses to its corners
  const dense = [];
  for (let i = 0; i <= 100; i++) dense.push([-105 + i * 0.002, 55 + (i % 2) * 1e-6]);
  assert.equal(simplifyRing(dense, 50).length, 2);
  const tiny = [[-105, 55], [-104.999, 55], [-104.999, 55.001], [-105, 55]];
  const { rings, bbox } = prepareRings([BOX, tiny]);
  assert.equal(rings.length, 1, 'islands under 15 ha are dropped');
  assert.deepEqual(bbox, [-105, 55, -104.8, 55.1]);
});

test('rasterize fills the polygon with even-odd holes', () => {
  const hole = [[-104.95, 55.02], [-104.85, 55.02], [-104.85, 55.08], [-104.95, 55.08], [-104.95, 55.02]];
  const g = makeGrid([-105, 55, -104.8, 55.1], { maxCells: 80, padKm: 0 });
  const full = rasterize([BOX], g).reduce((a, b) => a + b, 0);
  const holed = rasterize([BOX, hole], g).reduce((a, b) => a + b, 0);
  const cellHa = g.cellKm ** 2 * 100;
  near(full * cellHa, 14190, 600, 'filled area');
  assert.ok(holed < full * 0.75 && holed > full * 0.6, 'hole removed');
  assert.ok(pointInRings(-104.99, 55.01, [BOX, hole]));
  assert.ok(!pointInRings(-104.9, 55.05, [BOX, hole]));
});

test('arrival field grows from detections, merges, and draws a front', () => {
  const { rings, bbox } = prepareRings([BOX]);
  const g = makeGrid(bbox, { maxCells: 64 });
  const mask = rasterize(rings, g);
  const arr = arrivalField(mask, g, [{ lon: -104.99, lat: 55.05, t: 1 }, { lon: -104.81, lat: 55.05, t: 3 }]);
  let minT = Infinity, outside = 0;
  arr.forEach((v, i) => { if (v < minT) minT = v; if (!mask[i] && v !== Infinity) outside++; });
  assert.equal(minT, 1, 'earliest cell is the first detection');
  assert.equal(outside, 0, 'cells outside the perimeter never burn');
  const { days, merges } = dailyGrowth(arr, g, 14190);
  assert.equal(days[0].ha, 0);
  assert.equal(days.at(-1).ha, 14190, 'last day equals the NBAC area');
  for (let d = 1; d < days.length; d++) assert.ok(days[d].ha >= days[d - 1].ha, 'area never shrinks');
  assert.equal(merges.length, 1);
  assert.equal(merges[0].day, 4);
  near(merges[0].lon, -104.87, 0.01, 'merge happens between the two fronts');
  const segs = frontSegments(arr, g, 2.5);
  assert.ok(segs.length > 0 && segs.length % 5 === 0);
  for (let i = 4; i < segs.length; i += 5) assert.ok(segs[i] > 0, 'every segment has a spread rate');
});

test('arrival packing round-trips through base64', () => {
  const arr = Float64Array.from([0, 1.5, Infinity, 12.25]);
  const back = unpackArrival(base64ToU16(u16ToBase64(packArrival(arr))));
  assert.deepEqual([...back], [0, 1.5, Infinity, 12.25]);
});

test('parseHotspotCsv reads the CWFIS WFS CSV output', () => {
  const csv = 'FID,lat,lon,rep_date,sensor,frp,ws,wd\n' +
    'hotspots.1,53.69499969,-104.61459351,2025-05-13T20:00:00,MODIS,551.91998291,18.0,131\n' +
    'hotspots.2,56.36241913,-106.85954285,2023-06-01T08:37:00,VIIRS-I,,,\n' +
    'hotspots.3,bad,-1,2023-06-01T08:37:00,VIIRS-I,,,\n';
  const hs = parseHotspotCsv(csv);
  assert.equal(hs.length, 2);
  assert.deepEqual(hs[0], { lat: 53.69499969, lon: -104.61459351, time: '2025-05-13T20:00:00Z', sensor: 'MODIS', frp: 551.91998291, ws: 18, wd: 131 });
  assert.equal(hs[1].frp, null);
});

test('NBAC attributes normalize from WFS and DBF spellings, and give a replay window', () => {
  const wfs = normalizeNbac({ year: 2023, nfireid: 349, firecaus: 'Natural', hs_sdate: '2023-05-11Z', hs_edate: '2023-09-22Z', ag_sdate: '2023-05-11Z', ag_edate: '2023-08-30Z', poly_ha: 445243.3, adj_ha: 445243.3 });
  const dbf = normalizeNbac({ YEAR: 2025, NFIREID: 273, FIRECAUS: 'Human', HS_SDATE: '2025-04-27', HS_EDATE: '2025-08-30', AG_SDATE: '2025-05-07', AG_EDATE: null, POLY_HA: 632231.5, ADJ_HA: 632231.5 });
  assert.equal(wfs.hs_sdate, '2023-05-11');
  assert.equal(dbf.year, 2025);
  assert.equal(dbf.cause, 'Human');
  assert.deepEqual(fireWindow(dbf), { start: '2025-04-25', end: '2025-09-01' });
  assert.equal(fireWindow({ ...dbf, hs_sdate: null, hs_edate: null, ag_sdate: null }), null);
  // No hotspot end date: fall back to the agency's out date
  assert.deepEqual(fireWindow({ hs_sdate: null, hs_edate: null, ag_sdate: '2010-06-04', ag_edate: '2010-06-20' }), { start: '2010-06-02', end: '2010-06-22' });
});

test('assignHotspots keeps detections inside the window and perimeter, plus a thin edge band', () => {
  const fire = { rings: [BOX], bbox: [-105, 55, -104.8, 55.1], window: { start: '2025-05-01', end: '2025-05-10' } };
  const hs = [
    { lat: 55.05, lon: -104.9, time: '2025-05-03T12:00:00Z', frp: 20 },     // inside
    { lat: 55.103, lon: -104.9, time: '2025-05-03T18:00:00Z', frp: 5 },     // ~330 m outside: kept
    { lat: 55.2, lon: -104.9, time: '2025-05-03T12:00:00Z', frp: 5 },       // far outside
    { lat: 55.05, lon: -104.9, time: '2025-06-03T12:00:00Z', frp: 5 },      // after the window
  ];
  const out = assignHotspots(fire, hs);
  assert.equal(out.length, 2);
  assert.equal(out[0].t, 2.5);
  assert.equal(out[1].t, 2.75);
});

test('shapefile and dBASE readers decode a polygon record', () => {
  // One polygon with one 4-point ring
  const pts = [[0, 0], [10, 0], [10, 10], [0, 0]];
  const content = Buffer.alloc(44 + 4 + pts.length * 16);
  content.writeInt32LE(5, 0);
  content.writeInt32LE(1, 36); content.writeInt32LE(pts.length, 40); content.writeInt32LE(0, 44);
  pts.forEach(([x, y], i) => { content.writeDoubleLE(x, 48 + i * 16); content.writeDoubleLE(y, 56 + i * 16); });
  const header = Buffer.alloc(100); header.writeInt32BE(9994, 0);
  const rec = Buffer.alloc(8); rec.writeInt32BE(1, 0); rec.writeInt32BE(content.length / 2, 4);
  const shp = Buffer.concat([header, rec, content]);
  assert.deepEqual(readShpPolygons(shp), [[pts]]);
  assert.deepEqual(readShpPolygons(shp, () => false), [null]);

  const fields = [['ADMIN_NAME', 'C', 4], ['POLY_HA', 'F', 12], ['HS_SDATE', 'D', 8]];
  const hdr = Buffer.alloc(32 + 32 * fields.length + 1);
  const recLen = 1 + fields.reduce((s, f) => s + f[2], 0);
  hdr.writeUInt32LE(1, 4); hdr.writeUInt16LE(hdr.length, 8); hdr.writeUInt16LE(recLen, 10);
  fields.forEach(([n, t, l], i) => { hdr.write(n, 32 + i * 32, 'latin1'); hdr.write(t, 32 + i * 32 + 11, 'latin1'); hdr[32 + i * 32 + 16] = l; });
  hdr[hdr.length - 1] = 0x0d;
  const row = Buffer.from(' ' + 'SK  ' + ' 6.32231e+05' + '20250427', 'latin1'); // deletion flag + fixed-width fields
  assert.deepEqual(readDbf(Buffer.concat([hdr, row])), [{ ADMIN_NAME: 'SK', POLY_HA: 632231, HS_SDATE: '2025-04-27' }]);
});
