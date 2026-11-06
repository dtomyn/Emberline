# 6. Decision log

Each entry: the decision, the alternatives, and why. Add new entries at the bottom.

### CNFDB over the SPSA CSV as the primary source
- **Alternatives:** the SPSA 2006–2025 Open Government CSV from the original brief.
- **Why:** that dataset could not be found on open.canada.ca (searched 2026-11). CNFDB covers
  Saskatchewan from 1959, continuously from 1981, and is fed by SPSA's own reports.
  `load-csv.mjs` still accepts an SPSA-schema CSV.

### No build step, no npm dependencies
- **Alternatives:** a bundler (Vite), React, a chart library, `better-sqlite3`.
- **Why:** a reviewer must be able to clone and run with nothing to install. Node 22.13+
  built-ins and two pinned CDN libraries are enough. Zip and shapefile readers are written in-repo.

### SQLite through a server API, not static JSON in the repo
- **Alternatives:** committed GeoJSON/JSON files.
- **Why:** the no-data-in-GitHub rule, an audit trail per load, several sources side by side,
  and a compact gzip column format (about 400 KB for all of CNFDB).

### Tiered live data with auto-discovery
- **Alternatives:** one hard-coded SPSA layer.
- **Why:** SPSA publishes seasonal layers and the `Wildfire` folder is empty off-season. The
  tiers (configured layer → discovered layer → CWFIS hotspots → labelled simulation) mean the
  app shows something real year-round and picks up SPSA's layer without a code change.

### Every endpoint in `src/config.js`; a few overridable by query string
- **Why:** one place to see and change every service the app talks to, which the Sources view also reads,
  so the catalogue's requests and live checks are always the app's own. The data API and the SPSA
  active-fire layer can be overridden, so a new endpoint can be tested in fire season with a URL.
- **Enforced (2026-11-05):** the basemap, terrain tiles and GeoMet lightning had drifted into
  `main.js`, `scene.js` and `lightning.js`; they moved to `CONFIG.scene` and `CONFIG.geomet`, and
  `tests/config.test.mjs` now fails on an https URL written anywhere else in `src/`.
- **Limit (2026-11-05):** anyone can craft such a link, so `?api=` and `?data=` must stay on the same
  origin and `?activeFires=` must be an https layer on `gis.saskatchewan.ca`; anything else is ignored.

### Equal-area circles in Replay; real perimeters only in Spread
- **Alternatives:** CNFDB polygons for every fire.
- **Why:** polygons are incomplete for many agencies and years. Equal-area circles are honest
  if labelled, and Spread uses NBAC perimeters where they are reliable (large fires, 2010+).

### Spread front by arrival-time interpolation
- **Alternatives:** showing raw hotspots only; a physical spread model.
- **Why:** raw hotspots don't read as a fire; a spread model would be a simulation. A Dijkstra
  arrival-time sweep from real detections, constrained to the NBAC perimeter, is the standard
  "day of burning" method and stays tied to observations.

### One day of hotspots per request, cached
- **Why:** `public:hotspots` times out for multi-month or bbox queries. Per-day requests cached
  under `data/raw/hotspots/` make the first load slow but reliable and later loads fast.

### Lightning bolts and cells run on the wall clock
- **Why:** at replay speed a day lasts milliseconds, so strikes timed to replay time would be
  invisible. Once triggered they play in real time.

### Local Kokoro voice, identical to IRISIdeas
- **Alternatives:** browser speech only; a cloud TTS service.
- **Why:** consistent, high-quality voice across the owner's projects, no API keys, no data
  leaving the machine. Clips are generated from SQLite in Node so they match the browser's text
  exactly; mismatches fall back to the browser voice, labelled.

### Crackling wood fire under the film, not music
- **Why:** chosen by the owner. It suits the subject, and its louder pops can be real fires.
  Levels were measured against the voice to keep it subtle.

### 3D terrain lit by the real sun
- **Why:** turns a flat map into a place and makes the date on screen visible as light. deck.gl
  layers are lifted to the terrain so they don't float.

### Sources as a fire-scarred tree cross-section
- **Alternatives:** a credits list in About; a drill-core log like IRISIdeas.
- **Why:** the owner wanted every source credited with the same "wow" as the rest of the app.
  Tree rings are how fire history is actually dated in the boreal forest, so the metaphor carries
  meaning: ring width is fire count, scars are the largest seasons, bores are source coverage.
  Live checks run on the server so CORS never decides whether a source can be asked.

### Explainer filmed frame by frame under a virtual clock
- **Alternatives:** screen recording a real session; a separate animated mock-up.
- **Why:** a screen recording drops frames and can't be repeated exactly; a mock-up would break the
  "never fake functionality" rule. Replacing the page's clock (timers, animation frames, CSS
  animations) makes every run identical, so the film is a script that can be rerun after any change.
  The IRISIdeas films use the same approach (Playwright + Edge + imageio-ffmpeg), and the same Python.
- **Sound:** the YouTube film has a low synthesized pad as well as the fire bed, because it plays
  without the app's context and needs to carry on its own; the in-app documentary keeps fire only.

### Search: one query model, run in the browser and on the server
- **Alternatives:** filter with SQL on each keystroke; browser-only filtering; a search library.
- **Why:** the whole record (about 27k fires) is already in the browser for Replay and Explore, so
  searching it there is instant and works with static hosting. `src/search.js` holds the query model,
  the plain-language parser, faceting and exports once, and the server runs the same module for
  `/api/search`, so the API, the UI and shared links can never disagree. No dependencies; the
  parser is small rules over tokens, tested in `tests/search.test.mjs`.
- **Facets:** each is counted with every other filter applied (one pass), so a chip shows what
  choosing it would return rather than a static total.

### Thunder kept soft and distant; the name said EM-ber-line
- **Alternatives:** a loud crack-and-rumble for each lightning strike.
- **Why:** the owner found the cracking thunder harsh. Strikes now sound as a quiet low rumble with
  no crack, at most one per 1.5 s, in both the live app and the film. The voice stressed the
  middle of "Emberline"; it is meant as embers + line, so `SOUNDS` in `kokoro-voice.py` fixes it.

### Security hardening (2026-11-05)
- **What:** every third-party string (SPSA layer, community and incident names, CNFDB fire names, error
  text) goes through `esc()` from `src/data.js` before `innerHTML` or a deck.gl tooltip. The server
  listens on loopback only (`HOST` opts in to a network), rejects foreign `Host` headers (DNS rebinding),
  answers only GET/HEAD, sends a CSP (scripts from itself and unpkg only), clamps query numbers, bounds
  its caches, throttles `/api/live?refresh` to once a minute and hides error detail. CDN files carry SRI
  hashes; CSV exports defuse formula cells; the zip reader never inflates past an entry's declared size.
- **Why:** a review found that a crafted `?api=` link or a hostile name in a live layer could run script
  in the page. The app shows government data to the public under a shareable link, so it must not be a vector.

### Audience: the general public, not SPSA (2026-11-05)
- **Alternatives:** the original framing, a portfolio piece aimed at impressing the Saskatchewan
  Public Safety Agency.
- **Why:** SPSA has its own internal systems and is unlikely to need this. The project's real value
  is helping the general public understand Saskatchewan's wildfire history. SPSA stays a data source
  (CNFDB records it reports, its public GIS layers) and the authority the app defers to for current
  incidents and warnings. Wording should be plain and jargon-free; accuracy still has to survive a
  close look.

### A static GitHub Pages build beside the server (2026-11-06)
- **What:** `npm run build:pages` writes `dist/`: the front end plus a JSON snapshot of each API route the app
  reads. `<meta name="emberline-static">` switches `apiUrl()` in `src/config.js` to those files; Live and
  source pings go straight from the browser. `.github/workflows/pages.yml` loads the data in CI and deploys it.
- **Alternatives:** hosting the Node server (Render, Fly.io, a VM); committing JSON to a `gh-pages` branch.
- **Why:** the owner wanted a free, always-on public copy *and* to keep the server version. The data stays out
  of git (it is built by the load scripts in CI and lives only in the Pages deployment), so the
  no-data-in-GitHub rule holds. The server stays the reference: `npm start` is unchanged, and the API routes
  and the snapshot files come from the same `server/db.mjs` queries.
