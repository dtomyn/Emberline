# 8. Backlog: what could come next

Ideas not yet built, each meeting the same bar as the built modes: striking *and* real, public
data loaded by a script into `data/wildfire.db`, and anything simulated or illustrative labelled.
Data sources were checked on **2026-11-03**; re-check an endpoint before building on it.

This replaces the original `docs/IDEAS.md` (removed 2026-11-05). Its built ideas are now
described where they live: [04-modes.md](04-modes.md) for intent, [06-decisions.md](06-decisions.md)
for the reasoning, and CLAUDE.md for the verified service notes. The removed file is in git
history (`git show 83ccab0:docs/IDEAS.md`) for the original long-form pitches.

## Unfinished parts of built features

- **Living Terrain and Sky:** smoke columns as particle plumes above the largest fires.
- **Emberline Presents:** an on-demand narrator (`/api/tts` backed by a persistent local Kokoro
  worker) so a fire's detail card can say "Tell me about this fire"; a fire bed that follows the
  replayed day rather than the chapter. (Video export is done: `npm run film`.)
- **Live:** playback of the `live_snapshots` archive the app already records.
- **Shareable state:** URL state for modes other than Search and Sources.

## New ideas, in suggested order

### 1. Your Community's Fire Story (next in line)
Type a town; it becomes the centre of a **tree-ring chronology** (a ring per year, each fire within
100 km a notch at its bearing, sized by area), with a narrated, data-built summary and a
poster-quality PNG/SVG export. *Data:* SPSA communities (already used), CNFDB/NBAC from SQLite,
StatCan 2021 Census population for "people within X km". *Effort:* small–medium. A shareable hook
for every community. Reuse the ring drawing from `src/sources-view.js`.

### 2. Where the Smoke Went
A churning smoke veil drifting south over communities coloured by air quality, with a 48-hour
forecast slider. *Data (GeoMet WMS):* `RAQDPS.Sfc_PM2.5-WildfireSmokePlume` (FireWork forecast),
`AQHI-OBS`, `GOES-East_1km_SmokeABIband1-SWIR`. Time-stepped raster sources with cross-fades, the
same pattern as live lightning.

### 3. Fire Weather Pulse
Stations that breathe with the Fire Weather Index, and a Drought Code ribbon under the timeline.
*Data:* CWFIS WFS `public:firewx_stns_current` / `public:firewx_stns`, `public:fdr_current_shp`;
ECCC `api.weather.gc.ca/collections/climate-daily?PROVINCE_CODE=SK`. Show the FWI–ignition link
without claiming cause.

### 4. Season and decade comparisons
Two seasons on synced split maps replaying together with racing counters, and a decade view of
small multiples. *Data:* already loaded.

### 5. Burn-Scar Time Machine
A before/after swipe of Sentinel-2 imagery on a big fire's card, with dNBR burn severity and a
"years later" regrowth view. *Data:* Element84 Earth Search STAC (`earth-search.aws.element84.com/v1`,
no key), bands B8A/B12. Pre-render into gitignored `data/scenes/` or compute in a shader; a
browser GeoTIFF library would need the owner's OK (no-dependency rule). *Effort:* medium–large.

### 6. Fire Returns (reburn)
Land that burned more than once glows by count, with each patch's fire timeline and shortest
return interval. *Data:* NBAC perimeters 1972 onward, overlaid at load time (rasterized to a grid
in SQLite, since there is no geometry library).

### 7. People in Reach
A daily count of people living within 20 km of an active fire during a replayed season. *Data:*
StatCan 2021 Census, SPSA communities, CNFDB/NBAC. **Proximity, not evacuation:** evacuation
records aren't open data, and the label must say so.

### 8. Ask Emberline
Spoken or typed questions turned into a constrained query plan over `src/search.js` (never free
SQL), answered on the map and aloud. Numbers come only from the query, with "how this was
calculated" shown. Search's plain-language parser already covers much of the grammar.

### 9. This Day in Fire History
Open on today's date across every year, with a short narrated clip and a share card. *Data:*
already loaded.

### 10. Wind-driven flow fields and climate stripes
Particles following the replayed day's wind (GeoMet wind layers; ECCC climate-daily or MSC
Datamart GRIB2 for history), and warming stripes behind the timeline from AHCCD or climate-daily.
Both medium–large; the stripes must not overclaim cause and effect.

## Unbuilt data sources (verified 2026-11-03)

| Source | Endpoint | For |
|---|---|---|
| CWFIS fire weather | WFS `public:firewx_stns(_current)`, `public:fdr_current_shp` | 3 |
| ECCC GeoMet WMS | `geo.weather.gc.ca/geomet`: `RAQDPS.*WildfireSmokePlume`, `AQHI-OBS`, GOES smoke, wind | 2, 10 |
| ECCC climate API | `api.weather.gc.ca/collections/climate-daily` | 3, 10 |
| Sentinel-2 L2A | `earth-search.aws.element84.com/v1` (STAC, no key) | 5 |
| StatCan 2021 Census | statcan.gc.ca census profile downloads | 1, 7 |

Each new source needs a loader, a `src/config.js` endpoint and a `src/provenance.js` entry.
