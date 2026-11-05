# 3. Hard constraints

These come from the owner. They are not open to trade-off without asking.

## No data in GitHub

- The SQLite database, raw downloads, generated audio and JSON exports all live in `data/`,
  which is gitignored.
- Every dataset must be reproducible with a load script (`scripts/load-*.mjs` → `data/wildfire.db`).
- A new data source means a **new loader**, never a checked-in file.

*Why:* the repo stays small and clean, licences are respected by fetching from the publisher,
and a reviewer always sees the current data rather than a stale snapshot.

## SQLite is the store

- `node:sqlite` (built into Node 22.13+), no native modules.
- Historical data reaches the front end **through the server API**, not through static files
  in the repo. (`npm run export:json` exists for static hosting, but its output stays outside the repo.)
- Each loader replaces only its own source, so several sources live side by side.

*Why:* one queryable store with an audit trail (`import_runs`) and no install step.

## Real data is the default

- The **CNFDB** (`SRC_AGENCY == 'SK'`) is the primary historical source.
- Mock data exists only as an **offline fallback**, and the UI labels it clearly.
- Live mode tries real sources first and labels its simulation.

## No build step, no npm dependencies

- Node built-ins only (`node:sqlite`, `zlib`, `http`) on the server and in loaders.
- MapLibre GL 4.7.1 and deck.gl 9.0.38 from pinned CDN URLs in the browser.
- Zip and shapefile readers are written in-repo (`scripts/lib/`).
- **Ask before adding a dependency or a bundler.**

*Why:* a reviewer clones and runs `npm run load:cnfdb && npm start` with nothing to install
and nothing to break.

## Code conventions that follow from this

- ES modules throughout. `src/` modules that the server imports (`config.js`, `data.js`,
  `services/live.js`, `narration.js`, `spread.js`) must also run in Node, so browser globals are guarded.
- Every external endpoint lives in `src/config.js` and can be overridden by query string (confined to
  this site or the SPSA server, see the decision log).
- Text from data or services reaches HTML only through `esc()` (`src/data.js`). No inline scripts or
  `on…=` attributes: the CSP in `server/http.mjs` blocks them.
- Parsers and loaders have tests (`npm test`); any change to them adds tests.
- Visual changes are checked in a real browser.
