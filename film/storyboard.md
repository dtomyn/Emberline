# Emberline: explainer film storyboard

A 2½–3 minute YouTube explainer, filmed from the real application one exact frame at a time.
Everything below is scripted in [`film/scenes.js`](scenes.js) and rendered by [`film/render.py`](render.py),
so the film can be remade after any data or UI change with one command (`npm run film`).
Numbers in braces are computed from the loaded record at render time, never typed in.

**Format.** 1920×1080, 30 fps, H.264 + AAC, loudness −14 LUFS (YouTube). The app is laid out at
1600×900 and captured at 1.5× (2400×1350), so a 1.25× zoom-in still lands on real pixels.
**Voice.** Local Kokoro, `af_heart` at 0.97, the same voice as the documentary mode and IRISIdeas.
**Sound.** A low generative pad (ducks under the voice), a soft mouse click on every press and
release, an air whoosh on every camera zoom, a sub impact under the title, thunder on every real
lightning strike the replay draws, and the crackle of fire under the burning scenes. All synthesized
by [`film/sound.py`](sound.py); no third-party audio.
**Cursor.** A drawn arrow that glides on gentle arcs, turns into a hand over anything clickable,
dips when pressed and leaves an ember ripple. The real mouse moves with it, so hovers, tooltips and
clicks are the app's own.
**Zoom.** A video camera on top of the app (screen-recording style): it pushes in on what the
cursor is about to touch or what the narrator is talking about, then pulls back out. On-screen
titles stay put while it moves.

| # | Time (approx.) | Scene | Shows | Camera / zoom | Cursor | Narration (gist) | Sound |
|---|---|---|---|---|---|---|---|
| 1 | 0:00 | **Cold open** | The intro: embers rising, the Emberline title | Fade from black, slow push-in on the title (1.0→1.12) | Hidden | "Since {first year}, Saskatchewan has recorded {count} wildfires. This is every one of them." | Pad swells, sub impact on the title |
| 2 | 0:10 | **Enter** | The map flies down onto the province | Push back out as the camera dives | Glides to *Enter the atlas*, hand, click | Emberline is an atlas of that record, from public data only | Click, whoosh with the flight |
| 3 | 0:20 | **Replay** | The worst season, {top year}, plays day by day: ignitions flare, glow, cool to scars; counters climb | Zoom on the date and counters, back out to the map | Clicks *Play*, later *3×* | Each fire ignites on its reported date. {top year}: {fires} fires, {ha} hectares, {k}× an average season | Clicks, fire crackle bed, thunder on strikes |
| 4 | 0:45 | **A single fire** | The season's largest fire opens its detail card | Zoom on the card | Clicks the *Largest so far* link, hovers the comparison | Every fire is clickable: {name}, {ha} hectares, {k}× the area of Saskatoon | Click, whoosh |
| 5 | 1:00 | **True spread** | NBAC perimeter + satellite detections rebuild how the fire grew, director camera on | Zoom on the growth chart, then out | Clicks *True spread*, then *8 d/s* | Satellites saw it {n} times over {days} days; the front is interpolated between real detections | Crackle rises with the fire |
| 6 | 1:25 | **Lightning** | The record's biggest lightning outbreak strikes, bolts and storm cell | Zoom on the scrub track while dragging | Clicks *Replay*, drags the playhead to the storm | Lightning starts {pct}% of fires but {pct}% of the area; on {date} one storm sparked {n} | Thunder on every bolt |
| 7 | 1:45 | **Explore** | {seasons} seasons collapse into 3D hex columns that rise, then orbit | Push in on the columns | Clicks *Explore*, *3D Hex*, *Orbit camera*, hovers a column (tooltip) | The top 1% of fires, just {n}, burned {pct}% of all area | Clicks, whoosh |
| 8 | 2:05 | **Live** | SPSA communities, satellite/agency incidents, alert radius links | Zoom on the slider, then out | Clicks *Live*, drags the alert radius | Live mode reads SPSA's GIS and national feeds; off-season it says so and labels the simulation | Clicks |
| 9 | 2:20 | **Sources** | *Read the rings*: the fire-scarred tree cross-section of every source | Zoom on a source card | Clicks *Sources*, picks a source | Every number traces to a named public source and licence | Click, soft crackle |
| 10 | 2:35 | **End card** | Title, sources line, link | Full frame | Hidden | "Emberline. Every fire, from the record." | Pad resolves, sub impact |

The live scene's line is chosen at render time: if the app is showing a labelled simulation the
narrator says so; if real incidents or hotspots are loaded it counts them. Spoken figures follow the
same rules as the app (`src/narration.js`), and the spread wording keeps "interpolated between real
detections".

## Outputs (all in gitignored `data/film/`)

- `emberline-explainer.mp4`: the film (1080p).
- `emberline-explainer.srt`: captions timed to the voice, for YouTube.
- `script.md`: the narration as rendered, with the time of every line.
- `youtube.txt`: title, description with chapter timestamps, tags.
- `storyboard.html`: this storyboard with a real frame from every scene.
- `voice/`: the Kokoro clips, remade only when a line's text changes.
