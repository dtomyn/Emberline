// Security helpers: HTML escaping, URL-override confinement, request parsing, CSV injection, zip bounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { esc } from '../src/data.js';
import { sameOrigin, spsaLayer } from '../src/config.js';
import { toCSV } from '../src/search.js';
import { intParam, localHost, CSP } from '../server/http.mjs';
import { readZip } from '../scripts/lib/unzip.mjs';

test('esc neutralizes markup in third-party names', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(`"O'Brien" & co`), '&quot;O&#39;Brien&quot; &amp; co');
  assert.equal(esc(null), '');
  assert.equal(esc(2023), '2023');
});

test('?api= and ?data= stay on this site', () => {
  const base = 'http://localhost:5173/index.html?x=1';
  assert.equal(sameOrigin('./api', base), './api');
  assert.equal(sameOrigin('/data/fires.json', base), '/data/fires.json');
  assert.equal(sameOrigin('http://localhost:5173/api', base), 'http://localhost:5173/api');
  assert.equal(sameOrigin('https://evil.example/api', base), null);
  assert.equal(sameOrigin('//evil.example/api', base), null);
  assert.equal(sameOrigin('javascript:alert(1)', base), null);
  assert.equal(sameOrigin(null, base), null);
  assert.equal(sameOrigin('./api', undefined), null); // in Node there is no page, so no override
});

test('?activeFires= must be a layer on the SPSA ArcGIS server', () => {
  const root = 'https://gis.saskatchewan.ca/arcgis/rest/services';
  assert.equal(spsaLayer('Wildfire/ActiveFires/MapServer/0', root), 'Wildfire/ActiveFires/MapServer/0');
  assert.equal(spsaLayer(`${root}/Wildfire/X/MapServer/0`, root), `${root}/Wildfire/X/MapServer/0`);
  assert.equal(spsaLayer('https://evil.example/arcgis/rest/services/X/MapServer/0', root), null);
  assert.equal(spsaLayer('http://gis.saskatchewan.ca/arcgis/rest/services/X/MapServer/0', root), null);
  assert.equal(spsaLayer('https://gis.saskatchewan.ca.evil.example/arcgis/rest/services/X', root), null);
  assert.equal(spsaLayer('//evil.example/x', root), null);
  assert.equal(spsaLayer('data:text/plain,hi', root), null);
});

test('integer query params are clamped and default when junk', () => {
  assert.equal(intParam(null, 0, 0, 9999), 0);
  assert.equal(intParam('', 9999, 0, 9999), 9999);
  assert.equal(intParam('abc', 5, 0, 9999), 5);
  assert.equal(intParam('2023.7', 0, 0, 9999), 2023);
  assert.equal(intParam('-50', 0, 0, 9999), 0);
  assert.equal(intParam('1e9', 0, 0, 9999), 9999);
});

test('only local Host headers pass on a loopback server (DNS rebinding)', () => {
  for (const h of ['localhost', 'localhost:5173', '127.0.0.1:5173', '[::1]:5173', 'LOCALHOST:1', undefined, '']) assert.ok(localHost(h), h);
  for (const h of ['evil.example', 'evil.example:5173', '127.0.0.1.evil.example', 'localhost.evil.example:5173']) assert.ok(!localHost(h), h);
});

test('CSP blocks inline and third-party scripts', () => {
  const script = CSP.split('; ').find((d) => d.startsWith('script-src'));
  assert.equal(script, "script-src 'self' https://unpkg.com");
  assert.match(CSP, /object-src 'none'/);
  assert.match(CSP, /frame-ancestors 'none'/);
});

test('CSV export defuses spreadsheet formulas but keeps negative numbers', () => {
  const fire = { fire_id: '=HYPERLINK("http://x","y")', label: '+cmd', ignition_date: '2023-05-01', size_ha: 10, cls: 'C', general_cause: '@SUM(1)', latitude: 55.1, longitude: -105.3, protection_zone: '-z' };
  const [, row] = toCSV([fire], { near: false }).trim().split('\r\n');
  assert.ok(row.startsWith(`"'=HYPERLINK(""http://x"",""y"")"`), row);
  assert.match(row, /,'\+cmd,/);
  assert.match(row, /,'@SUM\(1\),/);
  assert.match(row, /,-105\.3,/);
  assert.match(row, /,'-z$/);
});

test('zip reader will not inflate past the declared size', () => {
  const payload = Buffer.alloc(1_000_000, 0x41);
  const comp = deflateRawSync(payload);
  const name = Buffer.from('a.txt');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(10, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(10, 24); // claims 10 bytes; really 1 MB
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  const path = join(mkdtempSync(join(tmpdir(), 'emberline-zip-')), 'bomb.zip');
  writeFileSync(path, Buffer.concat([local, name, comp, central, name, eocd]));
  const [entry] = readZip(path);
  assert.throws(() => entry.read(), /RangeError|larger than|maxOutputLength|Cannot create a Buffer/i);
});
