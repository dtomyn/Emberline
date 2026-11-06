# Emberline: project intent for agents

Read this before changing anything. It records *why* the project is shaped the way it is.
The README covers *how* to run and use it. The full intent (purpose, principles, constraints,
per-mode intent, data truth levels, decision log, status) is in [docs/intent/](docs/intent/README.md);
update it in the same commit when an intent or decision changes.

## Purpose

Emberline is a personal GitHub portfolio project by the repo owner. It is built for the
**general public**: anyone who wants to understand the history of wildfire in Saskatchewan.
It is not built for the Saskatchewan Public Safety Agency (SPSA), which has its own internal
systems; SPSA is a data source, not the audience. Two things matter equally:

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
- **Every external endpoint the browser calls lives in `src/config.js`** (`tests/config.test.mjs` fails on an https URL
  written anywhere else in `src/`). Only `?api=`, `?data=` and `?activeFires=` can be overridden by query string.

## Verified facts about external services (as of 2026-11-03)

- `https://gis.saskatchewan.ca/arcgis/rest/services` (ArcGIS 11.5) supports `f=geojson` and sends
  CORS headers. `SPSA/Communities/MapServer` layers 1, 3–6 return community points.
  `SPSA/ProtectionAreas/MapServer/1` returns names but **null geometry**. The `Wildfire` folder is empty off-season.
- `gisappl.saskatchewan.ca` REST returns 404. The public viewer is at `gisappl.saskatchewan.ca/Html5Ext/?viewer=wfmpublic`.
- CWFIS GeoServer `public:activefires_current` **no longer exists**. Use `public:hotspots_last24hrs`
  (has an `agency` field) and `public:m3_polygons_current` (filter with CQL `BBOX(geometry,w,s,e,n,'EPSG:4326')`: **without the CRS it matches nothing**, since the native CRS is Lambert;
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
- Tests: `npm test` (`node --test "tests/*.test.mjs"`; a bare folder argument fails on Node 24, which CI uses). Add tests for any parser or loader change.
- Verify visual changes in a real browser. Note that the desktop preview pane throttles
  `requestAnimationFrame` (about 1 fps), so judge smoothness in a normal browser.
- Commit messages end with the Co-Authored-By trailer the session provides.

## Security rules (review of 2026-11-05)

- **Escape everything** from data or services with `esc()` from `src/data.js` before `innerHTML` or a deck.gl
  tooltip `html` (names from SPSA/ArcGIS, CNFDB, NBAC, error messages, labels). Prefer `textContent`.
- The server (`server/http.mjs` helpers) sends a CSP: no inline `<script>`, no `on…=` attributes, scripts only
  from `'self'` and `https://unpkg.com`. Upgrading MapLibre or deck.gl means recomputing the SRI `integrity`
  hashes in `index.html` (`openssl dgst -sha384 -binary file | openssl base64 -A`).
- URL overrides are confined in `src/config.js`: `?api=`/`?data=` same-origin, `?activeFires=` on the SPSA server.
- Loopback bind (127.0.0.1 and ::1) by default, foreign `Host` headers get 421, GET/HEAD only, 500s carry no detail.
  `/api/live?refresh` is throttled to once a minute. Tests: `tests/security.test.mjs`.

## Spread mode (True Spread Replay): built

`npm run load:spread` → `spread_fires` / `spread_hotspots`. Shared algorithms live in `src/spread.js`
(tested in `tests/spread.test.mjs`) and the UI in `src/spread-mode.js`. The front is interpolated between
real detections, which the panel and About dialog say. Keep that wording if you change the method.

## Lightning, sound and scene: built

- `src/lightning.js`: storms are lightning ignitions linked within 1 day / 60 km. Bolts and cells run
  on the **wall clock** once triggered (a replay day lasts milliseconds at speed), so strikes stay
  visible at any speed. Strike hour and cell shape are illustrative; keep the UI wording that says so.
- Live lightning: GeoMet `Lightning_2.5km_Density` has a 3-hour, 10-minute time dimension and sends
  `Access-Control-Allow-Origin: *`. Frames are fetched once as blobs; the loop waits for each
  `updateImage` to land, because overlapping loads abort.
- `src/scene.js`: install on `style.load` (not `isStyleLoaded()`, which also waits for basemap tiles).
  MapLibre rejects `hillshade-illumination-direction` of 360, so wrap the azimuth.
- With 3D terrain on, `main.js` clones every deck layer with a z-translation of `map.transform.elevation`;
  keep that if you add layers, or they float off the terrain.
- `frame()` schedules the next frame first, so one exception can't freeze the app.
- `src/sonify.js` starts its AudioContext only from the 🔊 click (browser autoplay rules).

## Documentary mode (Emberline Presents): built

- `src/story.js` gives each chapter a `say` line (numbers written for speech via `src/narration.js`), `cues`
  that fire on a spoken word, and a `hold`. `src/documentary.js` plays it: title card → chapters → end card.
- Voice is **local Kokoro, the IRISIdeas voice** (`af_heart`, speed 0.97, en-us phonemes + `SOUNDS` fixes). Keep
  `scripts/kokoro-voice.py`'s constants identical to IRISIdeas `scripts/render_explainer.py`.
- `npm run make:voice` rebuilds the story **in Node from SQLite** (same storms and spread list as the browser) so
  clip text matches what the browser builds; the manifest is keyed by exact line text. Change any wording or load
  new data → rerun it, or those lines fall back to the browser voice (labelled).
- The phonemizer reads "1981" as "nineteen hundred eighty one", so `speakable()` spells years out. Run Python
  with `-I`; on Windows reconfigure stdout to UTF-8 before printing phonemes.
- Pronunciation of names is unverified by ear beyond the IRISIdeas fixes. Listen before a demo.
  "Emberline" is said **EM-ber-line** (as in embers); the phonemizer stresses "BER", so `SOUNDS` fixes it.
- Thunder (live `sonify.js` and film `sound.py`) is a soft, distant low rumble with no crack, at most one per 1.5 s.
  The owner found the louder cracking version harsh; don't raise it.
- The film's sound bed is a **crackling wood fire** (`src/fireplace.js`), chosen by the owner over music. It must stay
  **subtle**: `LEVEL`/`DUCKED` were set by rendering it offline (`prerender`) and comparing RMS with the Kokoro clips
  (fire ≈ −34 to −38 dBFS between lines, −43 to −46 under the voice; voice ≈ −22.6). Re-measure if you change
  levels, rates or voices. The louder pops are real fires (`chapter.sound.fires`), and About says so.
  The AudioContext is created inside the Watch click, or browsers block it.

## Sources view (Read the rings): built

- `src/provenance.js` catalogues **every** source (data, live feeds, basemap, terrain, derivations, voice, sound,
  libraries, fonts) with owner, truth level, exact request and licence. Endpoints come from `CONFIG`; counts never
  live there, they come from `/api/provenance`. Add an entry whenever you add a source.
- `src/sources-view.js` draws it as a fire-scarred tree cross-section. "Ask the source now" goes through
  `/api/provenance/ping/<id>`, which only fetches the catalogue's fixed URLs.
- Licences: NRCan and ECCC data are listed under the Open Government Licence – Canada. The SPSA ArcGIS services
  state no licence (`copyrightText` empty, checked 2026-11-03); the card says "None stated" rather than guessing.

## Explainer film (`npm run film`): built

- Plan in `film/storyboard.md`, scenes and narration in `film/scenes.js` (figures computed from the record, never typed).
  `film/render.py` (IRISIdeas Python, headless Edge) renders to gitignored `data/film/`.
- `film/clock.js` virtualizes performance.now, Date.now, timers, rAF and CSS animations (Web Animations API). Anything
  new that animates must run off those, or it will drift in the film. Real fetches still take real time: scenes
  wait for them with `f.until(...)`, which stops film time; `f.waitFor(...)` waits in film time.
- `window.emberline.app` is exposed for the film (story-style scene setup). Prefer real clicks through the cursor.
- Elements with `hidden` that also set `display` in CSS need a `[hidden] { display: none }` rule, or the invisible
  overlay eats every click (this hit `.sources` and `.doc-card`).
- Voice clips come from `scripts/kokoro-voice.py` into `data/film/voice/`; change a line and only it is remade.
- The director's toolkit (`film/director.js`): `clickOn`/`drag`/`type`/`press` (real mouse and keystrokes via
  render.py), `zoomTo`/`zoomOut` (a newer camera move cancels one in flight), `spot` (dim all but one control,
  page space), `stat` (counting number + riser/hit), `burn('cover'|'reveal')` (noise fire-front transition),
  `letterbox`, `embers`, `chip`. Frame-space graphics live in `.f-hud`; page-space ones (spot, cursor) zoom with it.
- The search scene's figures come from `src/search.js` over `state.all` (what the Search tab shows); the ring
  summary from `/api/provenance`, counted like `sources-view.js`. `sources.locate({ year | source })` gives
  the cursor a scar or a source bore on the rings canvas.

## Social images (`npm run make:social`): built

- `social/figures.js` computes the figures (real sources only, mock throws) over the continuous record: from the first
  year with 100+ fires, as the app and film do. The old hand-made images added the 9,070 mock fires to CNFDB; never type figures into `social/*.html`.
- `social/render.py` captures the app (UI hidden, hex, golden sky) and fills each `[data-fig]`. The app's CSP blocks
  Playwright's `wait_for_function`, so it polls with `page.evaluate`; the animated map never reports idle, so it waits a fixed time.

## Search mode: built

- `src/search.js` is the one query model (parser, filters, facets, URL params, CSV/GeoJSON). The browser runs it
  over the loaded record and `/api/search` runs the same module on the server; change it in one place and add a
  case to `tests/search.test.mjs`. A new filter needs: `emptyQuery`, `normalizeQuery`, `dimensions`, `describe`,
  `toParams`/`fromParams`, and (if it has words) `parseText`.
- Parser lookup tables are null-prototype (`dict`), so "constructor" is never a month or a sort key. Keep that.
- Facets count each value with every *other* filter applied. Size bounds share the class facet and day bounds
  the duration facet.
- Community names ("near La Ronge") resolve against the live SPSA layer; without it, pins and boxes still work and
  the hint says why names don't. Duration is `OUT_DATE − REP_DATE`; out-before-start is treated as unknown.
- `/api/fires` now also returns `out_date` and `protection_zone` (CNFDB `PROTZONE`, sparse).
- "Replay these" / "Explore in 3D" set `state.searchFilter` (a compiled predicate) in `main.js`; the
  "Showing a search" panel clears or edits it. The hash `#search?…` holds the query.

## Static GitHub Pages build: built

- `npm run build:pages` → gitignored `dist/`: front end + each API route saved as a file (`api/fires/<source>.json`,
  `api/spread/<id>.json`, …). `<meta name="emberline-static">` makes `apiUrl()` (`src/config.js`) map routes to files.
  **Every front-end API call goes through `apiUrl()`**; a new route needs a snapshot in `scripts/build-pages.mjs`,
  or `apiUrl` returning null for it (as `/live`, `/search`, `/provenance/ping` do) and a browser fallback.
- `.github/workflows/pages.yml` loads the data in CI (downloads in the Actions cache) and deploys `dist/`; never commit
  it or push it to a branch. `npm run preview:pages` serves `dist/` under `/Wildfire-Sask/` like Pages.
- The CSP goes in as a `<meta>` (`scripts/lib/pages.mjs`); `frame-ancestors` can't, so it's dropped there.
- CI makes the Kokoro narration itself (`make:voice` after the loads) from `scripts/kokoro-requirements.txt` and the
  kokoro-onnx v1.0 model files, SHA-256 pinned to the IRISIdeas copies. Bump those pins together with IRISIdeas.
- Live and source pings run in the browser there; every live source sent CORS headers when checked (2026-11-06).

## Open threads / ideas not yet done

The backlog, with verified public data sources and a suggested order, is in
[docs/intent/08-backlog.md](docs/intent/08-backlog.md) (next: Your Community's Fire Story).
Narration should use the local Kokoro setup from `C:\DevSource\IRISIdeas` (voice `af_heart`);
generated audio belongs in gitignored `data/`.

- Small-screen layout works but is unpolished.
