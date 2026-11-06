// The static GitHub Pages build: API routes map to snapshot files, and index.html carries the marker and CSP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiUrl, CONFIG } from '../src/config.js';
import { staticIndex } from '../scripts/lib/pages.mjs';
import { CSP } from '../server/http.mjs';

const server = { staticSite: false, base: './api' };
const pages = { staticSite: true, base: './api' };

test('apiUrl keeps the server routes unchanged', () => {
  assert.equal(apiUrl('/sources', {}, server), './api/sources');
  assert.equal(apiUrl('/fires', { source: 'cnfdb' }, server), './api/fires?source=cnfdb');
  assert.equal(apiUrl('/spread/nbac-2025-273', {}, server), './api/spread/nbac-2025-273');
  assert.equal(apiUrl('/voice/0123456789abcdef.ogg', {}, server), './api/voice/0123456789abcdef.ogg');
  assert.equal(apiUrl('/live', {}, server), './api/live');
  assert.equal(apiUrl('/provenance/ping/cnfdb', {}, server), './api/provenance/ping/cnfdb');
});

test('apiUrl maps routes to the files build-pages.mjs writes', () => {
  assert.equal(apiUrl('/sources', {}, pages), './api/sources.json');
  assert.equal(apiUrl('/fires', { source: 'cnfdb' }, pages), './api/fires/cnfdb.json');
  assert.equal(apiUrl('/spread', {}, pages), './api/spread.json');
  assert.equal(apiUrl('/spread/nbac-2025-273', {}, pages), './api/spread/nbac-2025-273.json');
  assert.equal(apiUrl('/provenance', {}, pages), './api/provenance.json');
  assert.equal(apiUrl('/voice', {}, pages), './api/voice.json');
  assert.equal(apiUrl('/voice/0123456789abcdef.ogg', {}, pages), './api/voice/0123456789abcdef.ogg', 'clips keep their name');
  assert.equal(apiUrl('/fires', { source: '../x' }, pages), './api/fires/..%2Fx.json', 'a value never adds a path segment');
});

test('apiUrl gives null for routes only a server can answer', () => {
  for (const r of ['/live', '/search', '/provenance/ping/cnfdb']) assert.equal(apiUrl(r, {}, pages), null, r);
});

test('the default is the server, since Node has no <meta name="emberline-static">', () => {
  assert.equal(CONFIG.staticSite, false);
  assert.equal(apiUrl('/sources'), './api/sources');
});

test('staticIndex adds the marker and the CSP, without frame-ancestors', () => {
  const html = staticIndex(readFileSync('index.html', 'utf8'));
  assert.match(html, /<meta name="emberline-static"/);
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'CSP meta present');
  assert.ok(!csp.includes('frame-ancestors'), 'frame-ancestors is ignored in a <meta>');
  assert.equal(csp, CSP.split('; ').filter((d) => !d.startsWith('frame-ancestors')).join('; '));
  assert.ok(html.indexOf('emberline-static') < html.indexOf('<script'), 'marker comes before any script');
  assert.throws(() => staticIndex('<html></html>'), /meta charset/);
});
