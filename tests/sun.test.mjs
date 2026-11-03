import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, sunAltitude, solarTerms, atLocalTime, localClock } from '../src/sun.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('summer solstice noon in Regina: high sun due south', () => {
  // Regina 50.45°N 104.6°W; local solar noon ≈ 18:58 UTC
  const s = sunPosition(new Date('2025-06-21T18:58:00Z'), 50.45, -104.6);
  near(s.altitude, 90 - 50.45 + 23.44, 0.6, 'altitude');
  near(s.azimuth, 180, 3, 'azimuth');
});

test('winter solstice noon in La Ronge: low sun', () => {
  const s = sunPosition(new Date('2025-12-21T19:01:00Z'), 55.1, -105.28);
  near(s.altitude, 90 - 55.1 - 23.44, 0.7, 'altitude');
});

test('morning sun is in the east, evening in the west, midnight below the horizon', () => {
  const day = new Date('2025-07-15T12:00:00Z');
  const morning = sunPosition(atLocalTime(day, 8), 54, -105);
  const evening = sunPosition(atLocalTime(day, 19), 54, -105);
  const midnight = sunPosition(atLocalTime(day, 0.5), 54, -105);
  assert.ok(morning.azimuth > 60 && morning.azimuth < 130, `morning az ${morning.azimuth}`);
  assert.ok(evening.azimuth > 230 && evening.azimuth < 310, `evening az ${evening.azimuth}`);
  assert.ok(midnight.altitude < 0, 'midnight below horizon');
});

test('fast altitude path matches the full calculation', () => {
  const d = new Date('2024-05-03T22:30:00Z');
  near(sunAltitude(solarTerms(d), 57.2, -103.1), sunPosition(d, 57.2, -103.1).altitude, 1e-9, 'altitude');
});

test('local clock helpers use Saskatchewan time (UTC−6, no DST)', () => {
  const d = atLocalTime(new Date('2025-07-01T03:00:00Z'), 14.5); // 03:00 UTC is still June 30 in CST
  assert.equal(d.toISOString(), '2025-06-30T20:30:00.000Z');
  assert.equal(localClock(d), '14:30');
});
