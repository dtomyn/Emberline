# Emberline: explainer film storyboard

A 3½-minute YouTube explainer, filmed from the real application one exact frame at a time. Nothing in it
is a mock-up: every shot is the running app, driven by a scripted cursor and keyboard, captured frame by frame.
Everything below is scripted in [`film/scenes.js`](scenes.js), staged by [`film/director.js`](director.js),
scored by [`film/sound.py`](sound.py) and rendered by [`film/render.py`](render.py), so the film can be remade
after any data or UI change with one command:

```
npm run film                 # the 1080p film, captions, script, YouTube text, storyboard (about an hour)
npm run film -- --preview    # 720p, 15 fps check of timing and sound
npm run film -- --stills 12,95,180   # single frames, no video
npm run film -- --remix      # remake only the soundtrack and final file from the last render's picture
```

Numbers in braces are computed from the loaded record at render time, never typed in. Change a figure (load new
data) and the narration changes with it; only the voice lines whose text changed are re-spoken.

## The idea

**Open on a number, end on its sources.** The film starts in darkness with one figure counting up (every wildfire
Saskatchewan has recorded), burns through to the app, shows what you can *do* with that record (replay, open,
rebuild, search, explore, go live), and ends by turning the whole thing inside out: the Read the rings view,
where every number just seen traces back to a named public source. For an SPSA audience, the payoff is trust.

## Format and craft

- **Picture.** 1920×1080, 30 fps, H.264, BT.709. The app is laid out at 1600×900 and captured at 1.5× (2400×1350),
  so a 1.5× zoom-in still lands on real pixels.
- **Voice.** Local Kokoro, `af_heart` at 0.97 (the documentary mode's and IRISIdeas' voice), made by
  `scripts/kokoro-voice.py` into `data/film/voice/`. Spoken figures follow `src/narration.js`.
- **Sound** (all synthesized in `film/sound.py`, no third-party audio). A low D-minor pad that swells and ducks
  under the voice; a fire bed that rises with the burning scenes; a soft two-part **mouse click** (press and
  release, panned to the cursor) on every press; a **key tap** for every typed character; an air **whoosh** on each
  camera move; a **riser** under every counting number and a soft **hit** when it lands; a **burn roar** under
  each burn transition; **thunder** on every lightning strike the replay draws; a **sub impact** under the title
  and the end card. Mixed to −14 LUFS (YouTube).
- **Cursor.** A drawn arrow that glides on gentle arcs, turns into a hand over anything clickable, dips when
  pressed and leaves an ember ripple. The real mouse and keyboard follow it, so hovers, tooltips, typing and
  clicks are the app's own.
- **Camera.** A screen-recording camera over the app: it pushes in on what the cursor is about to touch or the
  narrator is talking about, and pulls back out. Titles stay put while it moves.
- **Motion graphics** (all in `film/director.js`, all driven by the film clock):
  - **Kinetic numbers**: a big glowing figure that counts up, with a label and a rule that draws in.
  - **Spotlight**: the frame dims around one control, with a glowing outline that glides between targets.
  - **Burn transitions**: a noise-shaped fire front that eats the frame to black and burns back out to the next shot.
  - **Chapter chips**: a numbered lower-left title as each feature starts.
  - **Letterbox**: cinema bars slide in for the big camera flights.
  - **Vignette**: a faint permanent edge darkening, so the bright map reads as a film.

## Shot list

| # | ≈Time | Scene | On screen | Camera / graphics | Cursor / keys | Narration (gist) | Sound |
|---|---|---|---|---|---|---|---|
| 1 | 0:00 | **Cold open** | Black, embers rising | Kinetic number counts to {fires}, then {hectares} | Hidden | "Since {first}, Saskatchewan has recorded {fires} wildfires. Together they burned {ha} hectares, an area equal to {pct} percent of the province, though some ground has burned more than once. This is every one of them." | Pad swells, risers, hits |
| 2 | 0:17 | **Title** | Burn transition reveals the Emberline intro | Slow push-in on the title | Glides to *Enter the atlas*, click | "Emberline is an atlas of that record, rebuilt from public data and replayed as it happened." | Burn roar, sub impact, click, big whoosh |
| 3 | 0:27 | **Replay** | {top year} plays day by day: fires flare, glow, cool to scars | Zoom on the season bars, then the counters; kinetic {top ha}; letterbox off | Clicks the {top year} bar, then *3×* | "Pick any season… {top year} was the worst in the record: {n} fires, {ha} hectares, {k} times an average year." | Clicks, fire bed, hit |
| 4 | 0:52 | **One fire** | The season's largest fire opens its card | Spotlight the card, zoom on the comparison | Clicks *Largest so far*, hovers the comparison | "Every fire can be opened. The largest that year… about {k} times the area of Saskatoon." | Click, whoosh |
| 5 | 1:05 | **True spread** | NBAC perimeter + satellite detections rebuild how it grew | Chip 02, letterbox while it burns, zoom on the growth chart | Clicks *True spread*, *8 d/s* | "Satellites detected it {n} times over {d} days… the front interpolated between real sightings." | Fire bed rises |
| 6 | 1:30 | **Lightning** | Scrub to the record's biggest lightning outbreak; bolts and storm cell | Chip 03, zoom on the scrub track, letterbox for the flight | Drags the playhead, clicks *1×*, *Play* | "Lightning starts {pct}% of fires but {pct}% of the area… one outbreak sparked {n} of them." | Thunder on every bolt |
| 7 | 1:50 | **Search** | Burn transition into Search; a plain-language query becomes filters; results ignite in date order | Chip 04, spotlight the box, zoom on the chips and KPIs, kinetic {share}% | Clicks the box, **types** "lightning at least 10,000 ha", hovers a result | "Ask it a question in plain words… {n} fires, {pct of count}% of the record, burned {share}% of everything." (the share is of every fire since the record's first year, as the Search tab counts it) | Key taps, clicks, riser + hit |
| 8 | 2:17 | **Explore** | *Explore in 3D*: the search becomes 3D hexagon columns; then *Show all fires*: every season rises and orbits | Chip 05, push in on the columns, kinetic 1% stat | Clicks *Explore in 3D*, *Show all fires*, *Orbit camera* | "One click turns a search into columns… The largest one percent of fires, {n}, burned {pct}% of it all." | Whoosh, clicks, hit |
| 9 | 2:42 | **Live** | SPSA communities, satellite/agency incidents, alert radius links | Chip 06, zoom on the slider | Clicks *Live*, drags the alert radius | "Live mode reads SPSA's own map services and the national satellite feeds…" (line chosen at render time: SPSA fires, CWFIS hotspots, or the labelled simulation) | Clicks |
| 10 | 3:00 | **Read the rings** | The fire-scarred tree cross-section burns open from the pith | Chip 07, push in on the rings, spotlight the list, zoom on the card and the live reply | Hovers a scar (tooltip), hovers the CNFDB bore, clicks *SPSA communities*, clicks *Ask the source now* | "Every number traces back to where it came from… each ring a year, the scars its worst seasons… it asks SPSA's own server, right now. {sources} sources, {records} real records, and not one data file in the repository." | Click, soft crackle, hit |
| 11 | 3:35 | **End card** | Burn transition to the title, the record in one line, the sources | Full frame | Hidden | "Emberline. Every fire, from the record." | Burn roar, pad resolves, sub impact |

Rules the script keeps:

- The spread line keeps "interpolated between real detections" (CLAUDE.md).
- Province share uses Saskatchewan's total area, 651,036 km² (Statistics Canada), and says "an area equal to" and that some ground has burned more than once, since
  fires reburn the same ground.
- The search figures are computed with `src/search.js`, the same module the Search tab runs, so the spoken
  numbers are the ones on screen.
- The ring summary (sources, records) is computed the same way the Sources view computes its header, from
  `/api/provenance` and `src/provenance.js`.
- The live line is chosen at render time: if the app is showing a labelled simulation the narrator says so;
  if SPSA incidents are loaded it counts active fires; if only CWFIS hotspots are, it calls them satellite hotspots, not fires. The ping reply is never read aloud (it is live).

## Outputs (all in gitignored `data/film/`)

- `emberline-explainer.mp4`: the film (1080p).
- `emberline-explainer.srt`: captions timed to the voice, for YouTube.
- `script.md`: the narration as rendered, with the time of every line.
- `youtube.txt`: title, description with chapter timestamps, tags.
- `storyboard.html`: this storyboard with a real frame from every scene.
- `voice/`: the Kokoro clips, remade only when a line's text changes.
