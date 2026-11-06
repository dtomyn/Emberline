/**
 * pages.mjs: pure helpers for scripts/build-pages.mjs, kept apart so tests can import them without building.
 */
import { CSP } from '../../server/http.mjs';

/**
 * index.html for the static site: adds <meta name="emberline-static"> (src/config.js reads it) and the
 * server's Content-Security-Policy as a <meta>, since a static host can't send it as a header.
 * frame-ancestors is ignored in a <meta>, so it is left out.
 */
export function staticIndex(html, csp = CSP) {
  const anchor = '<meta charset="utf-8" />';
  if (!html.includes(anchor)) throw new Error('index.html: no <meta charset> to anchor on');
  const policy = csp.split('; ').filter((d) => !d.startsWith('frame-ancestors')).join('; ');
  return html.replace(anchor, `${anchor}
  <meta name="emberline-static" content="Static build: no server; ./api holds snapshots of the API" />
  <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
}
