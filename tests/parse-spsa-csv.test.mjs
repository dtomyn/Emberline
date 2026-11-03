import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseDate, normalizeCause, convert } from '../scripts/parse-spsa-csv.mjs';

test('parseCsv handles quotes, embedded commas, CRLF and BOM', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('parseDate normalizes common formats', () => {
  assert.equal(parseDate('2015-06-27'), '2015-06-27');
  assert.equal(parseDate('2015/6/7'), '2015-06-07');
  assert.equal(parseDate('27/06/2015'), '2015-06-27');
  assert.equal(parseDate('2015-06-27T14:00:00Z'), '2015-06-27');
  assert.equal(parseDate('not a date'), null);
});

test('normalizeCause maps SPSA vocabulary', () => {
  assert.equal(normalizeCause('LTG'), 'Lightning');
  assert.equal(normalizeCause('Human - Recreation'), 'Human');
  assert.equal(normalizeCause('Industrial'), 'Human');
  assert.equal(normalizeCause(''), 'Unknown');
  assert.equal(normalizeCause('Under investigation'), 'Unknown');
});

test('convert accepts header aliases and drops bad rows', () => {
  const csv = [
    'Fire Number,Start Date,Area (ha),Lat,Long,Cause',
    'A1,2015-07-01,"1,250.5",55.1,105.3,Lightning', // positive longitude gets flipped
    'A2,2015-07-02,3,45.0,-105,Human',             // outside Saskatchewan
    'A3,bad,3,55,-105,Human',                       // bad date
    'A1,2015-07-03,3,55,-105,Human',                // duplicate id
  ].join('\n');
  const { fires, rejects } = convert(csv);
  assert.equal(fires.length, 1);
  assert.deepEqual(fires[0], {
    fire_id: 'A1', ignition_date: '2015-07-01', size_ha: 1250.5,
    latitude: 55.1, longitude: -105.3, general_cause: 'Lightning',
  });
  assert.equal(rejects.outOfProvince, 1);
  assert.equal(rejects.badDate, 1);
  assert.equal(rejects.duplicate, 1);
});
