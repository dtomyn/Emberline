/**
 * http.mjs: small request-hardening helpers for server/index.mjs, kept apart so tests can import them
 * without starting the server.
 */

// Scripts only from this server and the pinned CDN (index.html also pins them with SRI hashes); MapLibre
// runs its worker from a blob. Map tiles, live layers and terrain come from several public https hosts.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** An integer query value clamped to [lo, hi], or `fallback` when it is missing or not a number. */
export function intParam(value, fallback, lo, hi) {
  const n = value == null || value === '' ? NaN : Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True when a Host header names this machine ("localhost:5173", "127.0.0.1", "[::1]:5173").
 * A missing header (HTTP/1.0) is allowed; DNS rebinding always sends the attacker's hostname.
 */
export function localHost(header) {
  if (header == null || header === '') return true;
  return LOCAL_NAMES.has(String(header).replace(/:\d+$/, '').toLowerCase());
}
