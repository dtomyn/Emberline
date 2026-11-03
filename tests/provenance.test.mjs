import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, GROUPS, TRUTH, sourceYears, coverageOf, funnel, citation, readPing, describePing } from '../src/provenance.js';

const info = {
  sources: [{ source: 'cnfdb', fires: 27095, min_year: 1959, max_year: 2025 }, { source: 'mock', fires: 9070, min_year: 2006, max_year: 2025 }],
  spread: { fires: 184, minYear: 2010, maxYear: 2025, hotspots: 1277526 },
};

test('every source is complete and in a known group and truth level', () => {
  const ids = new Set();
  for (const s of SOURCES) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`); ids.add(s.id);
    assert.ok(GROUPS.some((g) => g.id === s.group), `${s.id} group`);
    assert.ok(TRUTH[s.truth], `${s.id} truth`);
    for (const k of ['name', 'short', 'owner', 'gives', 'how', 'request', 'color']) assert.ok(s[k], `${s.id}.${k}`);
    assert.match(s.color, /^#[0-9a-f]{6}$/i);
  }
});

test('simulated sources say so', () => {
  for (const id of ['mock', 'live-sim']) assert.equal(SOURCES.find((s) => s.id === id).truth, 'simulated');
});

test('checkable sources only point at fixed https URLs', () => {
  for (const s of SOURCES.filter((x) => x.ping)) {
    for (const u of s.ping.urls ?? [s.ping.url]) assert.match(u, /^https:\/\//, s.id);
  }
});

test('years come from the database, not the catalogue', () => {
  const by = (id) => sourceYears(SOURCES.find((s) => s.id === id), info);
  assert.deepEqual(by('cnfdb'), [1959, 2025]);
  assert.deepEqual(by('nbac'), [2010, 2025]);
  assert.deepEqual(by('hotspots'), [2010, 2025]);
  assert.equal(by('spsa-csv'), null);     // not loaded
  assert.equal(by('cldn'), null);         // live: no year span
  assert.deepEqual(coverageOf(1990, info).map((s) => s.id), ['cnfdb']);
  assert.deepEqual(coverageOf(2015, info).map((s) => s.id).sort(), ['cnfdb', 'hotspots', 'mock', 'nbac']);
});

test('funnel accounts for every rejected row', () => {
  const run = { rows_read: 27323, rows_loaded: 27095, notes: '{"prescribed":0,"assistRequest":125,"badCoord":3,"badDate":84,"duplicate":16}' };
  const f = funnel(run);
  assert.equal(f[0].n, 27323);
  assert.equal(f.at(-1).n, 27095);
  assert.deepEqual(f.slice(1, -1).map((s) => s.n), [-125, -84, -16, -3]);  // largest cut first, zeros dropped
  assert.equal(f.reduce((s, x, i) => (i === f.length - 1 ? s : s + x.n), 0), 27095);
  assert.deepEqual(funnel(null), []);
  assert.equal(funnel({ rows_read: 5, rows_loaded: 5, notes: 'not json' }).length, 2);
});

test('readPing understands each kind of reply', () => {
  assert.deepEqual(readPing('hits', '<wfs:FeatureCollection numberOfFeatures="3478" timeStamp="x">'), { count: 3478 });
  assert.deepEqual(readPing('hits', '<wfs:FeatureCollection numberMatched="12" numberReturned="0">'), { count: 12 });
  assert.deepEqual(readPing('arcgis-count', '{"count":16}'), { count: 16 });
  assert.deepEqual(readPing('arcgis-folder', '{"currentVersion":11.5,"folders":[],"services":[]}'), { services: 0 });
  assert.deepEqual(readPing('wms-time', '<Dimension name="time" units="ISO8601" default="x">2026-11-03T15:40:00Z/2026-11-03T18:40:00Z/PT10M</Dimension>'), { latest: '2026-11-03 18:40 UTC' });
  assert.deepEqual(readPing('head', '', { 'content-length': '25043218', 'last-modified': 'Tue, 11 Aug 2026 10:00:00 GMT' }), { bytes: 25043218, modified: '2026-08-11' });
});

test('describePing and citation read plainly', () => {
  assert.equal(describePing({ ok: true, ms: 120, count: 16, unit: 'communities' }), 'Answered in 120 ms · 16 communities right now');
  assert.equal(describePing({ ok: true, ms: 90, services: 0 }), 'Answered in 90 ms · folder empty (off-season)');
  assert.equal(describePing({ ok: false, ms: 20000, error: 'timed out' }), 'Did not answer (timed out) after 20000 ms');
  const c = citation(SOURCES.find((s) => s.id === 'cnfdb'), '2026-11-03');
  assert.match(c, /^Natural Resources Canada, Canadian Forest Service\. Canadian National Fire Database\. https:\/\/.+\. Accessed 2026-11-03\. Open Government Licence – Canada\.$/);
});
