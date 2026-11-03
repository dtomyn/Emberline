# Emberline: project intent for agents

Read this before changing anything. It records *why* the project is shaped the way it is.
The README covers *how* to run and use it.

## Purpose

Emberline is a personal GitHub portfolio project by the repo owner. The goal is to impress
the **Saskatchewan Public Safety Agency (SPSA)**. Two things matter equally:

1. **Visual "wow".** Animated, cinematic, polished. Fires ignite, glow, spread and cool to scars;
   3D hex columns rise; the camera flies through a story. Visual quality is a first-class requirement.
2. **Fully functional.** Real data, real services, working filters, scrubbing, detail cards and a
   live mode. Never a mock-up or a static picture.

When you trade off, keep both. Don't simplify the visuals to save effort, and don't fake functionality.

## Hard constraints (from the owner)

- **No data in GitHub.** The SQLite database, downloads and JSON exports all live in `data/`,
  which is gitignored. Every dataset must be reproducible with a load script
  (`scripts/load-*.mjs` → `data/wildfire.db`). A new data source means a new loader, never a checked-in file.
- **SQLite is the store** (`node:sqlite`, no native modules). Historical data reaches the
  front end through the server API, not through static files in the repo.
- **Real data is the default.** The CNFDB (`SRC_AGENCY == 'SK'`) is the primary historical
  source. Mock data exists only as an offline fallback, and the UI labels it clearly.
- **Honesty in the UI.** Anything simulated is labelled SIMULATED. Burn circles show
  *equal area*, not perimeters. Story figures are computed from the loaded data, never hard-coded.

## Key decisions and why

- **No build step, no npm dependencies.** Node 22.13+ built-ins (`node:sqlite`, `zlib`, `http`),
  with MapLibre GL 4.7.1 and deck.gl 9.0.38 from pinned CDN URLs. This keeps the repo easy for
  a reviewer to clone and run (`npm run load:cnfdb && npm start`). Ask before adding dependencies or a bundler.
- **CNFDB over the SPSA CSV.** The SPSA 2006–2025 Open Government CSV named in the original brief
  could not be found on open.canada.ca (searched 2026-11). CNFDB covers Saskatchewan from 1959,
  continuously from 1981. `load-csv.mjs` still accepts an SPSA-schema CSV if one turns up.
- **Live data tiers** (`src/services/live.js`): configured SPSA layer → auto-discovery in the
  SPSA `Wildfire`/`SPSA` ArcGIS folders → CWFIS satellite hotspots (`agency='SK'`) → labelled
  simulation. SPSA publishes seasonal layers, so discovery lets the app pick them up without code changes.
- **Every external endpoint lives in `src/config.js`** and can be overridden by query string.

## Verified facts about external services (as of 2026-11-03)

- `https://gis.saskatchewan.ca/arcgis/rest/services` (ArcGIS 11.5) supports `f=geojson` and sends
  CORS headers. `SPSA/Communities/MapServer` layers 1, 3–6 return community points.
  `SPSA/ProtectionAreas/MapServer/1` returns names but **null geometry**. The `Wildfire` folder is empty off-season.
- `gisappl.saskatchewan.ca` REST returns 404. The public viewer is at `gisappl.saskatchewan.ca/Html5Ext/?viewer=wfmpublic`.
- CWFIS GeoServer `public:activefires_current` **no longer exists**. Use `public:hotspots_last24hrs`
  (has an `agency` field) and `public:m3_polygons_current` (filter with CQL `BBOX(geometry,…)`;
  the WFS `bbox=` parameter errors).
- CNFDB point zip: `https://cwfis.cfs.nrcan.gc.ca/downloads/nfdb/fire_pnt/current_version/NFDB_point_txt.zip`.
  Some rows have quoted commas. `REP_DATE` can disagree with `YEAR`/`MONTH`/`DAY`; the loader prefers `REP_DATE`.

- NBAC WFS `public:nbac` (fields lower case, `admin_area='SK'`) returns WGS84 GeoJSON but stops at **2024**.
  2025 is only in `downloads/nbac/NBAC_2025_<date>.zip` (shapefile, Canada LCC, DBF field `ADMIN_NAME`).
  Big perimeters are huge (the 2023 445k ha fire is 728k vertices / 20 MB), so the loader simplifies them.
- `public:hotspots` (native CRS EPSG:3978, has `frp`, `ws`, `wd`, `rep_day`) **times out (504 after 20 s)**
  for multi-month or bbox queries. One `rep_day` with `agency='SK'` takes about 4–16 s. Yearly archives
  (`downloads/hotspots/archive/<year>_hotspots.zip`, about 140 MB) are the bulk alternative.

Re-check these before relying on them. Government endpoints change.

## Conventions

- ES modules throughout. `src/` modules must also run in Node, since the server imports
  `services/live.js`, `data.js` and `config.js`. Guard browser globals.
- Match the surrounding style: small focused modules, explanatory header comments, no frameworks.
- Tests: `npm test` (`node --test tests/`). Add tests for any parser or loader change.
- Verify visual changes in a real browser. Note that the desktop preview pane throttles
  `requestAnimationFrame` (about 1 fps), so judge smoothness in a normal browser.
- Commit messages end with the Co-Authored-By trailer the session provides.

## Spread mode (True Spread Replay, idea 1 in IDEAS.md): built

`npm run load:spread` → `spread_fires` / `spread_hotspots`. Shared algorithms live in `src/spread.js`
(tested in `tests/spread.test.mjs`) and the UI in `src/spread-mode.js`. The front is interpolated between
real detections, which the panel and About dialog say. Keep that wording if you change the method.

## Open threads / ideas not yet done

The full idea backlog, with verified public data sources and a suggested build order, is in
[docs/IDEAS.md](docs/IDEAS.md). Narration should use the local Kokoro setup from
`C:\DevSource\IRISIdeas` (voice `af_heart`); generated audio belongs in gitignored `data/`.


- Small-screen layout works but is unpolished.
- Satellite perimeters are wired up but were empty during testing. Confirm they render in fire season.
- Possible additions: fire-weather (FWI) overlays from CWFIS, decade comparison view, shareable
  URL state beyond the mode hash, `live_snapshots` history playback.
