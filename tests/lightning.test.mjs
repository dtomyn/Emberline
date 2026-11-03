import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStorms, boltPaths, parseTimeDimension } from '../src/lightning.js';
import { noteFor } from '../src/sonify.js';

const fire = (id, t, lat, lon, cause = 'Lightning', size_ha = 10) => ({ fire_id: id, t, latitude: lat, longitude: lon, general_cause: cause, size_ha });

test('buildStorms links lightning fires within 1 day and 60 km, transitively', () => {
  const fires = [
    fire('a', 100, 55.0, -105.0),
    fire('b', 100, 55.3, -105.2),   // ~36 km from a
    fire('c', 101, 55.6, -105.4),   // next day, ~36 km from b, ~73 km from a: joins via b
    fire('d', 100, 58.0, -103.0),   // far away
    fire('e', 100, 55.1, -105.1, 'Human'), // not lightning
    fire('f', 104, 55.0, -105.0),   // same place, days later
  ].sort((x, y) => x.t - y.t);
  const { storms, strikes } = buildStorms(fires);
  assert.equal(storms.length, 1);
  assert.deepEqual(storms[0].fires.map((f) => f.fire_id).sort(), ['a', 'b', 'c']);
  assert.equal(storms[0].t0, 100);
  assert.equal(storms[0].t1, 101);
  assert.equal(strikes.length, 5, 'every lightning fire gets a strike, storm or not');
  assert.ok(strikes.every((s, i) => i === 0 || strikes[i - 1].t <= s.t), 'strikes sorted by time');
  assert.ok(strikes.every((s) => s.t < s.fire.t && s.t > s.fire.t - 0.3), 'strike lands shortly before its fire');
  assert.equal(strikes.find((s) => s.fire.fire_id === 'd').storm, null);
});

test('boltPaths runs from cloud height to the ignition point', () => {
  const [main, fork] = boltPaths(-105, 55, 0.42);
  assert.equal(main[0][2], 9000);
  assert.deepEqual(main.at(-1).slice(0, 2).map((v) => +v.toFixed(6)), [-105, 55]);
  assert.equal(main.at(-1)[2], 0);
  assert.ok(fork.length >= 3);
});

test('parseTimeDimension expands GeoMet start/end/period ranges', () => {
  const t = parseTimeDimension('2026-11-03T14:00:00Z/2026-11-03T15:00:00Z/PT10M');
  assert.equal(t.length, 7);
  assert.equal(t[0], '2026-11-03T14:00:00Z');
  assert.equal(t.at(-1), '2026-11-03T15:00:00Z');
});

test('noteFor: bigger fires are lower, cause picks the timbre, longitude pans', () => {
  const small = noteFor(fire('s', 10, 55, -109.5, 'Human', 0.1));
  const big = noteFor(fire('b', 10, 55, -102, 'Lightning', 200000));
  assert.ok(big.freq < small.freq);
  assert.ok(big.gain > small.gain);
  assert.equal(small.voice, 'wood');
  assert.equal(big.voice, 'bell');
  assert.ok(big.gong && !small.gong);
  assert.ok(small.pan < 0 && big.pan > 0);
});
