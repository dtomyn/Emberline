# Emberline: ideas for the next level of "wow"

Ideas for taking Emberline from an impressive map to something SPSA staff will want to show
other people. Every idea uses **publicly available data**, and each source was checked on
**2026-11-03**. Re-check an endpoint before building on it.

The ideas follow the rules in [CLAUDE.md](../CLAUDE.md): the visuals have to be striking *and*
real; datasets are rebuilt by load scripts into `data/wildfire.db` and never committed;
anything simulated or synthetic is labelled; and narrated numbers come from the data.

---

## The short list (if you only build three)

| # | Idea | Why it wows |
|---|---|---|
| 1 | **True Spread Replay** | Fires grow as they really did, day by day, from satellite detections. No more "equal-area circles." |
| 2 | **Emberline Presents: narrated documentary mode** | A 3–5 minute film narrated by Kokoro that plays *inside the live app*, with camera, data and voice in sync. |
| 3 | **Your Community's Fire Story** | Pick any town and see its decades of nearby fire as glowing tree rings, read aloud and shareable as an image. |

Together they give SPSA something it doesn't have today: the province's fire history told
as a story, accurate to the day, at the scale of their own communities.

---

## 1. True Spread Replay (real day-by-day fire growth): built, see the Spread mode

**What you see.** Pick the 2025 Shoe fire. The camera drops into a low, tilted 3D view.
Satellite detections pop in day by day as hot pixels that flare white and cool to red. A
glowing perimeter front stretches and merges as the hotspots accumulate, and the final NBAC
perimeter fades in as a scar. A ticker counts hectares and days, and a small chart traces the
growth curve. Scrub back and forth to watch the front move.

**Data (public, verified).**
- **NBAC: National Burned Area Composite** (NRCan), 1972 onward, real perimeter polygons.
  WFS `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows`, layer `public:nbac`. Fields include
  `year`, `admin_area` (filter `'SK'`), `poly_ha`, `firecaus`, `hs_sdate`/`hs_edate` (first and last
  hotspot dates), `ag_sdate`/`ag_edate` (agency dates), `nfireid`. Bulk downloads are under
  `https://cwfis.cfs.nrcan.gc.ca/downloads/nbac/`.
- **Historical hotspots** (MODIS 2001 onward, VIIRS 2012 onward): layer `public:hotspots`, with
  `rep_date`, `agency`, `frp` (fire radiative power), `sensor`, and per-detection fire-behaviour
  fields (`ros`, `hfi`, `fwi`, `fuel`).
- **M3 daily perimeters**: `public:m3polygons` (`firstdate`, `lastdate`, `area`, `status`).

**How it fits.** A new `scripts/load-nbac.mjs` pages WFS by year with `admin_area='SK'` and
stores polygons in SQLite (GeoJSON text plus bbox columns, so no SpatiaLite is needed). A
`scripts/load-hotspots.mjs` stores SK hotspots with `rep_date`. Join a fire to its hotspots by
time window and bbox, then by point-in-polygon in the loader. In the browser, the front
for day *d* is the concave hull of hotspots seen up to *d*, clipped to the final perimeter.
That's honest growth: an interpolated front drawn from real detections.

**Wow extras.** Fire radiative power drives glow intensity and particle "embers" rising off the
active front. Colour the front by spread rate from day-over-day area change. "Merge moments"
get a slow-motion beat.

**Effort:** medium–large. **Risk:** hotspot volume is large (millions of Canada-wide rows), so
filter to SK on load and pre-compute per-fire daily fronts.

---

## 2. Emberline Presents: narrated documentary mode (Kokoro voice)

**What you see.** Press **Watch** and the app becomes a film. A warm voice opens:
*"Since 1981, Saskatchewan has recorded twenty-six thousand wildfires…"* The camera flies,
seasons replay, numbers count up as they're spoken, and captions run along the bottom. Each
chapter's map is the real, interactive app, so a viewer can pause at any moment and explore
from that exact view.

**Voice: Kokoro, already on this machine.** The IRISIdeas project's setup can be reused:
- Model files: `C:\DevSource\IRISIdeas\.venv\kokoro\kokoro-v1.0.onnx` and `voices-v1.0.bin`
- Python with `kokoro-onnx` and `soundfile` installed: `C:\DevSource\IRISIdeas\.venv\Scripts\python.exe`
  (`import kokoro_onnx` checked OK)
- Voice settings IRISIdeas uses: `af_heart`, speed `0.97`, 24 kHz, phonemized with
  `engine.tokenizer.phonemize(text, lang="en-us")`, then `engine.create(..., is_phonemes=True)`.

**How it fits.**
1. `src/story.js` already builds every chapter's text from the data. Add a `narration` line per
   chapter, plus timed **cues** ("on the word *Shoe*, fly to the fire").
2. `scripts/make-voice.py` (run with the IRISIdeas venv, or set `KOKORO_DIR`/`KOKORO_PYTHON`)
   exports the lines from the server (`/api/story/lines`), synthesizes each to
   `data/voice/<id>.ogg`, and records its duration. Lines are cached by text hash, so only
   changed lines are re-made. The files are generated, live in gitignored `data/`, and are
   rebuilt by the script, so the no-data-in-git rule holds.
3. Durations set the timeline. Cues placed on words are positioned by character offset ×
   duration, the same approach IRISIdeas uses, so the camera lands on the word it illustrates.
4. If voice files aren't present, fall back to the browser's Web Speech voice.
5. **Pronunciation table** for local names Kokoro will read wrongly from spelling:
   Saskatchewan, La Ronge, Île-à-la-Crosse, Cumberland House, Creighton, Pelican Narrows,
   Stanley Mission, Denare Beach, Wollaston, Athabasca, Buffalo Narrows, Pinehouse.
   IRISIdeas keeps a phoneme-substitution map (`SOUNDS`), and this project would copy that pattern.
6. **Disclose** "Narration uses a synthetic voice" on the title card.

**Wow extras.**
- A **live "on-demand" narrator**: `POST /api/tts` on the local server shells out to a small
  persistent Kokoro worker, so *any* fire's detail card gets a ▶ "Tell me about this fire"
  button. The data-built sentence comes back spoken in about a second.
- **Video export**: a Playwright + ffmpeg script (pattern already in IRISIdeas
  `scripts/render_explainer.py`) films the real app frame by frame at 1440p, so the documentary
  becomes a YouTube or LinkedIn clip that SPSA can share.
- **Ducking soundscape**: low wind and crackle beds that duck under the voice and swell in big seasons.

**Effort:** medium. **Risk:** pronunciation needs checking by ear.

---

## 3. Your Community's Fire Story (fire tree rings)

**What you see.** Type "La Ronge." The map flies there and the town becomes the centre of a
**tree-ring chronology**: each ring is a year from 1981 to now, and each fire within 100 km is
a glowing notch on its year's ring, placed at its compass bearing from town and sized by area.
Bad years blaze as bright rings. The narrator reads a summary built from the data: *"Within
100 kilometres of La Ronge, 1,140 fires have burned 2.1 million hectares. The closest large
fire…"* Export as a poster-quality PNG or SVG.

**Data.** Community points live from SPSA ArcGIS (`SPSA/Communities/MapServer`, already used),
CNFDB / NBAC from SQLite, and **2021 Census population** from Statistics Canada (public CSV/API)
for "people living within X km."

**Effort:** small–medium. A strong "for every community" hook that's easy to share.

---

## 4. Lightning Storms (strikes you can see)

**What you see.** In Replay, lightning-caused ignitions that cluster in space and time are
grouped into **storm events**. A dark cell crosses the map, bolts strike (a quick flash and
screen-space glow), and fires flare where they landed, sometimes dozens in one afternoon.

**Data.**
- History: CNFDB lightning-caused fires (`CAUSE = 'N'`), grouped into storms with a
  space-time clustering pass (DBSCAN on lat, lon and day) in the loader. **Be honest:** bolts
  mark *recorded lightning ignitions*, not every strike. Label them that way.
- Live: ECCC MSC GeoMet WMS `https://geo.weather.gc.ca/geomet`, layers `Lightning` and
  `Lightning_2.5km_Density` (verified in GetCapabilities). Show current lightning density
  over the province with a pulsing animation.

**Effort:** small–medium. **Wow:** very high for little code.

---

## 5. Where the Smoke Went

**What you see.** A translucent, slowly churning **smoke veil** drifts out of the north toward
Saskatoon, Regina, and on into the US. Each community lights up by air quality. A forecast
slider runs the next 48 hours.

**Data (verified layer names on GeoMet WMS).**
- `RAQDPS.Sfc_PM2.5-WildfireSmokePlume` (and `-DAvg`, `-DMax`), ECCC's FireWork wildfire smoke forecast
- `AQHI-OBS`, observed Air Quality Health Index
- `GOES-East_1km_SmokeABIband1-SWIR` / `GOES-West_…`, satellite smoke imagery

**How it fits.** WMS raster tiles added as MapLibre raster sources with a `TIME` dimension,
animated by stepping through times. A shader pass, or simply MapLibre `raster-opacity`
cross-fades between frames, gives the churning motion.

**Effort:** small for the overlay, medium for the polished animation.

---

## 6. Fire Weather Pulse

**What you see.** Fire-weather stations "breathe": beacons whose glow and pulse rate follow
the Fire Weather Index. On a high-FWI day the whole north throbs red just before a wave of
ignitions arrives. A "drought ribbon" under the timeline shows the Drought Code building through the season.

**Data.**
- Current station FWI: CWFIS WFS `public:firewx_stns_current` (`fwi`, `isi`, `bui`, `dc`,
  `ffmc`, `dmc`, `temp`, `rh`, `ws`, `precip`), plus `public:firewx_stns` for history.
- Daily climate history: ECCC OGC API `https://api.weather.gc.ca/collections/climate-daily/items?PROVINCE_CODE=SK`
  (verified 200).
- Fire danger rating polygons: `public:fdr_current_shp`.

**Wow extras.** "Weather explains fire": scatter-animate FWI against next-day ignitions for a
season, with the narrator explaining the link.

---

## 7. Burn-Scar Time Machine (satellite before/after)

**What you see.** On a big fire's card, choose **Before / After**. A swipe slider reveals
Sentinel-2 imagery from before the fire and after it, with a computed **burn severity** layer
(dNBR) glowing from yellow to deep red. A "years later" toggle shows green regrowth returning.

**Data.** Sentinel-2 L2A through the public Element84 Earth Search STAC
(`https://earth-search.aws.element84.com/v1`, verified, no key), as Cloud-Optimized GeoTIFFs.
dNBR = NBR_pre − NBR_post, from bands B8A and B12, computed in the browser with a WebGL shader
(for example `geotiff.js`) or pre-rendered by a load script into `data/scenes/` (gitignored).

**Effort:** medium–large. **Wow:** the single most "satellite-agency-grade" feature.

---

## 8. Fire Returns (reburn and forest memory)

**What you see.** Land that burned more than once glows by count: once is faint amber,
three or more times is white-hot. Click a patch to see its timeline ("1989, 2006, 2025: 36
years of fire memory") and the shortest return interval.

**Data.** NBAC polygons (1972 onward), overlaid in the loader (polygon intersection in JS with
`turf` at load time, or rasterized to a 500 m grid stored in SQLite). This tells a real
ecological story about how often fire comes back in the boreal forest.

---

## 9. People in Reach

**What you see.** As a season replays, a counter and a glowing population chart track
**how many people lived within 20 km of an active fire** each day. Community dots swell when
threatened. It's the human side of the record.

**Data.** StatCan 2021 Census population by place (public), SPSA community points (live),
CNFDB / NBAC history. **Be honest:** proximity, not evacuation. Real evacuation records
aren't published as open data, so the label must say so.

---

## 10. Hear the Season (sonification)

**What you see and hear.** Every ignition plays a note: lightning a bright chime, human-caused
a soft wooden tone; bigger fires go lower and louder; latitude sets stereo position. A
quiet season sounds sparse, and 2015 or 2025 sound like a storm. A toggle plays it alongside Replay.

**Data.** What's already loaded. Web Audio only, with no new sources.

**Effort:** small. **Wow:** surprisingly emotional in demos.

---

## 11. Ask Emberline (voice questions, spoken answers)

**What you see.** Click the mic: *"Which year had the most lightning fires near Stony Rapids?"*
The map flies there, filters itself, highlights the answer, and Kokoro says it out loud.

**How.** Speech-to-text from the browser's Web Speech API (with typed text as a fallback). A
question becomes a constrained query plan (an LLM such as Claude given a fixed set of allowed
filters, *not* free SQL) that runs against SQLite. The answer text is built from the result
and spoken by the local Kokoro worker (`/api/tts`, see idea 2). IRISIdeas has a similar
"Ask the Province" plan at `docs/plans/stage-3-ask-the-province.md`.

**Honesty.** Numbers always come from the query, never from the model's memory, and each
answer shows "how this was calculated."

---

## 12. Living Terrain and Sky

**What you see.** The flat basemap becomes **3D terrain** (Canadian Shield ridges, river
valleys) with a sun that moves through each replayed day. Night falls and the active fires
glow brighter in the dark. Smoke columns rise as particle plumes above the largest fires.

**Data.** Public Terrarium elevation tiles
(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, verified) as
MapLibre `raster-dem` terrain and hillshade. Sun position is computed from date and latitude.

**Effort:** small for terrain (a few lines of MapLibre), medium for day/night lighting and plumes.

---

## 13. Wind-Driven Fire (animated flow fields)

**What you see.** Thousands of faint particles stream across the province following the real
wind for the replayed day, and you can watch fires run with it.

**Data.** ECCC MSC GeoMet wind layers (WMS) for current and forecast conditions. For
historical days, ECCC climate-daily wind (`api.weather.gc.ca`) interpolated between
stations, or MSC Datamart GRIB2 model fields (public, heavier to process). Particle advection
runs in a WebGL layer.

**Effort:** medium–large.

---

## 14. This Day in Fire History

**What you see.** The app opens on today's date across every year: *"On November 3rd, 1981 to
2025: …"* Out of season it switches to *"In fire season, on this day…"*, with a 20-second
narrated clip, ready-made social posts and a share card.

**Data.** What's already loaded, plus Kokoro clips from idea 2.

---

## 15. Season Scorecards and Comparisons

**What you see.** Two seasons side by side, for example 2015 against 2025, on synced split
maps replaying together, with racing counters and growth curves. Also a **decade view**:
ten small-multiple maps that animate in sequence, so the shift in where and how much burns is
obvious at a glance.

**Data.** What's already loaded.

---

## 16. Climate Stripes Behind the Timeline

**What you see.** Behind the season timeline, a band of **warming stripes**, one coloured
bar per year from blue to red, built from Saskatchewan temperature records. The fire bars stand
in front of it, and the narrator lets the pattern speak for itself without overclaiming
cause and effect.

**Data.** ECCC adjusted and homogenized climate data (AHCCD) or climate-daily
(`api.weather.gc.ca`), averaged per season.

---

## Suggested build order

1. **Narration plumbing (idea 2, core)**: a voice script, cached clips, a cue timeline, captions.
   Every later idea can be narrated.
2. **True Spread Replay (1)**: the most impressive accuracy upgrade.
3. **Lightning Storms (4)** and **Hear the Season (10)**: quick, high-impact polish.
4. **Your Community's Fire Story (3)**: the shareable hook.
5. **Terrain (12)** and **Smoke (5)**: atmosphere.
6. **Burn-Scar Time Machine (7)** and **Ask Emberline (11)**: the deep, "how did you build this" features.
7. **Video export (2, extra)**: turn the narrated tour into a film for SPSA.

## Data source checklist (verified 2026-11-03)

| Source | Endpoint | Used by |
|---|---|---|
| CNFDB points (NRCan) | `cwfis.cfs.nrcan.gc.ca/downloads/nfdb/fire_pnt/current_version/` and WFS `public:NFDB_point` | already loaded |
| NBAC perimeters (NRCan) | WFS `public:nbac`; downloads `cwfis.cfs.nrcan.gc.ca/downloads/nbac/` | 1, 8, 9 |
| Satellite hotspots, historical and 24 h | WFS `public:hotspots`, `public:hotspots_last24hrs` | 1, live |
| M3 perimeters | WFS `public:m3polygons`, `public:m3_polygons_current` | 1, live |
| Fire-weather stations / danger rating | WFS `public:firewx_stns(_current)`, `public:fdr_current_shp` | 6 |
| ECCC GeoMet WMS | `geo.weather.gc.ca/geomet`: `Lightning`, `Lightning_2.5km_Density`, `RAQDPS.*WildfireSmokePlume`, `AQHI-OBS`, GOES smoke | 4, 5, 13 |
| ECCC climate API | `api.weather.gc.ca/collections/climate-daily` | 6, 13, 16 |
| SPSA ArcGIS | `gis.saskatchewan.ca/arcgis/rest/services/SPSA/*` | already used; 3, 9 |
| Sentinel-2 L2A | `earth-search.aws.element84.com/v1` (STAC, no key) | 7 |
| Terrain | `s3.amazonaws.com/elevation-tiles-prod/terrarium/` | 12 |
| StatCan 2021 Census | statcan.gc.ca census profile downloads | 3, 9 |
| Kokoro TTS (local) | `C:\DevSource\IRISIdeas\.venv\kokoro\` + that venv's Python | 2, 3, 11, 14 |
