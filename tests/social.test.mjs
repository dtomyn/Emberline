import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socialFigures, headlineHa } from '../social/figures.js';

const year = (y, n, ha = 1) => Array.from({ length: n }, () => ({ year: y, size_ha: ha }));

test('the cards count only the continuous record (first year with 100+ fires)', () => {
  const fires = [...year(1959, 12, 50), ...year(1980, 95), ...year(1981, 120, 10), ...year(2025, 200, 5)];
  const f = socialFigures(fires);
  assert.equal(f.firstYear, 1981);
  assert.equal(f.lastYear, 2025);
  assert.equal(f.recordFrom, 1959);
  assert.equal(f.fires, 320);
  assert.equal(f.hectares, 2200);
  assert.equal(f.text.range, '1981–2025');
  assert.equal(f.text.since, '1981');
  assert.equal(f.text.fires, '320');
  assert.match(f.text.caption, /1981–2025 · CNFDB$/);
});

test('mock data never reaches a social image', () => {
  assert.throws(() => socialFigures(year(2006, 200), 'mock'), /real data only/);
  assert.throws(() => socialFigures([], 'cnfdb'), /No cnfdb fires/);
});

test('headline hectares', () => {
  assert.equal(headlineHa(25_653_060), '25.7M');
  assert.equal(headlineHa(812_400), '812k');
  assert.equal(headlineHa(950), '950');
});
