# 5. Data: sources and what each one may claim

The README lists endpoints and how to load each source. This file records **why** each source
is used and **how true** each thing on screen is.

## Sources and why

| Source | Used for | Why this one |
|---|---|---|
| **CNFDB** point data, `SRC_AGENCY = 'SK'` (NRCan) | The historical record: every mode | The most complete public record of SK fires (from 1959, continuous from 1981), reported by SPSA and its predecessors. The SPSA CSV named in the original brief could not be found. |
| **SPSA historical CSV** (optional) | Alternative historical source | The original brief's source. `load-csv.mjs` accepts it if it turns up. |
| **NBAC** perimeters (NRCan) | Spread mode | The authoritative mapped burned area for each large fire. |
| **CWFIS hotspots** (MODIS, VIIRS) | Spread mode, Live mode | Real satellite detections with time, FRP and wind; they turn a final perimeter into observed growth. |
| **SPSA ArcGIS server** | Live incidents, communities | SPSA's own published layers. Auto-discovery picks up seasonal layers without code changes. |
| **ECCC GeoMet CLDN lightning** | Live lightning | Public, CORS-enabled, 10-minute frames. |
| **CARTO Dark Matter basemap** (OpenStreetMap data) | Base map | Dark, quiet tiles that let fire glow; public, no key. |
| **Terrarium elevation tiles** (AWS Open Data) | 3D terrain, hillshade | Public, no key. |
| **Sun position** (computed) | Lighting | No data needed. |
| **Mock data** (generated) | Offline fallback | Lets the app run without a network. Always labelled. |

Every source above, plus the scene, voice, sound and code, is catalogued in `src/provenance.js`
and shown in the Sources view. **A new source means a new catalogue entry** (with its truth level),
or the app stops telling the whole truth about where it comes from.

## Truth levels

Everything on screen falls into one of these, and the UI must not blur them.

| Level | Examples | How it is shown |
|---|---|---|
| **Recorded** | Ignition date, location, final size, cause; NBAC perimeters; hotspot detections; SPSA communities; CLDN lightning | Shown as fact, with source credits |
| **Derived** | Story figures, season totals, storm groupings (1 day / 60 km), nearest community, merges | Computed from recorded data each time; never hard-coded |
| **Interpolated** | The Spread front between detections | Named as interpolated in the panel, story and About |
| **Illustrative** | Replay growth animation; equal-area burn circles; strike hour; storm-cell shape | Named as illustrative / equal area in the UI |
| **Simulated** | Live fallback; mock dataset | SIMULATED badge or notice, always |
| **Synthetic voice** | Kokoro or browser narration | Named on the title card and control bar |

## Data handling rules

- Loaders record every rejected row and the reason in `import_runs`.
- `REP_DATE` is preferred over `YEAR`/`MONTH`/`DAY` when they disagree.
- Prescribed burns and assistance requests are dropped; they are not wildfires in SK.
- Large NBAC perimeters are simplified on load; the area total stays NBAC's.
- Government endpoints change. Facts about them are dated in [CLAUDE.md](../../CLAUDE.md) and
  [08-backlog.md](08-backlog.md); re-check before relying on them.
