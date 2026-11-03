# 2. Guiding principles

## Two goals, equal weight

1. **Visual "wow".** Animated, cinematic, polished. Fires ignite, glow, spread and cool to
   scars; 3D hex columns rise; terrain is lit by the real sun; the camera flies through a story.
   Visual quality is a first-class requirement, not decoration added at the end.
2. **Fully functional.** Real data, real services, working filters, scrubbing, detail cards
   and a live mode. Never a mock-up or a static picture.

When the two pull against each other, **keep both**. Don't simplify the visuals to save
effort, and don't fake functionality to get a better shot. If something can't be both real
and striking yet, it waits until it can.

## Honesty in the UI

The visuals are only impressive if they are true. These rules apply everywhere:

- **Simulated is labelled SIMULATED.** The live-mode fallback and the mock dataset carry a
  visible badge. The film shows a "SIMULATED DATA" notice when it is built from mock data.
- **Burn circles show equal area, not perimeters.** Each circle has the same area as the
  reported fire size. The detail card and About dialog say so.
- **Interpolation is named.** In Spread mode the front is interpolated between real satellite
  detections inside a real perimeter. The panel, story and About dialog keep that wording.
- **Illustrative details are named.** A lightning strike's hour within its day and a storm
  cell's shape are illustrative; the place and date are recorded. The UI says which is which.
- **Story figures are computed, never hard-coded.** Every number in the guided story and the
  film comes from the loaded dataset, so the story stays true whichever source is selected
  and whenever new data is loaded.
- **Synthetic voices say they are synthetic.** The film's title card and control bar name the
  voice that is speaking (Kokoro or the browser's) and say it is synthetic.
- **Sound is honest too.** The louder pops in the film's fire bed are the chapter's largest real
  fires; the About dialog says so. Ignition notes in Hear the Season are real ignitions.
- **Sources are credited.** Basemap, fire data and live services are attributed in the app and
  the README.

## Respect the viewer

- **The map is always the real app.** Pausing the film leaves the viewer in a live, explorable
  view, not a frozen frame.
- **Every mode is reachable by keyboard** (`Space`, arrows, `1`–`5`, `W`, `M`, `Esc`).
- **Sound never starts on its own.** Audio begins only from a click (browser autoplay rules,
  and courtesy), and the film's fire bed stays subtle and mutable.
- **Fail soft.** One failed service or one exception must not freeze the app. Live data falls
  through tiers; the animation loop schedules its next frame before doing work.
