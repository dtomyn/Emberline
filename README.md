# Emberline: Saskatchewan Wildfire Atlas

An animated, interactive atlas of every recorded wildfire in Saskatchewan. It replays fire
seasons day by day, explores 45+ years of history in 3D, and pulls live data from the
Saskatchewan Public Safety Agency (SPSA) and Natural Resources Canada.

See: https://www.youtube.com/watch?v=zYNXv4cRkvA

| Mode | What it does |
|---|---|
| **Replay** | Plays fire seasons day by day. Each ignition flashes, grows to its reported size and cools to a burn scar. **Lightning storms** strike first: a bolt lands at every lightning-caused fire, and clusters get a drifting storm cell. Turn on **Hear the season** (🔊 or `M`) and every ignition plays a note. Scrub the season timeline, change speed, filter by cause or size. |
| **Spread** | True spread replay. Pick one of Saskatchewan's largest fires and watch it grow day by day, as satellites saw it, inside its real NBAC burned-area perimeter. Hot pixels flare as detections land, a glowing front (coloured by spread rate) sweeps across and cools to a char scar, embers drift with the day's recorded wind, and fronts merging slow the replay down. A director camera follows the fire. |
| **Explore** | 3D hexagon columns (area burned), a heatmap, or every burn drawn at its true area, across any range of years. Optional orbit camera. |
| **Search** | Find any fire in the record by anything it holds. Type plainly (`lightning near La Ronge over 1000 ha in july 2015`, `megafires 1980s`, `human since 2010 burned longer than 3 months`) and the words become filter chips; other words search fire names. Faceted filters show what each choice would return: cause, month started, size class (A–E) and hectare bounds, how long it burned, distance from an SPSA community, a dropped pin or a drawn box, years (brush the histogram), named fires, fires with a spread replay. Matches ignite on the map in the order they started; the rest of the record stays as dust. Sort, click through to the detail card, **Replay these** or **Explore in 3D**, export CSV or GeoJSON, open the same search from the API, or copy a link that reopens it. |
| **Live** | Active incidents (SPSA layer, then CWFIS satellite hotspots, then a labelled simulation), satellite fire perimeters, live SPSA community locations, and a looping animation of the last 3 hours of **Canadian Lightning Detection Network** flash density. Flags communities within an adjustable alert radius. |
| **Story** | A guided tour whose numbers are all computed from the loaded data: the biggest season, a true spread replay of its largest fire, lightning vs. human causes, the top 1% of fires, the live picture. |
| **▶ Watch** | **Emberline Presents**, the same story as a narrated film (about 2½ minutes) that plays inside the live app. A synthetic voice (local Kokoro, see below) reads each chapter while the camera flies, the replay starts on the word "Watch", numbers count up and captions run. A wood fire crackles quietly underneath and ducks under the voice (the flame button mutes it). Pause at any moment (`Space`) and the map is yours to explore from that view; `→` skips a chapter. Also on the intro screen as **Watch the film**. |

Click any fire for a detail card (size comparisons, nearest community, "replay this fire", and
"true spread" for fires with a spread replay).
Every mode sits on **3D terrain** lit by the real sun for the date on screen: hillshade from the sun's
azimuth, a day/night terminator that sweeps across the province, a sky that turns golden at dusk, and
fires that glow brighter after dark. The **Scene** panel switches between an accelerated day cycle,
day, golden hour and night, and sets the relief exaggeration.

Keyboard: `Space` play/pause · `←`/`→` step a week (a day in Spread) · `1`–`5` modes · `/` search · `S` sources · `W` watch the film · `M` sound · `Esc` close.

---

## Why it exists

Emberline is a portfolio project that helps **the general public** understand the history of
wildfire in Saskatchewan. It is not an official or operational tool: for current incidents,
evacuations and warnings, follow the Saskatchewan Public Safety Agency. It has two goals of
equal weight: **visual wow** (cinematic, animated, polished) and **full function** (real
data, real services, nothing mocked up). Binding them together is a rule of **honesty**: anything
simulated is labelled SIMULATED, burn circles are equal-area rather than perimeters, interpolated
and illustrative details say so, and every figure in the story and film is computed from the
loaded data.

The full intent of the project, the purpose, principles, hard constraints, the intent of each mode,
what each data source may claim, the decision log and current status, is documented in
**[docs/intent/](docs/intent/README.md)**:

| Document | Covers |
|---|---|
| [Purpose](docs/intent/01-purpose.md) | Audience, what success looks like, what Emberline is not |
| [Principles](docs/intent/02-principles.md) | Wow + function, honesty in the UI, respect for the viewer |
| [Constraints](docs/intent/03-constraints.md) | No data in GitHub, SQLite, no dependencies, real data first |
| [Modes](docs/intent/04-modes.md) | What each mode and feature is for, and must never do |
| [Data](docs/intent/05-data.md) | Why each source, and recorded vs. derived vs. interpolated vs. illustrative vs. simulated |
| [Decisions](docs/intent/06-decisions.md) | The choices made, the alternatives, and why |
| [Status](docs/intent/07-status.md) | Built, unfinished, next |
| [Backlog](docs/intent/08-backlog.md) | Ideas not yet built, with verified public data sources |

---

## Quick start

Requires **Node.js 22.13+** (it uses the built-in `node:sqlite`). There are no npm dependencies.

```bash
npm run load:cnfdb   # downloads the National Fire Database (~25 MB) and loads Saskatchewan fires into SQLite
npm run load:spread  # optional: perimeters + satellite hotspots for the Spread mode (see below)
npm run make:voice   # optional: Kokoro narration for the film (needs the local Kokoro install, see below)
npm start            # http://localhost:5173
```

The server listens on this machine only. To open it from another device on your network, start it
with `HOST=0.0.0.0 npm start` (it then accepts any `Host` header; only do this on a network you trust).

No network, or just want to try it quickly? `npm run load:mock` loads a synthetic dataset instead.

### Data is never committed

`data/` is gitignored: the SQLite database, raw downloads and any exports. Anyone who clones
the repo rebuilds the data locally with the load scripts:

| Script | Loads |
|---|---|
| `npm run load:cnfdb` | CNFDB point data, `SRC_AGENCY = 'SK'` (1959–present, about 27,000 fires). Uses the cached zip if one exists. |
| `npm run load:cnfdb:refresh` | Same, but downloads a fresh copy first |
| `npm run load:spsa -- path/to/export.csv` | An SPSA historical CSV export (see schema below) |
| `npm run load:spread` | True Spread Replay data: NBAC perimeters for SK fires ≥ 10,000 ha since 2010, plus the satellite hotspots inside them. Fetches one day of hotspots per request and caches each under `data/raw/hotspots/`, so the first run takes a while (roughly 20–40 min) and later runs are quick. Options: `--from 2002 --to 2025 --min-ha 5000 --concurrency 4 --refresh`. |
| `npm run load:mock` | 9,000 synthetic fires (2006–2025), generated by `scripts/generate-mock.mjs` |
| `npm run make:voice` | Narration clips for **▶ Watch**: builds the story from the database exactly as the browser does, then speaks every line with Kokoro into `data/voice/` (OGG + `manifest.json`). Only new or changed lines are made, so rerun it after any load. `--dry-run` prints the script; `--source cnfdb` limits it to one dataset. |
| `npm run make:social` | The LinkedIn cover (1920×1080) and Viva Engage banner (2400×900) in `data/social/`: a frame of the live app (golden-hour hex columns) under text whose figures are computed from the database by `social/figures.js`, real data only, over the continuous record. Rerun it after any load. `--dry-run` prints the figures. Needs a Python with playwright (`KOKORO_PYTHON`, the IRISIdeas install by default). |
| `npm run export:json` | Writes `data/fires.json` from the DB, for static hosting (see below) |
| `npm test` | Unit tests for the parsers and loaders |

Each load replaces only its own source, so all sources can live side by side. Switch between
them with the **Dataset** menu in the app.

---

## Architecture

```
index.html, src/          front end (MapLibre GL + deck.gl from CDN, ES modules, no build step)
  main.js                 map, animation loop, modes, UI
  spread-mode.js          True Spread Replay: burn field, front, detections, embers, director camera
  spread.js               fire-growth algorithms shared with the loader (projection, raster, arrival time, merges)
  search.js               query model shared with /api/search: plain-language parser, facets, URL params, CSV/GeoJSON
  search-mode.js          Search: search box and chips, faceted filters, year brush, results list, map reveal, pin/box tools
  charts.js               animated SVG/canvas charts (cause donut, fire clock, season bars, timeline)
  story.js                guided story; all figures computed from the data, with a spoken line and cues per chapter
  documentary.js          Emberline Presents: the narrated film (clips, captions, word-timed cues, pause/skip)
  narration.js            spoken-number formatting, sentence split, cue timing (shared with make-voice)
  fireplace.js            the film's quiet crackling-fire bed (roar, hiss, crackles, real fires as pops), ducking
  scene.js                3D terrain, sun-lit hillshade, sky, day/night terminator
  sun.js                  solar position (altitude, azimuth) and Saskatchewan time helpers
  lightning.js            storm grouping, bolts and storm cells; live CLDN lightning loop
  sonify.js               Hear the Season: Web Audio notes, crackle, rumble, thunder
  data.js                 enrichment and aggregation helpers
  config.js               every external endpoint; data API and SPSA layer overridable by query string
  services/arcgis.js      ArcGIS REST client: catalog crawl, layer metadata, paged GeoJSON queries
  services/live.js        live incident resolution, normalization, simulation fallback
server/
  index.mjs               static files + JSON API
  db.mjs                  SQLite schema and queries (node:sqlite)
scripts/
  load-cnfdb.mjs          download → unzip → filter SK → SQLite
  load-csv.mjs            SPSA-schema CSV → SQLite
  load-spread.mjs         NBAC perimeters + CWFIS hotspots → arrival grids → SQLite
  parse-spsa-csv.mjs      CSV parser / normalizer (header aliases, date formats, causes)
  generate-mock.mjs       synthetic dataset generator
  export-json.mjs         SQLite → static JSON
  make-voice.mjs          story lines from SQLite → kokoro-voice.py → data/voice/
  kokoro-voice.py         Kokoro TTS (af_heart, the IRISIdeas voice), sentence-timed OGG clips
  lib/unzip.mjs           zero-dependency zip reader
  lib/shapefile.mjs       zero-dependency .shp (polygons) and .dbf reader
tests/                    node --test suites
```

### SQLite schema (`data/wildfire.db`)

- **`fires`**: one row per fire: `source` (`cnfdb` | `spsa` | `mock`), `fire_id`, `ignition_date`,
  `year`, `size_ha`, `latitude`, `longitude`, `general_cause` (`Lightning` | `Human` | `Unknown`),
  plus `fire_name`, `out_date`, `protection_zone` and `raw_cause` where the source has them.
  Unique on `(source, fire_id)`; indexed on `(source, year, ignition_date)`.
- **`import_runs`**: an audit row per load: input file, rows read, loaded and rejected, with reasons as JSON.
- **`live_snapshots`**: every real (non-simulated) live pull, so the app builds its own archive of
  active seasons over time.
- **`spread_fires`**: one row per replayable fire: NBAC attributes, the simplified perimeter rings,
  a pre-computed arrival-time grid (base64 `Uint16` hours) and daily growth with merge moments.
- **`spread_hotspots`**: the satellite detections assigned to each fire (`t` in days since the fire's base date, FRP, sensor, wind).

### API

| Endpoint | Returns |
|---|---|
| `GET /api/sources` | Loaded sources with counts, year span and load time |
| `GET /api/fires?source=cnfdb&from=1981&to=2025` | Fires as compact columns (gzip, about 400 KB for all of CNFDB) |
| `GET /api/search?q=lightning near La Ronge over 1000 ha` | Search the record with the same query language as Search mode. `q=` takes plain language (community names resolve against the live SPSA layer); structured parameters: `from`, `to`, `m` (months 1–12), `cause`, `class` (A–E), `min`/`max` (ha), `dur`, `dmin`/`dmax` (days burning), `near=lat,lon,km`, `bbox=w,s,e,n`, `named=1`, `spread=1`, `zone`, `sort` (size, date, days, name, km), `dir`. `format=json` (default; `limit` ≤ 5000, `offset`, facet counts included), `csv` or `geojson` (all matches) |
| `GET /api/live[?refresh]` | Active incidents + satellite perimeters + SPSA communities (cached for 5 minutes) |
| `GET /api/live/history` | Stored live snapshots |
| `GET /api/spread` | Fires with a spread replay (no geometry) |
| `GET /api/spread/<id>` | One fire: perimeter rings, arrival grid, daily growth and hotspots |
| `GET /api/provenance` | Where every dataset came from: latest import run per source (rows read, rejected by reason, loaded), fires per year, spread coverage by sensor, live snapshot count |
| `GET /api/provenance/ping/<id>` | Asks one catalogued source (`src/provenance.js`) for its current state: feature count, newest frame or file date. Fixed URLs only |
| `GET /api/voice` | Narration manifest: voice settings and, per line of text, its clip, length and sentence times |
| `GET /api/voice/<hash>.ogg` | One narration clip |

Only `index.html`, `src/` and an optional `data/fires.json` are served as static files. The
database and raw downloads are never exposed.

---

## Data sources

In the app, **Sources** (top bar, the intro, the About dialog, or <kbd>S</kbd>; or open `/#sources`) shows all of
this as *Read the rings*: a fire-scarred tree cross-section where each ring is a year of the record and each source
bores through the years it covers. Each source's card gives its owner, licence, counts from the database, the
rows rejected on load, the exact request, a citation to copy, and a button that asks the source for its state now.
The catalogue behind it is `src/provenance.js`.

### 1. Historical record: Canadian National Fire Database (CNFDB), the primary source

Natural Resources Canada compiles every agency's fire reports into the CNFDB. Saskatchewan's
records (reported by SPSA and its predecessors) run from 1959, with continuous coverage from 1981.

- Info page: <https://cwfis.cfs.nrcan.gc.ca/en/fire-history>
- Download index: <https://cwfis.cfs.nrcan.gc.ca/downloads/nfdb/>

**Getting the data by hand** (`npm run load:cnfdb` does all of this for you):

1. Open <https://cwfis.cfs.nrcan.gc.ca/downloads/nfdb/> and go to `fire_pnt/current_version/`.
   (`fire_poly/` holds the polygon perimeters, which aren't complete for every agency or year.)
2. Download one of:
   - `NFDB_point_txt.zip`: a comma-delimited attribute table (about 25 MB). The loader uses this one.
   - `NFDB_point_shp.zip`: the same points as a shapefile (about 42 MB). Its attributes are in the `.dbf`.
   - `NFDB_point_large_fires_*.zip`: only fires of 200 ha or more.
3. Keep only Saskatchewan rows: **`SRC_AGENCY == 'SK'`**. The fields used are:

   | CNFDB field | Emberline field | Notes |
   |---|---|---|
   | `NFDBFIREID` | `fire_id` | e.g. `SK-2025-25LF-SHOE` |
   | `REP_DATE`, or `YEAR`/`MONTH`/`DAY` | `ignition_date` | `REP_DATE` first; mid-month if the day is missing |
   | `SIZE_HA` | `size_ha` | |
   | `LATITUDE`, `LONGITUDE` | `latitude`, `longitude` | WGS84 decimal degrees |
   | `CAUSE` | `general_cause` | `N` → Lightning, `H` → Human, `U`/`RE` → Unknown |
   | `FIRENAME`, `OUT_DATE`, `PROTZONE` | kept as extras | |

   The loader also drops prescribed burns (`PRESCRIBED` set or `CAUSE = 'H-PB'`), assistance
   requests (`FIRE_TYPE` starting with "Req"), and rows without usable coordinates or dates.
   Every rejection is counted in `import_runs`.

   If you use the shapefile, the same filter applies to the DBF, e.g. with GDAL:
   `ogr2ogr -f CSV sk.csv NFDB_point.shp -where "SRC_AGENCY = 'SK'" -t_srs EPSG:4326`.
   Or load a zip you downloaded yourself: `node scripts/load-cnfdb.mjs --file path/to/NFDB_point_txt.zip`.

### 2. SPSA historical CSV export (Open Government), optional

A flat SPSA export with `FIRE_ID, IGNITION_DATE, SIZE_HA, LATITUDE, LONGITUDE, GENERAL_CAUSE`
loads with `npm run load:spsa -- export.csv`. The parser accepts common header variants
("Fire Number", "Start Date", "Area (ha)", "Lat", "Long", "Cause"…), quoted fields, several
date formats and SPSA cause vocabulary. A search of open.canada.ca in November 2026 did not
find this dataset under the SPSA name, which is why CNFDB is the primary source.

### 3. True Spread Replay: NBAC perimeters and satellite hotspots

- **Perimeters**: the National Burned Area Composite (NRCan), WFS layer `public:nbac` on
  `cwfis.cfs.nrcan.gc.ca/geoserver`, filtered to `admin_area = 'SK'`. As of 2026-11 the WFS stops at
  2024, so later years are read from the per-year shapefile zip under
  `cwfis.cfs.nrcan.gc.ca/downloads/nbac/` and reprojected from Canada Lambert Conformal Conic to WGS84.
- **Hotspots**: MODIS and VIIRS detections, WFS layer `public:hotspots`, `agency = 'SK'`. Multi-month
  queries time out at the gateway, so the loader asks for one `rep_day` at a time.
- **Method**: detections inside a perimeter (or within 800 m of it) seed a grid of up to 256 × 256
  cells. A Dijkstra sweep fills the remaining burned cells at a nominal 2 km/day, so every cell gets
  an arrival time: a "day of burning" map constrained to the real burned area. The front is the
  isoline where arrival time equals the moment shown, and daily area is scaled to the NBAC total.
  Merges are days when two burning areas, each at least 3% of the final size, join.

### 4. Live data: SPSA ArcGIS server and CWFIS

SPSA publishes GIS layers on Saskatchewan's ArcGIS Enterprise server:

- REST root: <https://gis.saskatchewan.ca/arcgis/rest/services> (v11.5; returns `f=geojson` and
  sends CORS headers, so browsers can query it directly)
- `SPSA/Communities/MapServer`: community points (layers 1, 3–6: northern hamlets, towns,
  northern towns, northern settlements, cities). Used live for the community proximity analysis.
- `SPSA/ProtectionAreas/MapServer/1`: protection area names (geometry is not returned publicly).
- `Wildfire/`: the folder exists but was empty in November 2026 (off-season).

**How live incidents are pulled** (`src/services/live.js`), first match wins:

1. **Configured SPSA layer.** Set `CONFIG.arcgis.activeFiresLayer` in `src/config.js`, or pass
   `?activeFires=<layer url>` in the URL, to a MapServer/FeatureServer layer, e.g.
   `Wildfire/ActiveFires/MapServer/0`. The client calls

   ```
   <layer>/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=1000&resultOffset=0
   ```

   and follows `exceededTransferLimit` with `resultOffset` paging. It falls back to `f=json`
   (Esri JSON, converted to GeoJSON) on servers without GeoJSON support. Points and polygons both
   work: polygons render as perimeters, and centroids drive the proximity analysis.
2. **Auto-discovery.** Crawls the `Wildfire` and `SPSA` catalog folders (`?f=json`) for layers
   named like *active fire*, *wildfire*, *fire perimeter* or *incident*. When SPSA publishes a
   seasonal layer, the app picks it up without a code change.
3. **CWFIS satellite hotspots.** NRCan's GeoServer WFS
   `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows`, layer `public:hotspots_last24hrs` with
   `CQL_FILTER=agency='SK'`. This is real data year-round. Satellite perimeters come from
   `public:m3_polygons_current` (bbox filter).
4. **Simulation.** Replays the busiest fortnight of the latest season in the loaded record. The UI
   always marks it **SIMULATED**.

Incident attributes are normalized heuristically (name, size, start date, stage of control →
*Not contained / Protecting values / Ongoing assessment / Contained / Out*), so SPSA's field
names can change without breaking the app. To inspect a layer yourself:

```js
import { listCatalog, describeLayer, queryGeoJSON } from './src/services/arcgis.js';
await listCatalog('https://gis.saskatchewan.ca/arcgis/rest/services', 'Wildfire');
await describeLayer('https://gis.saskatchewan.ca/arcgis/rest/services/SPSA/Communities/MapServer/1');
```

The public SPSA map viewers (<https://www.saskpublicsafety.ca/active-incidents/maps>) are
another place to find the service URLs a seasonal viewer uses.

---

### 5. Lightning, terrain and sound

- **Lightning history** comes from the CNFDB itself: fires with `CAUSE = 'N'`. Ignitions within
  1 day and 60 km are linked (transitively) into one storm. Places and dates are recorded; the hour
  of each strike within its day and the storm cell's shape are illustrative, and the UI says so.
- **Live lightning**: ECCC MSC GeoMet WMS `https://geo.weather.gc.ca/geomet`, layer
  `Lightning_2.5km_Density` (CLDN flash density, 10-minute frames for the last 3 hours, CORS-enabled).
  The app reads the time dimension from GetCapabilities, loads each frame once as a blob, and counts
  coloured pixels inside Saskatchewan to say honestly whether any lightning was detected.
- **Terrain**: Terrarium elevation tiles from AWS Open Data
  (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`), used as MapLibre 3D terrain
  and as hillshade. deck.gl draws at sea level, so the app lifts every deck layer to the ground height
  at the map centre; the residual misregistration is the local height difference × exaggeration.
- **Sun**: computed in `src/sun.js` (no data needed). Saskatchewan stays on CST (UTC−6) all year.
- **Sound** needs no data: it plays what's already loaded through the Web Audio API.

### 6. Narration: local Kokoro text-to-speech

The film's voice is [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) (`kokoro-onnx`, model v1.0),
run locally, with the same settings as the IRISIdeas project: voice `af_heart`, speed 0.97, 24 kHz,
en-US phonemes with hand fixes for names it reads wrongly from their spelling (Saskatchewan, Regina,
La Ronge, Île-à-la-Crosse). Years are spelled out before synthesis ("nineteen eighty-one").

`npm run make:voice` uses the IRISIdeas install by default (`C:\DevSource\IRISIdeas\.venv`). Elsewhere, set
`KOKORO_PYTHON` to a Python with `kokoro-onnx` and `soundfile` installed and `KOKORO_DIR` to a folder with
`kokoro-v1.0.onnx` and `voices-v1.0.bin`. Clips are matched to lines by their exact text, so when the data
changes, any line without a matching clip falls back to the browser's speech voice. The title card and the film's
control bar always say which voice is speaking, and that it is synthetic.

**Fire sound.** Like the IRISIdeas films, the narration has a subtle bed underneath: a wood fire crackling,
synthesized live with Web Audio from seeded noise (`src/fireplace.js`, no recordings). A low roar breathes slowly,
a faint hiss sizzles, and crackles come at random, mostly tiny ticks, sometimes in bursts, now and then a snap.
The fire burns livelier in the big chapters (the worst season, the spread replay) and dies to embers under the end
card. Its few louder pops in each chapter are that chapter's largest real fires, in the order they started
(bigger fires knock deeper, west on the left). It ducks under every spoken line: measured against the Kokoro clips
(RMS about −22.6 dBFS), it sits near −34 to −38 dBFS between lines and −43 to −46 dBFS under the voice. It pauses
with the film, fades out at the end, and the flame button mutes it (remembered).

## Explainer film (YouTube)

`npm run film` renders a 2½–3 minute explainer from the real app, frame by frame, with Kokoro narration,
a drawn cursor whose clicks and hovers are real, video zoom-ins, click sounds and a synthesized score. The plan
is [film/storyboard.md](film/storyboard.md); the scenes and narration are [film/scenes.js](film/scenes.js), and
every spoken figure is computed from the loaded record at render time, so re-running it after a data refresh
updates the film.

```bash
npm run film -- --preview
```

```bash
npm run film -- --url https://github.com/<you>/emberline
```

`--preview` makes a quick 720p, 15 fps cut (about 15 minutes); the full render is 1080p at 30 fps (roughly an
hour). `--stills 5,40,90` saves single frames, `--until 30` stops early, `--scale` sets the capture's pixel ratio
(default 1.5 on a 1600×900 layout). Output goes to `data/film/` (gitignored): the MP4, `.srt` captions from the
voice timings, `script.md`, `youtube.txt` (title, description, chapter times) and `storyboard.html` with a real
frame from each scene.

How it works: `film/render.py` starts its own server, opens the app in headless Microsoft Edge with
`film/clock.js` replacing the page's clock (timers, animation frames and CSS animations only move when a frame
is drawn), injects `film/director.js`, has `scripts/kokoro-voice.py` speak the lines (only new or changed lines
are synthesized, into `data/film/voice/`), then steps the film one frame at a time, waiting for map tiles before
each capture. `film/sound.py` mixes the voice, clicks, whooshes, thunder on every lightning strike drawn, a fire
bed and a low pad, ducked under the voice; ffmpeg levels it to −14 LUFS. It uses the IRISIdeas Python
(`playwright`, `imageio-ffmpeg`, `kokoro-onnx`, `soundfile`, `numpy`); set `KOKORO_PYTHON` and `KOKORO_DIR` elsewhere.

## Static hosting (optional)

The app is meant to run with the Node server. To host the front end alone (e.g. GitHub Pages),
run `npm run export:json`, publish `data/fires.json` alongside the site **outside the repo**,
and open `index.html?data=<url-to>/fires.json`. Live mode then queries SPSA and CWFIS straight
from the browser.

## Notes and caveats

- Burn circles have the **same area** as the reported fire size. They are not fire perimeters.
- Sizes are final reported sizes. A fire's growth in Replay is an animation, not observed spread.
  The Spread mode shows observed spread: real detections and real perimeters, with the front
  interpolated between detections.
- CNFDB coverage before 1981 is sparse, so the app's default range starts at the first year with
  100+ recorded fires.
- Basemap © OpenStreetMap contributors © CARTO. Fire data © Natural Resources Canada
  (Open Government Licence – Canada) and the Saskatchewan Public Safety Agency.
