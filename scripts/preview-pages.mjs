#!/usr/bin/env node
/**
 * preview-pages.mjs: serves the static build (dist/, from "npm run build:pages") the way GitHub Pages
 * will: plain files, no API, no headers beyond the content type, under a /<repo>/ subpath so relative
 * paths are tested too. Loopback only; this is a preview, not a server for the site.
 *
 * Usage: node scripts/preview-pages.mjs [port]    (default 5180) → http://localhost:5180/Wildfire-Sask/
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve('dist');
const PORT = Number(process.argv[2] ?? 5180);
const PREFIX = '/Wildfire-Sask';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === PREFIX) return res.writeHead(302, { Location: `${PREFIX}/` }).end();
  if (!url.pathname.startsWith(`${PREFIX}/`)) return res.writeHead(404).end('Not found');
  let path = normalize(join(ROOT, decodeURIComponent(url.pathname.slice(PREFIX.length))));
  if (path !== ROOT && !path.startsWith(ROOT + sep)) return res.writeHead(403).end();
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(await readFile(path));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Static preview of dist/ at http://localhost:${PORT}${PREFIX}/`));
