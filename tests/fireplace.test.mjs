import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seeded, firePop, crackleEvents, LEVEL, DUCKED, createFireplace } from '../src/fireplace.js';

test('crackles arrive at about the asked rate, mostly tiny ticks, sometimes in bursts', () => {
  const ev = crackleEvents(seeded(7), 0, 120, 8);
  const lead = ev.filter((e) => !e.burst);
  assert.ok(ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t), 'in time order');
  assert.ok(ev.every((e) => e.t >= 0 && e.t < 120));
  assert.ok(Math.abs(lead.length / 120 - 8) < 2, `${(lead.length / 120).toFixed(1)} crackles/s`);
  const kinds = ev.reduce((m, e) => ({ ...m, [e.kind]: (m[e.kind] ?? 0) + 1 }), {});
  assert.ok(kinds.tick > kinds.snap && kinds.snap > (kinds.pop ?? 0), JSON.stringify(kinds));
  assert.ok(ev.length > lead.length * 1.2, 'some crackles come in bursts');
});

test('the same seed gives the same fire', () => {
  assert.deepEqual(crackleEvents(seeded(3), 0, 5, 6), crackleEvents(seeded(3), 0, 5, 6));
});

test('within a chapter the biggest fire knocks deepest and loudest, and west is left', () => {
  const range = [100, 500_000];
  const big = firePop({ size_ha: 500_000, longitude: -109 }, range);
  const small = firePop({ size_ha: 100, longitude: -102 }, range);
  assert.ok(big.freq < small.freq && big.level > small.level);
  assert.ok(big.pan < 0 && small.pan > 0);
});

test('the bed ducks well below its resting level under the voice', () => {
  assert.ok(DUCKED / LEVEL < 0.5); // at least 6 dB of ducking
  assert.equal(createFireplace(), null); // no Web Audio in Node: the film plays without it
});
