// Every external endpoint the browser code calls lives in src/config.js (CLAUDE.md, 03-constraints).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';
import { SOURCES } from '../src/provenance.js';

const SRC = new URL('../src/', import.meta.url);
// config.js holds the endpoints; provenance.js also links publisher pages and licences, which are not called.
const EXEMPT = new Set(['config.js', 'provenance.js']);

function jsFiles(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? jsFiles(new URL(`${d.name}/`, dir), `${prefix}${d.name}/`) : d.name.endsWith('.js') ? [`${prefix}${d.name}`] : []);
}

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no https endpoint is written into src/ outside config.js', () => {
  const files = jsFiles(SRC).filter((f) => !EXEMPT.has(f));
  assert.ok(files.includes('main.js') && files.includes('services/live.js'), 'scan reaches src/ and its subfolders');
  const found = [];
  for (const f of files) {
    const code = stripComments(readFileSync(fileURLToPath(new URL(f, SRC)), 'utf8'));
    for (const m of code.matchAll(/['"`](https:\/\/[^'"`\s]+)/g)) found.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(found, []);
});

test('scene and lightning endpoints are https and in CONFIG', () => {
  for (const u of [CONFIG.scene.basemapStyle, CONFIG.scene.terrainTiles, CONFIG.scene.terrainPage, CONFIG.geomet.wmsUrl]) {
    assert.match(u, /^https:\/\//);
  }
  assert.match(CONFIG.scene.terrainTiles, /\{z\}\/\{x\}\/\{y\}/);
  assert.ok(CONFIG.geomet.lightningLayer);
});

test('the Sources view asks the same endpoints the app uses', () => {
  const by = (id) => SOURCES.find((s) => s.id === id);
  assert.equal(by('basemap').ping.url, CONFIG.scene.basemapStyle);
  assert.ok(by('terrain').ping.url.startsWith(CONFIG.scene.terrainTiles.split('{z}')[0]));
  assert.ok(!/[{}]/.test(by('terrain').ping.url), 'terrain check asks one real tile');
  assert.ok(by('cldn').ping.url.startsWith(`${CONFIG.geomet.wmsUrl}?`));
  assert.ok(by('cldn').ping.url.includes(CONFIG.geomet.lightningLayer));
});

test('the CARTO key goes on basemap URLs only, and only when set', async () => {
  const { withBasemapKey } = await import('../src/config.js');
  const style = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  assert.equal(withBasemapKey(style, ''), style, 'no key: unchanged');
  assert.equal(withBasemapKey(style, 'abc'), `${style}?key=abc`);
  assert.equal(withBasemapKey('https://tiles.basemaps.cartocdn.com/v/1/vectortiles/carto.streets/v2/{z}/{x}/{y}.mvt', 'abc'),
    'https://tiles.basemaps.cartocdn.com/v/1/vectortiles/carto.streets/v2/{z}/{x}/{y}.mvt?key=abc', 'templates kept');
  assert.equal(withBasemapKey(`${style}?key=own`, 'abc'), `${style}?key=own`, 'an existing key is kept');
  for (const other of [CONFIG.scene.terrainTiles, 'https://evilbasemaps.cartocdn.com.example/x', 'http://basemaps.cartocdn.com/x', './api/sources.json']) {
    assert.equal(withBasemapKey(other, 'abc'), other, `${other} untouched`);
  }
});

test('the map credits name each licence the data asks for', () => {
  const c = CONFIG.credits;
  assert.match(c.record, /Open Government Licence – Canada/);
  assert.match(c.lightning, /ECCC/);
  assert.match(c.basemap, /OpenStreetMap.*CARTO/);
  assert.match(c.spsa, /Saskatchewan/);
  assert.match(c.terrain, /USGS/);
});
