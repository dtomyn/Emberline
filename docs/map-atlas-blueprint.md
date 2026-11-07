# Map Atlas Blueprint

A reusable brief for building a new **animated, data-true map atlas** with the same look, feel and
capabilities as Emberline (Saskatchewan wildfire history). Copy this file into a new, empty repository as
`BLUEPRINT.md`, fill in **Part 1**, and hand it to Claude with the kickoff prompt at the end.

Parts 2–9 are the **house style**: keep them as written unless your idea really needs something different.
Where Emberline's choices are subject-specific (fire, embers, tree rings), this file names the *pattern*
and gives Emberline's version as the worked example in *italics*.

> Reference implementation: `C:\DevSource\Wildfire-Sask` (Emberline). When a section says "as Emberline",
> read that file before writing the new one, and adapt it rather than reinventing it.

---

## Part 1. The idea (fill this in)

Everything after this part is derived from these answers. Leave a row blank if you don't know yet. Claude
should ask about blank rows that block the work and propose answers for the rest.

| # | Question | Your answer | *Emberline's answer* |
|---|---|---|---|
| 1 | **Working name** (one word that suggests the subject's motion) | | *Emberline* |
| 2 | **Place** (region, bounding box, outline source) | | *Saskatchewan, -110/49 to -101.36/60* |
| 3 | **Subject: what is an "event"?** One row in the record. | | *One wildfire* |
| 4 | Event **time** fields (start, end, duration?) | | *REP_DATE, OUT_DATE* |
| 5 | Event **location** (point, polygon, line?) | | *Point, plus NBAC perimeter for large fires* |
| 6 | Event **magnitude** (what makes one event bigger) | | *Hectares burned* |
| 7 | Event **category** (2–4 classes that get their own colour) | | *Lightning / Human / Unknown* |
| 8 | Other filterable fields | | *Name, protection zone, month, duration* |
| 9 | **Primary historical source** (owner, URL, format, licence, years covered) | | *CNFDB points (NRCan), 1959 →, OGL-Canada* |
| 10 | **Deep-dive source**: data that shows *how one event unfolded* | | *NBAC perimeters + CWFIS satellite hotspots* |
| 11 | **Live source(s)**, with a fallback chain | | *SPSA ArcGIS → CWFIS hotspots → labelled simulation* |
| 12 | **Context layers** (places people know: towns, roads, reserves, parks) | | *SPSA community points* |
| 13 | **Audience** and who it is *not* for | | *General public; not built for SPSA* |
| 14 | **The question each mode answers** (one line per mode, Part 4) | | *Replay: what did a season feel like?* |
| 15 | **Material / palette metaphor** (what glows?) | | *Fire: embers, glow, cooling scars* |
| 16 | **Lifecycle animation** of one event (appear → peak → fade → trace) | | *Ignite → glow → grow → cool → scar* |
| 17 | **Sources-view metaphor** (an object from the subject that dates or records things) | | *Fire-scarred tree cross-section* |
| 18 | **Sound bed** for the film (subtle, fits the subject, can carry real data) | | *Crackling wood fire; louder pops are real big fires* |
| 19 | **Sonification** (what plays a note when an event happens) | | *Pitch by size, timbre by cause, pan by longitude* |
| 20 | **Comparisons** that make a magnitude human-sized | | *"× the area of Saskatoon", football fields* |
| 21 | **Known traps** in the data (bad dates, duplicates, odd CRS, timeouts) | | *REP_DATE vs YEAR/MONTH/DAY disagree* |
| 22 | **Hosting** | | *Node server locally; GitHub Pages static build* |

Write the answers back into the new repo's `docs/intent/01-purpose.md` and `05-data.md` (Part 9).

---

## Part 2. Principles (keep)

### Two goals, equal weight

1. **Visual "wow".** Animated, cinematic, polished. Events appear, glow, evolve and leave a trace; 3D hex
   columns rise; terrain is lit by the real sun; the camera flies through a story. Visual quality is a
   first-class requirement, not decoration added at the end.
2. **Fully functional.** Real data, real services, working filters, scrubbing, detail cards and a live mode.
   Never a mock-up or a static picture.

When they pull against each other, **keep both**. Don't simplify the visuals to save effort; don't fake
functionality to get a better shot. If something can't be both real and striking yet, it waits.

### Honesty in the UI

- **Simulated is labelled SIMULATED.** The live fallback and any mock dataset carry a visible badge.
- **Shapes say what they are.** If a circle stands for a magnitude (equal area), say so in the card and About.
- **Interpolation is named** wherever the app fills in between real observations.
- **Illustrative details are named** (an exact hour, a cell shape) and kept separate from recorded facts.
- **Figures are computed, never hard-coded.** Story, film, social images: every number comes from the loaded data.
- **Synthetic voices say they are synthetic**, on the title card and control bar.
- **Sources are credited** in the app, the README and the Sources view.

### Truth levels (every pixel belongs to one)

| Level | Meaning | Shown as |
|---|---|---|
| Recorded | In a source as-is | Fact, with credit |
| Derived | Computed from recorded data each time | Fact, never typed in |
| Interpolated | Filled between real observations | Named "interpolated" |
| Illustrative | A visual stand-in | Named "illustrative" / "equal area" |
| Simulated | Fallback or mock | SIMULATED badge, always |
| Synthetic voice | TTS narration | Named on screen |

### Respect the viewer

- The map is always the real app: pausing the film leaves a live, explorable map.
- Every mode is reachable by keyboard: `Space` play, arrows scrub, `1`–`4` modes, `5` story, `/` search,
  `S` sources, `W` watch, `M` sound, `Esc` close.
- Sound never starts on its own: the AudioContext is created inside a click.
- Fail soft: one failed service or exception never freezes the app. `frame()` schedules the next frame first.

---

## Part 3. Hard constraints and stack (keep)

- **No data in GitHub.** SQLite, downloads, exports, voice clips and renders live in gitignored `data/`.
  Every dataset is rebuilt by a loader: `scripts/load-*.mjs` → `data/<name>.db`. A new source means a new loader.
- **SQLite is the store**, through `node:sqlite` (no native modules). History reaches the browser through
  the server API (or its static snapshot), never through files committed to the repo.
- **No build step, no npm dependencies.** Node 22.13+ built-ins (`node:sqlite`, `zlib`, `http`). In-repo
  zip and shapefile readers (copy `scripts/lib/unzip.mjs`, `scripts/lib/shapefile.mjs`).
  Front end: **MapLibre GL 4.7.1** and **deck.gl 9.0.38** from pinned unpkg URLs with SRI `integrity`.
  Ask before adding a dependency or bundler.
- **Real data is the default.** Mock data only as an offline fallback, always labelled.
- **Every external endpoint the browser calls lives in `src/config.js`.** A test fails on any `https://`
  string elsewhere in `src/`. Only a few values may be overridden by query string, each confined
  (same-origin for `?api=`/`?data=`, a known host for the live layer).
- **ES modules everywhere.** `src/` modules the server imports (`config.js`, `data.js`, `services/live.js`,
  `search.js`) must run in Node, so guard browser globals.
- **Tests:** `node --test "tests/*.test.mjs"` (a bare folder argument fails on Node 24). Every parser,
  loader and query change gets a test.

### Repository layout

```
index.html                 one page; CDN libs with SRI; no inline <script>
src/
  config.js                every endpoint + apiUrl() (server route ↔ static snapshot file)
  data.js                  enrich(), summarize(), byYear(), formatters, esc()
  main.js                  state, map, deck overlay, frame loop, modes, UI wiring
  charts.js                donut, clock, year bars, timeline canvas (hand-drawn SVG/canvas)
  styles.css               design tokens + components (Part 5)
  scene.js                 terrain, hillshade, sun, sky, night glow
  sun.js                   solar position
  search.js / search-mode.js   one query model (browser + server) / its UI
  <deepdive>.js / <deepdive>-mode.js   shared algorithm / its UI   (Emberline: spread.js)
  services/live.js         live tiers;  services/arcgis.js etc.
  story.js narration.js documentary.js   guided story, speakable numbers, narrated film-in-app
  sonify.js <bed>.js       event notes; the film's sound bed  (Emberline: fireplace.js)
  provenance.js sources-view.js   source catalogue; its metaphor view
server/  index.mjs http.mjs db.mjs   API, security headers, SQLite
scripts/ load-*.mjs make-voice.mjs make-film.mjs make-social.mjs build-pages.mjs preview-pages.mjs kokoro-voice.py lib/
film/    storyboard.md scenes.js director.js clock.js render.py sound.py
social/  figures.js render.py banner.html cover.html
tests/   *.test.mjs
docs/intent/ 01-purpose … 08-backlog, README.md
.github/workflows/pages.yml
CLAUDE.md
```

---

## Part 4. Capabilities (the modes)

Each mode has a **For / Shows / Never** entry in `docs/intent/04-modes.md`. Build them in this order;
each must be finished (real data, honest labels, keyboard, tests) before the next starts.

### 4.1 Replay (mode 1): "feel a season as it happened"
- A scrubbable timeline across one season/period, play/pause, speed segments, memory toggle
  (*this season / all seasons*), category chips, magnitude slider, year range, dataset menu.
- Every event runs the **lifecycle animation** (Part 6). Traces from earlier stay as dim memory.
- Right panel: big tabular date, 3 KPIs (count, magnitude total, largest), category donut, time-of-year
  "clock", year bars (click a bar to jump), weekly series drawn behind the timeline track.
- A year change flashes the year large across the map.
- **Never** implies observed evolution if the animation is illustrative.

### 4.2 Deep dive (mode 2): "how did *one* event actually unfold?"
- *Emberline: True Spread Replay.* One large event rebuilt from real observations inside its real outline,
  with a director camera, a progress chart and a merge/slow-down rule.
- Shared algorithm in its own tested module; a loader writes `<deepdive>_events` / `<deepdive>_observations`.
- **Never** hides interpolation; the panel and About say exactly what is filled in.

### 4.3 Explore (mode 3): "the long view"
- deck.gl `HexagonLayer` 3D columns (height = summed magnitude, eased in from 0), `HeatmapLayer`, or every
  event at true size, across any year range; optional slow orbit camera.

### 4.4 Search (`/`): "answer a question about the record"
- One query model (`src/search.js`) run in the browser **and** by `/api/search` on the server.
- Plain-language box: recognized words become removable chips; other words search names.
- Faceted filters whose counts apply every *other* filter; a brushable year histogram; place by named
  feature / pin / drawn box; sortable results; matches ignite on the map in time order over the whole record as dust.
- Results feed Replay and Explore ("Replay these", "Explore in 3D"); export CSV and GeoJSON; the query lives
  in the URL hash so a link reopens it.
- Parser lookup tables are null-prototype objects. A new filter touches `emptyQuery`, `normalizeQuery`,
  `dimensions`, `describe`, `toParams`/`fromParams`, `parseText`, plus a test case.
- **Never** invents a field: every filter is a column or a direct derivation, and dropped rows are counted.

### 4.5 Live (mode 4): "connected to today"
- Tiered sources in `src/services/live.js`: configured layer → auto-discovered layer → national/satellite
  feed → **labelled simulation**. The badge reads LIVE or SIMULATED and lists each tier's status (● ok / ● failed).
- Context layer within an adjustable alert radius (haversine), with link lines and labels; a threat list.
- Every real pull is stored in a `live_snapshots` table, so the app builds its own archive.
- `/api/live?refresh` throttled to once a minute.

### 4.6 Sources (`S`): "where did this come from?" as a thing worth looking at
- `src/provenance.js` catalogues **every** source: data, live feeds, basemap, terrain, derivations, voice,
  sound, libraries, fonts. Owner, truth level, exact request (from `CONFIG`), licence (or "None stated"),
  citation. Counts come from `/api/provenance`, never from the catalogue.
- Drawn as a **subject metaphor** on canvas (*Emberline: rings = years, width = fire count, scars = worst
  seasons, bores = source coverage, bark = live feeds*). "Ask the source now" pings fixed catalogue URLs via
  `/api/provenance/ping/<id>`.

### 4.7 Story (`5`) and Watch (`W`)
- **Story:** 5–6 chapters (biggest period, a deep dive, category contrast, the top 1%, live now). Each has
  a computed headline, body with `<b>` figures, a camera move and a mode/filter setup.
- **Watch** (*"Emberline Presents"*): the story as a ~2½-minute narrated film **inside the live app**:
  title card → chapters → end card, `say` lines with word `cues`, counting numbers, captions, sound bed
  ducking under the voice. Pause means explore.

### 4.8 Cross-cutting
- **Detail card** on click: name, dates, magnitude, category, nearest context feature, human-scale
  comparisons, "replay this", "deep dive" when available.
- **3D terrain + real sun:** hillshade azimuth from the sun at the replay date, day/night terminator, golden
  dusk, glows brighter at night. Every deck layer is z-lifted by terrain elevation when 3D is on.
- **Event-specific flourish** (*Emberline: lightning bolts and drifting storm cells, grouped 1 day / 60 km*)
  that runs on the **wall clock** once triggered, so it stays visible at any replay speed.
- **Sonification** (🔊, `M`): one note per event, a bed that swells in busy weeks.
- **Intro screen:** rising particle canvas, eyebrow, gradient title, one-line lede, CTA, a computed footer.
- **About dialog:** method, truth levels, credits.

---

## Part 5. Look and feel (keep the system, swap the palette)

### Design tokens (`src/styles.css` `:root`)

Keep every token name and role; change only the hues for your material. Emberline's values:

```css
:root {
  --bg: #07080c;                         /* near-black, slightly cool */
  --panel: rgba(12, 13, 19, 0.72);       /* glass panels, with backdrop-filter: blur(16px) saturate(1.2) */
  --panel-solid: #0e0f16;
  --line: rgba(255, 255, 255, 0.08);     /* hairlines */
  --line-strong: rgba(255, 255, 255, 0.16);
  --text: #f3efe9;  --muted: #9a958e;  --dim: #5f5b56;   /* warm greys */
  --track: rgba(255, 255, 255, 0.07);
  --accent: #ff7a1f;       /* Emberline: --ember      main glow */
  --accent-hot: #ffd27a;   /* Emberline: --ember-hot  highlights, slider thumbs, hot KPIs */
  --accent-deep: #ff3d1f;  /* Emberline: --ember-deep gradient end */
  --cat-1: #ffc23d;  --cat-2: #ff5a36;  --cat-3: #a99bff;   /* category colours (lightning/human/unknown) */
  --ok: #7fe0a8;           /* LIVE / success */
  --radius: 14px;
  --font: 'Space Grotesk', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
  color-scheme: dark;
}
```

Starting palettes for other materials (check contrast on the dark basemap before committing):

| Material | accent / hot / deep | Lifecycle ramp (young → old) |
|---|---|---|
| *Fire (Emberline)* | `#ff7a1f` `#ffd27a` `#ff3d1f` | white-gold → orange → deep red → dim scar |
| Water / floods | `#2fb6ff` `#b8ecff` `#1f5bff` | white-cyan → blue → indigo → faint stain |
| Ice / snow | `#8fe3ff` `#f0fbff` `#5a8cff` | white → pale cyan → steel → frost trace |
| Life / ecology | `#5fe08a` `#d9ffb0` `#1fa86b` | lime → green → teal → moss trace |
| Quakes / energy | `#ff4fa3` `#ffd0ea` `#9b3dff` | white-pink → magenta → violet → faint ring |

Rules: one accent family carries all glow; categories must stay distinct from the accent and each other;
the basemap stays dark and quiet so the data is the only bright thing.

### Typography
- **Space Grotesk** 400–700 for UI and headings, tight tracking (`-0.02em` to `-0.05em`) on big type.
- **JetBrains Mono** for dates, counts in lists, kickers, badges, `kbd`.
- Kickers/eyebrows: mono, uppercase, `letter-spacing: 0.15–0.3em`, accent colour.
- Group labels: 11px uppercase, `0.12em`, muted. All numbers `font-variant-numeric: tabular-nums`.
- Hero numbers and titles: vertical gradient text (white → hot → accent → deep) with a breathing drop-shadow glow.

### Layout and components (as Emberline's `styles.css`)
- Full-bleed map `#map`, a radial **vignette** over it, attribution dimmed.
- **Top bar** (floating, 16px inset): pill brand with glowing icon · centred pill **mode switcher** (selected
  = accent gradient + inset ring, `kbd` hints, a pinging live dot) · round icon buttons (sound, sources, about).
- **Glass panels**: left 272px (controls), right 300px (stats), top 76px, bottom 100px, scroll thin; slide away in story mode.
- **Timeline** (bottom, 68px, glass): gradient round play button, canvas track with the weekly series, white
  glowing playhead with a mono date tag.
- **Controls:** segmented control (`.seg-ctl`), category chips with glowing dot, custom range sliders with a
  glowing hot thumb, dual-range for years, dark select.
- **KPIs:** 3-column grid, 22px bold values, hot KPI glows.
- **Card:** centred top, `rgba(14,15,22,0.92)`, accent-tinted border, kicker + 26px title + `dl` grid + a
  tinted comparison box + action buttons.
- **Story panel:** bottom-left, progress segments that light up, kicker, 28px title, body with hot `<b>`.
- **Buttons:** `.cta` (pill, accent gradient, dark text, lift on hover), `.ghost` (outline pill).
- **Toast** bottom-centre; **badge** mono 10px tinted (`SIMULATED` amber, `LIVE` green).
- Motion: `cubic-bezier(.2,.8,.2,1)` for panels and chart segments; 0.2s for hovers; fade-ins on text swaps.
- Any element with `hidden` that also sets `display` needs `[hidden] { display: none }`.
- Small screens: works, panels collapse; polish later.

### Map scene
- Basemap **CARTO Dark Matter** (no key). Region outline drawn twice: a wide additive glow + a thin bright line.
- deck.gl via `MapboxOverlay` (`interleaved: false`, drawn over the map). Glow layers use **additive blending** (`blendColorOperation: 'add'`,
  `depthWriteEnabled: false`) so overlapping events bloom.
- Terrain: Terrarium tiles (AWS Open Data), hillshade lit from the sun's azimuth (wrap 360 → 0), install on `style.load`.

---

## Part 6. Animation grammar

### The event lifecycle (Replay)
For each event with age `a = t − event.t` (in days):
- **Flash / shock ring:** for the first ~2.5 days a pixel-radius stroked ring expands and fades.
- **Growth:** radius → full equal-area radius over `1.5 + log10(mag + 1) × 3.5` days with ease
  `sqrt(1 − (1 − p)³)`.
- **Heat ramp:** white-hot → hot → accent → deep over ~30 days (`mix()` between ramp stops).
- **Core + halo:** a core at the radius and an additive halo at ~1.9× + constant, both with a flicker
  `0.82 + 0.18·sin(…)·sin(…)` and a night boost `1 + 0.55·night`.
- **Fade** after ~12 days, then the event leaves a **trace** (scar) layer: dim fill + outline, decaying
  `0.88^(yearsAgo)` in all-seasons memory.
- Only the active window is animated: binary-search the sorted events (`lowerBound`) each frame.

### Clocks
- **Replay clock** (`state.t`, days) drives data. Speed segments are days per second.
- **Wall clock** drives flourishes that must stay visible at speed (bolts, ripples, shock).
- `frame(now)` calls `requestAnimationFrame(frame)` **first**, then advances, rebuilds layers, ticks counters.
- Counters ease toward their target (never jump). Charts animate with dash transitions.

### Camera
- `flyTo` with gentle pitch for story chapters; slow orbit option in Explore; the deep dive has a director
  camera that follows the most active part of the front.

---

## Part 7. Data and server

### Schema pattern (`server/db.mjs`)
```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,             -- e.g. primary | alt | mock
  event_id TEXT NOT NULL,
  start_date TEXT NOT NULL,         -- yyyy-mm-dd
  end_date TEXT,
  year INTEGER NOT NULL,
  magnitude REAL NOT NULL,
  latitude REAL NOT NULL, longitude REAL NOT NULL,
  category TEXT NOT NULL,           -- the 2–4 coloured classes
  name TEXT, raw_category TEXT, /* … subject fields … */
  UNIQUE (source, event_id)
);
CREATE TABLE import_runs (…);       -- every load: input, counts, every rejected row and why
CREATE TABLE live_snapshots (…);    -- every real live pull
CREATE TABLE <deepdive>_events (…); CREATE TABLE <deepdive>_observations (…);
```

### Loaders
- Download once into `data/raw/` (cache; `--refresh` to re-fetch), parse, validate, insert in one
  transaction, record rejections in `import_runs`. Handle quoted commas, conflicting date fields,
  CRS reprojection, huge polygons (simplify; keep the source's area total), and endpoints that time out
  (one small request per day, cached).

### API (`server/index.mjs`)
`/api/sources`, `/api/events?source=` (compact gzip column format), `/api/search`, `/api/live`,
`/api/live/history`, `/api/provenance`, `/api/provenance/ping/<id>`, `/api/<deepdive>`, `/api/<deepdive>/<id>`,
`/api/voice/<clip>`. Every front-end call goes through `apiUrl()`.

### Security (as Emberline `server/http.mjs`)
- Escape everything from data or services with `esc()` before `innerHTML` or a deck tooltip; prefer `textContent`.
- CSP: no inline script, no `on…=` attributes, scripts only from `'self'` and `https://unpkg.com`.
- Loopback bind by default, foreign `Host` → 421, GET/HEAD only, 500s carry no detail.
- Recompute SRI hashes when upgrading a CDN library (`openssl dgst -sha384 -binary f | openssl base64 -A`).
- `tests/security.test.mjs` and `tests/config.test.mjs` from day one.

### Static GitHub Pages build
- `npm run build:pages` → gitignored `dist/`: front end + each API route saved as a file;
  `<meta name="<app>-static">` makes `apiUrl()` map routes to files; routes that can't be snapshotted
  return null and the browser falls back (live, search, ping run client-side).
- CSP as a `<meta>` (drop `frame-ancestors`). `.github/workflows/pages.yml` loads data in CI (downloads in the
  Actions cache), makes the voice, deploys `dist/`. Never commit `dist/`. `npm run preview:pages` serves it locally.

---

## Part 8. Voice, film and social

### Narration (shared with IRISIdeas)
- Local **Kokoro**, voice **`af_heart`**, speed **0.97**, en-us phonemes plus a `SOUNDS` fix table. Keep
  `scripts/kokoro-voice.py` constants identical to `C:\DevSource\IRISIdeas\scripts\render_explainer.py`.
- `src/narration.js` writes numbers for speech (spell out years; round sensibly; "about", "at least").
- `npm run make:voice` builds the story **in Node from SQLite**, so clip text matches the browser's; the
  manifest is keyed by exact line text; changed lines fall back to the browser voice (labelled) until remade.
- Run Python with `-I`; on Windows reconfigure stdout to UTF-8 before printing phonemes. Listen to place
  names and the app name before a demo; add stress fixes to `SOUNDS`.
- CI pins the kokoro-onnx v1.0 model files by SHA-256, the same as IRISIdeas.

### Sound
- The film's bed is **one subtle, subject-fitting texture** (*crackling wood fire*), synthesized, no
  third-party audio. Measure levels offline against the voice: bed ≈ −34 to −38 dBFS between lines,
  −43 to −46 under the voice, voice ≈ −22.6. Louder accents may be real events (say so in About).
- Any dramatic effect (*thunder*) is soft and distant, rate-limited (≤ 1 per 1.5 s). No harsh cracks.

### Explainer film (`npm run film`)
The real app, filmed one exact frame at a time under a virtual clock. Copy `film/clock.js`,
`film/director.js`, `film/render.py`, `film/sound.py` from Emberline and adapt.

- **Format:** 1920×1080, 30 fps, H.264, BT.709. App laid out at 1600×900, captured at 1.5× (2400×1350) so a
  1.5× push-in lands on real pixels. Mixed to −14 LUFS.
- **Virtual clock:** `performance.now`, `Date.now`, timers, rAF and CSS animations (Web Animations API) all
  run on film time. Anything new that animates must use them. Real fetches take real time: wait with
  `f.until(...)` (stops film time); wait in film time with `f.waitFor(...)`.
- **Director's toolkit:** `clickOn` / `drag` / `type` / `press` (real mouse and keys follow a drawn cursor
  that arcs, turns into a hand, dips on press, leaves a ripple) · `zoomTo` / `zoomOut` (newer move cancels
  older) · `spot` (dim all but one control) · `stat` (kinetic counting number + riser/hit) ·
  `burn('cover'|'reveal')` (noise-shaped *material* transition) · `letterbox` · `embers` (particles) ·
  `chip(n, kicker, title)` (numbered chapter title) · `endCard`.
- **Sound design:** pad that swells and ducks, the bed rising in action scenes, two-part mouse click panned to
  the cursor, key taps, whoosh per camera move, riser under each count + soft hit, transition roar, sub
  impact under title and end card.
- **Outputs** (gitignored `data/film/`): `<app>-explainer.mp4`, `.srt` captions, `script.md` with times,
  `youtube.txt` (title, chapters, tags), `storyboard.html` with a real frame per scene, `voice/`.
- Commands: `npm run film`, `-- --preview` (720p/15 fps), `-- --stills 12,95,180`, `-- --remix` (sound only).

#### Storyboard template (`film/storyboard.md`)
**The idea:** open on a number, end on its sources. Start in darkness with one figure counting up (every
event recorded), transition into the app, show what you can *do* with the record, end in the Sources view
where every number traces to a named public source. The payoff is trust.

| # | ≈Time | Scene | On screen | Camera / graphics | Cursor / keys | Narration (gist, `{computed}`) | Sound |
|---|---|---|---|---|---|---|---|
| 1 | 0:00 | Cold open | Black, particles | Kinetic `{count}`, then `{total magnitude}` | Hidden | "Since `{first}`, `{place}` has recorded `{count}` `{events}`… This is every one of them." | Pad, risers, hits |
| 2 | 0:17 | Title | Transition reveals the intro | Push-in on title | Clicks *Enter* | "`{App}` is an atlas of that record, rebuilt from public data…" | Roar, sub impact, click |
| 3 | 0:27 | Replay | `{top year}` plays | Zoom on year bars, counters; kinetic stat | Clicks the bar, a speed | "`{top year}` was the worst… `{k}` times an average year." | Clicks, bed |
| 4 | 0:52 | One event | Largest event's card | Spot the card, zoom on comparison | Opens it, hovers | "…about `{k}` times the area of `{familiar place}`." | Click, whoosh |
| 5 | 1:05 | Deep dive | Real observations rebuild it | Chip 02, letterbox | Clicks *Deep dive*, a speed | "…observed `{n}` times over `{d}` days… interpolated between real sightings." | Bed rises |
| 6 | 1:30 | Flourish | The subject's signature phenomenon | Chip 03, scrub zoom | Drags playhead, *Play* | "`{category}` starts `{pct}`% of events but `{pct}`% of the total…" | Signature effect |
| 7 | 1:50 | Search | Typed query → chips → results ignite | Chip 04, spot the box, kinetic share | **Types** a query | "Ask it a question in plain words… `{n}` events, `{share}`%." | Key taps, riser + hit |
| 8 | 2:17 | Explore | Hex columns rise and orbit | Chip 05, push in | *Explore in 3D*, *Orbit* | "The largest one percent… `{pct}`% of it all." | Whoosh, hit |
| 9 | 2:42 | Live | Live layer, context, alert radius | Chip 06, zoom on slider | Drags radius | Line chosen at render time by which live tier answered | Clicks |
| 10 | 3:00 | Sources | Metaphor view opens | Chip 07, push in, spot the card | Hovers, clicks *Ask the source now* | "Every number traces back… `{sources}` sources, `{records}` records, not one data file in the repo." | Click, hit |
| 11 | 3:35 | End card | Title, record in one line, sources | Full frame | Hidden | "`{App}`. Every `{event}`, from the record." | Roar, pad resolves |

Rules: every braced figure is computed in `film/scenes.js` with the same modules the app uses (search
figures with `search.js`, ring/source summary like the Sources view); interpolation wording kept; live line
honest about which tier it shows; the ping reply is never read aloud.

### Social images (`npm run make:social`)
- `social/figures.js` computes figures from real sources only (mock throws), over the continuous record.
- `social/render.py` captures the app (UI hidden, a hero visual) and fills each `[data-fig]` in
  `banner.html` / `cover.html`. Never type figures into the HTML. The CSP blocks Playwright's
  `wait_for_function`, so poll with `page.evaluate` and wait a fixed time (the map never idles).

---

## Part 9. Project memory (create on day one)

- `CLAUDE.md`: purpose, hard constraints, key decisions and why, **verified facts about external services
  with dates**, conventions, security rules, one short section per built feature, open threads.
- `docs/intent/`: `01-purpose` · `02-principles` · `03-constraints` · `04-modes` (For / Shows / Never) ·
  `05-data` (sources, why, truth levels) · `06-decisions` (decision, alternatives, why; append only) ·
  `07-status` · `08-backlog` (with verified sources and order). Update in the same commit as the change.
- `README.md`: how to load, run, test, build Pages, make voice/film/social; credits.
- Commit messages end with the session's Co-Authored-By trailer.

---

## Build order

1. **Scaffold:** repo layout, `config.js`, `data.js`, server with security headers and tests, intent docs, CLAUDE.md.
2. **Primary loader** + `/api/events` + a mock generator (labelled).
3. **Replay:** map scene, lifecycle animation, timeline, filters, stats, card, intro, keyboard. *Verify in a
   real browser; the desktop preview pane throttles rAF to about 1 fps.*
4. **Explore**, then **Live** (tiers, context layer, snapshots).
5. **Terrain + sun**, the signature flourish, sonification.
6. **Deep dive** (loader, shared algorithm, mode).
7. **Search** (one model, server route, URL state, exports).
8. **Sources** catalogue and metaphor view.
9. **Story**, **voice** (`make:voice`), **Watch**.
10. **Static Pages build** + CI.
11. **Explainer film**, then **social images**.

## Definition of done (every feature)

- [ ] Real data by default; simulated parts labelled; truth level of every visual element named.
- [ ] Figures computed, nothing typed in. Endpoints only in `config.js`. New source → loader + catalogue entry.
- [ ] Everything from data escaped. No inline script. Keyboard reachable. Fails soft.
- [ ] Tests added and `npm test` green on Node 22 and 24.
- [ ] Verified in a real browser at full frame rate; looks as good as the rest.
- [ ] Works in the static Pages build (snapshot or browser fallback).
- [ ] `CLAUDE.md` and `docs/intent/` updated in the same commit.

---

## Kickoff prompt

> Read `BLUEPRINT.md`. Part 1 is my idea; Parts 2–9 are the house style from my Emberline project at
> `C:\DevSource\Wildfire-Sask`, which you may read as the reference implementation. First, check the data
> sources in Part 1 are real and reachable today (record what you verify, with the date), propose answers for
> any blank rows, pick the palette and metaphors, and ask me only what blocks you. Then write `CLAUDE.md` and
> `docs/intent/`, and start the build order at step 1.
