# 4. Intent of each mode and feature

Each entry gives what the feature is **for**, what it must **show**, and what it must **never** do.

## Replay

- **For:** feeling a fire season as it happened. The rhythm of a season (the June bursts, the
  lightning storms, the quiet autumn) is the story most charts flatten.
- **Shows:** every ignition flashes, grows to its reported size and cools to a burn scar, day
  by day. A scrubbable season timeline, speed control, cause and size filters, live charts.
- **Never:** implies observed growth. A fire's growth here is an animation to its final size;
  the circle is equal-area. Observed growth belongs to Spread.

## Spread (True Spread Replay)

- **For:** answering the question Replay can't: *how did this fire actually grow?*
- **Shows:** one of Saskatchewan's largest fires growing day by day from real satellite
  detections, inside its real NBAC burned-area perimeter. Hot pixels flare, a front coloured by
  spread rate sweeps across and chars, embers drift with the recorded wind, merges slow the
  replay down, and a director camera follows the action.
- **Never:** hides that the front is interpolated between detections. Keep that wording if the
  method changes.

## Explore

- **For:** the long view: where fire concentrates across decades, and how years compare.
- **Shows:** 3D hexagon columns of area burned, a heatmap, or every burn at true area, across
  any range of years, with an optional orbit camera.

## Search

- **For:** turning the atlas into a tool a specialist can query: "which lightning fires over
  1,000 ha started within 50 km of La Ronge since 2000, and how long did they burn?" The other
  modes show the record; Search answers questions about it.
- **Shows:** a plain-language search box whose recognized words become removable chips (other
  words search fire names); faceted filters whose counts show what each choice would return
  (cause, month, size class and bounds, duration, place by community / pin / drawn box, years
  by brushing a histogram, named fires, spread replays, protection zone); a sortable result list;
  matches igniting on the map in the order they started against the whole record as dust.
  Results feed Replay and Explore, export to CSV and GeoJSON, open from `/api/search`, and
  live in the URL so a link reopens the exact search.
- **Never:** invents a field. Every filter is a column the record holds or a direct derivation
  (size class from hectares, duration from report and out dates, distance from coordinates).
  Fires without an out date drop out of duration filters, and the panel says how many.

## Live

- **For:** showing that the app is connected to today, not just a history book, and putting
  current fire next to the communities it could reach.
- **Shows:** active incidents (configured SPSA layer → auto-discovered SPSA layer → CWFIS
  satellite hotspots → labelled simulation), satellite perimeters, live SPSA community points,
  communities within an adjustable alert radius, and the last 3 hours of CLDN lightning.
- **Never:** passes off simulation as live. The badge reads LIVE or SIMULATED.
- **Also:** stores every real pull in `live_snapshots`, so the app builds its own archive of seasons.

## Sources (Read the rings)

- **For:** answering "where did this come from?" for a specialist who knows the data, in a
  way that is itself worth looking at. Fire history is dated from tree rings, so the trace is a
  fire-scarred cross-section rather than a footnote.
- **Shows:** each ring is a year of the record (wider with more fires), the largest seasons
  leave scars, record sources run as bores through the years they cover, live feeds sit in the
  bark, and the scene, made-here pieces (derivations, interpolation, voice, sound) and code
  circle outside. Each source's card: owner, what it gives, counts from the database, the
  rejection funnel, the exact request, licence (or "none stated"), a citation, and a live
  check against the source. Opens from the top bar, the intro, About, <kbd>S</kbd> or `#sources`.
- **Never:** lists a source the app doesn't use, or writes a count by hand. Every number comes
  from `/api/provenance` or a live check; the catalogue (`src/provenance.js`) holds only
  descriptions and the endpoints from `config.js`. Simulated sources carry their label here too.

## Story

- **For:** a guided path for someone who doesn't know where to click: the biggest season, a
  true spread replay of its largest fire, lightning vs. human causes, the top 1% of fires, the
  live picture.
- **Never:** contains a hard-coded figure. Every number is computed from the selected dataset.

## ▶ Watch (Emberline Presents)

- **For:** something SPSA can play in a room. The Story as a narrated film of about 2½ minutes,
  with camera, data and voice in sync, playing *inside the live app*.
- **Shows:** title card → chapters → end card. A local Kokoro voice (`af_heart`, the IRISIdeas
  voice) reads each line; cues fire on spoken words; numbers count up; captions run. A subtle
  crackling wood fire sits underneath and ducks under the voice.
- **Never:** speaks a number the data doesn't support (clips are keyed by exact line text and
  rebuilt from SQLite by `npm run make:voice`), or hides that the voice is synthetic.
- **Pause means explore:** pausing leaves the viewer in the real, interactive map.
- **Sound bed stays subtle.** Its levels were measured against the voice; re-measure before changing them.

## Explainer film (`npm run film`, not in the app)

- **For:** a YouTube video that shows SPSA and anyone else what the app does, with the same "wow".
  The real app filmed frame by frame: a drawn cursor (the real mouse follows it, so hovers and
  clicks are the app's own), real typing into Search, video zoom-ins, a spotlight on the control being
  used, numbers that count up, burn transitions, click and key sounds, titles, Kokoro narration and a
  score. It opens on the record's size and closes on Read the rings, so the payoff is that every
  number traces to a named public source.
- **Never:** a mock-up. Every shot is the running app on the loaded data, and every spoken figure
  is computed at render time. The live scene says "labelled simulation" when that is what it shows.
- **Rerunnable:** one command remakes it after any data or UI change (`film/storyboard.md`).

## Cross-cutting features

- **Fire detail card.** Click any fire for size comparisons, the nearest community, "replay this
  fire" and, where available, "true spread". *For:* making each record a fire someone can recognise.
- **3D terrain and real sun.** Hillshade from the sun's azimuth, a day/night terminator, golden
  dusk, fires glowing brighter after dark. *For:* making the province feel like a place, and
  making time of day visible. Saskatchewan stays on CST all year.
- **Lightning Storms.** A bolt at every lightning-caused fire; nearby ignitions grouped into
  storms with a drifting cell. *For:* showing that most area burned starts with lightning. Strike
  hour and cell shape are illustrative, and the UI says so.
- **Hear the Season.** Every ignition plays a note: pitch by size, timbre by cause, pan by
  longitude, a crackle bed that swells in busy weeks. *For:* a second sense that makes big years
  unmistakable. Starts only from the 🔊 click.
- **Dataset menu.** Switch between loaded sources (CNFDB, SPSA export, mock). *For:* honesty
  about provenance and an offline fallback.
