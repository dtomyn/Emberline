import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepare, search, compile, parseText, mergeQuery, emptyQuery, normalizeQuery, describe, withoutPart,
  toParams, fromParams, toCSV, toGeoJSON, sizeClass, durationDays, isEmptyQuery,
} from '../src/search.js';
import { openDb, replaceSource, allFires, queryFires } from '../server/db.mjs';

const fire = (id, date, ha, lat, lon, cause, extra = {}) =>
  ({ fire_id: id, ignition_date: date, size_ha: ha, latitude: lat, longitude: lon, general_cause: cause, fire_name: null, out_date: null, protection_zone: null, ...extra });

const FIRES = () => prepare([
  fire('SK-2025-25LF-SHOE', '2025-05-07', 592985, 54.209, -104.858, 'Human', { fire_name: '25LF-SHOE', out_date: '2025-08-23' }),
  fire('SK-2015-15LA-EGG', '2015-06-06', 138847, 55.137, -105.744, 'Lightning', { fire_name: '15LA-EGG', out_date: '2015-09-14' }),
  fire('SK-2015-15LA-CLARK', '2015-06-06', 24422, 55.423, -105.637, 'Lightning', { out_date: '2015-06-29' }),
  fire('SK-1995-001', '1995-07-15', 3.2, 49.5, -103.0, 'Human', { out_date: '1995-07-15' }),
  fire('SK-1981-BIGCREEK', '1981-08-02', 0.05, 53.1, -106.2, 'Unknown', { fire_name: 'BIG CREEK', out_date: '1981-07-30' }), // out before start
  fire('SK-2003-777', '2003-04-20', 150, 58.0, -108.0, 'Lightning', { protection_zone: 'EXT' }),
]);
const LA_RONGE = { name: 'La Ronge', latitude: 55.1, longitude: -105.28 };
const AIR_RONGE = { name: 'Air Ronge', latitude: 55.09, longitude: -105.31 };
const PA = { name: 'Prince Albert', latitude: 53.2, longitude: -105.75 };
const COMMUNITIES = [LA_RONGE, AIR_RONGE, PA];
const parse = (s) => parseText(s, { communities: COMMUNITIES });
const run = (fires, text, base = emptyQuery()) => { const p = parse(text); return search(fires, mergeQuery(base, { ...p.patch, text: p.text })); };

test('prepare derives size class, duration, bucket and a readable name', () => {
  const [shoe, , , small, odd] = FIRES();
  assert.equal(shoe.cls, 'E');
  assert.equal(shoe.days, 108);
  assert.equal(shoe.dur, 'd90');
  assert.equal(shoe.label, 'Shoe fire');
  assert.equal(small.cls, 'B');
  assert.equal(small.days, 0);
  assert.equal(small.dur, 'd0');
  assert.equal(odd.days, null, 'an out date before the start is a recording slip, not a duration');
  assert.deepEqual([0.1, 0.11, 4, 40, 200, 200.5].map(sizeClass), ['A', 'B', 'B', 'C', 'D', 'E']);
  assert.equal(durationDays({ ignition_date: '2020-01-01', out_date: null }), null);
});

test('parseText reads a plain-language search into filters', () => {
  const p = parse('lightning fires near La Ronge over 1,000 ha in july 2015');
  assert.deepEqual(p.patch.causes, ['Lightning']);
  assert.deepEqual(p.patch.months, [6]);
  assert.equal(p.patch.sizeMin, 1000);
  assert.equal(p.patch.from, 2015);
  assert.equal(p.patch.to, 2015);
  assert.equal(p.patch.near.label, 'La Ronge');
  assert.equal(p.text, '');
});

test('parseText handles ranges, decades, seasons, keys and comparisons', () => {
  assert.deepEqual([parse('2010-2015').patch.from, parse('2010-2015').patch.to], [2010, 2015]);
  assert.deepEqual([parse('1990s').patch.from, parse('1990s').patch.to], [1990, 1999]);
  assert.equal(parse('since 2015').patch.from, 2015);
  assert.equal(parse('before 2000').patch.to, 1999);
  assert.deepEqual(parse('jun-aug').patch.months, [5, 6, 7]);
  assert.deepEqual(parse('june to august').patch.months, [5, 6, 7]);
  assert.deepEqual(parse('summer').patch.months, [5, 6, 7]);
  assert.deepEqual(parse('class:d,e').patch.classes, ['D', 'E']);
  assert.equal(parse('>5k ha').patch.sizeMin, 5000);
  assert.equal(parse('<5ha').patch.sizeMax, 5);
  assert.equal(parse('over 2 km2').patch.sizeMin, 200);
  assert.deepEqual([parse('1000-5000ha').patch.sizeMin, parse('1000-5000ha').patch.sizeMax], [1000, 5000]);
  assert.equal(parse('more than 2 weeks').patch.durMin, 15);
  assert.equal(parse('days:<3').patch.durMax, 2);
  assert.equal(parse('size:>500').patch.sizeMin, 500);
  assert.equal(parse('megafires').patch.sizeMin, 10000);
  assert.equal(parse('1000 ha').patch.sizeMin, 1000, 'a four-digit number with a unit is a size, not a year');
  assert.equal(parse('named').patch.named, true);
  assert.equal(parse('has:spread').patch.spread, true);
  assert.deepEqual([parse('oldest').patch.sort, parse('oldest').patch.dir], ['date', 'asc']);
  assert.equal(parse('sort:distance').patch.sort, 'km');
  assert.equal(parse('human-caused').patch.causes[0], 'Human');
});

test('parseText resolves places by name, quoted name, prefix and coordinates', () => {
  assert.equal(parse('near:"prince albert"').patch.near.label, 'Prince Albert');
  assert.equal(parse('near prince albert within 30 km').patch.radius, 30);
  assert.equal(parse('close to Air Ronge').patch.near.label, 'Air Ronge');
  const c = parse('near 55.1,-105.3 25km').patch;
  assert.deepEqual([c.near.lat, c.near.lon, c.radius], [55.1, -105.3, 25]);
  const missing = parse('near Atlantis');
  assert.equal(missing.patch.near, undefined);
  assert.equal(missing.notes.length, 1);
  assert.equal(parseText('near La Ronge').notes[0], 'Community names need the live SPSA layer, which has not loaded');
});

test('parseText leaves names alone and ignores inherited object keys', () => {
  const p = parse('"big creek" shoe -creek constructor');
  assert.equal(p.text, '"big creek" shoe -creek constructor');
  assert.deepEqual(p.patch.months, []);
  assert.equal(parse('sort:constructor').patch.sort, undefined);
});

test('search filters on every dimension and sorts', () => {
  const fires = FIRES();
  assert.equal(run(fires, '').count, 6);
  assert.deepEqual(run(fires, 'lightning 2015').results.map((f) => f.fire_id), ['SK-2015-15LA-EGG', 'SK-2015-15LA-CLARK']);
  assert.deepEqual(run(fires, 'near La Ronge within 45 km').results.map((f) => f.fire_id), ['SK-2015-15LA-EGG', 'SK-2015-15LA-CLARK']);
  assert.ok(run(fires, 'near La Ronge within 45 km').results.every((f) => f._km <= 45));
  assert.deepEqual(run(fires, 'shoe').results.map((f) => f.fire_id), ['SK-2025-25LF-SHOE']);
  assert.deepEqual(run(fires, '"big creek"').results.map((f) => f.fire_id), ['SK-1981-BIGCREEK']);
  assert.equal(run(fires, 'lightning -egg').count, 2);
  assert.deepEqual(run(fires, 'longer than 3 months').results.map((f) => f.fire_id), ['SK-2025-25LF-SHOE', 'SK-2015-15LA-EGG']);
  assert.deepEqual(run(fires, 'oldest').results[0].fire_id, 'SK-1981-BIGCREEK');
  assert.equal(run(fires, 'named').count, 4, 'Shoe, Egg, Clark (from its id) and Big Creek have names; numbered ids do not');
  assert.equal(search(fires, { ...emptyQuery(), zones: ['EXT'] }).count, 1);
  assert.equal(search(fires, { ...emptyQuery(), bbox: [-106, 55, -105, 56] }).count, 2);
  const spread = search(fires, { ...emptyQuery(), spread: true }, { spreadIds: new Set(['SK-2025-25LF-SHOE']) });
  assert.deepEqual(spread.results.map((f) => f.fire_id), ['SK-2025-25LF-SHOE']);
  assert.equal(Math.round(run(fires, 'lightning').ha), 138847 + 24422 + 150);
});

test('facets count each choice with every other filter applied', () => {
  const r = run(FIRES(), 'lightning 2015');
  // Year facet ignores the year filter, cause facet ignores the cause filter
  assert.equal(r.facets.year.get(2003).count, 1);
  assert.equal(r.facets.year.get(2025), undefined, 'Shoe is human-caused, so it fails cause too');
  assert.equal(r.facets.cause.get('Lightning').count, 2);
  assert.equal(r.facets.cause.get('Human'), undefined);
  assert.equal(r.facets.month.get(5).count, 2);
  // A class facet ignores the size bounds that share it, but not the other way round
  const s = run(FIRES(), '>1000ha');
  assert.equal(s.facets.cls.get('B').count, 1);
});

test('compile gives the same answer as search', () => {
  const fires = FIRES();
  const q = mergeQuery(emptyQuery(), parse('lightning since 2010').patch);
  assert.deepEqual(fires.filter(compile(q)).map((f) => f.fire_id).sort(), search(fires, q).results.map((f) => f.fire_id).sort());
});

test('queries survive a URL round trip and malformed input is dropped', () => {
  const q = mergeQuery(emptyQuery(), { ...parse('lightning near La Ronge within 30km jun-aug 2010-2015 class:e >2 weeks named').patch, text: 'egg' });
  const back = fromParams(toParams(q));
  assert.deepEqual(back, normalizeQuery({ ...q, near: { ...q.near, lat: +q.near.lat.toFixed(4), lon: +q.near.lon.toFixed(4) } }));
  const bad = fromParams('from=abc&to=1990&m=0,13,7&cause=Fire,Human&class=Z,e&near=1,2&bbox=1,2,3&sort=__proto__&dir=up');
  assert.equal(bad.from, null);
  assert.deepEqual(bad.months, [6]);
  assert.deepEqual(bad.causes, ['Human']);
  assert.deepEqual(bad.classes, ['E']);
  assert.equal(bad.near, null);
  assert.equal(bad.bbox, null);
  assert.deepEqual([bad.sort, bad.dir], ['size', 'desc']);
  assert.equal(toParams(emptyQuery()).toString(), '');
  assert.ok(isEmptyQuery(fromParams('')));
});

test('describe names each part and withoutPart removes it', () => {
  const q = mergeQuery(emptyQuery(), parse('human since 2010 over 500 ha near Prince Albert').patch);
  assert.deepEqual(describe(q).map((p) => p.text), ['Human', 'since 2010', '≥ 500 ha', 'within 50 km of Prince Albert']);
  const r = withoutPart(q, 'size');
  assert.equal(r.sizeMin, null);
  assert.equal(r.causes[0], 'Human');
  assert.equal(withoutPart(q, 'years').from, null);
});

test('CSV and GeoJSON exports quote and carry every column', () => {
  const fires = prepare([fire('SK-1-A', '2020-06-01', 12.5, 55, -105, 'Human', { fire_name: 'Smith, "Big" Lake' })]);
  const csv = toCSV(fires, { near: false });
  const [head, row] = csv.trim().split('\r\n');
  assert.equal(head, 'fire_id,name,ignition_date,out_date,duration_days,size_ha,size_class,general_cause,latitude,longitude,protection_zone');
  assert.ok(row.startsWith('SK-1-A,"Smith, ""Big"" Lake fire",2020-06-01,,,12.5,C,Human,55,-105,'));
  const gj = toGeoJSON(fires, { query: ['Human'] });
  assert.equal(gj.type, 'FeatureCollection');
  assert.deepEqual(gj.features[0].geometry.coordinates, [-105, 55]);
  assert.equal(gj.features[0].properties.size_class, 'C');
});

test('the database hands search every column it filters on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'emberline-search-'));
  const db = openDb(join(dir, 'test.db'));
  try {
    replaceSource(db, 'cnfdb', [
      { fire_id: 'SK-2015-X', ignition_date: '2015-06-06', size_ha: 50, latitude: 55, longitude: -105, general_cause: 'Lightning', out_date: '2015-06-20', protection_zone: 'Intensive' },
    ]);
    const rows = prepare(allFires(db, 'cnfdb'));
    assert.equal(rows[0].days, 14);
    assert.equal(rows[0].protection_zone, 'Intensive');
    assert.equal(search(rows, { ...emptyQuery(), zones: ['Intensive'], durs: ['d7'] }).count, 1);
    const cols = queryFires(db, { source: 'cnfdb' }).columns;
    assert.deepEqual([cols.out_date[0], cols.protection_zone[0]], ['2015-06-20', 'Intensive']);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
