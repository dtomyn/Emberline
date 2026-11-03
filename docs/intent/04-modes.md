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

## Live

- **For:** showing that the app is connected to today, not just a history book, and putting
  current fire next to the communities it could reach.
- **Shows:** active incidents (configured SPSA layer → auto-discovered SPSA layer → CWFIS
  satellite hotspots → labelled simulation), satellite perimeters, live SPSA community points,
  communities within an adjustable alert radius, and the last 3 hours of CLDN lightning.
- **Never:** passes off simulation as live. The badge reads LIVE or SIMULATED.
- **Also:** stores every real pull in `live_snapshots`, so the app builds its own archive of seasons.

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
