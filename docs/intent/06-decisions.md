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

### Every endpoint in `src/config.js`, overridable by query string
- **Why:** a new endpoint can be tested in fire season with a URL, without a redeploy.

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
