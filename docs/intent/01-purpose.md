# 1. Purpose

## What Emberline is

An animated, interactive atlas of every recorded wildfire in Saskatchewan. It replays fire
seasons day by day, explores more than 45 years of history in 3D, shows the current season
from live government and satellite services, and tells the province's fire history as a
narrated film.

## Who it is for

Emberline is a personal GitHub portfolio project by the repo owner. Its audience is the
**general public**: residents of Saskatchewan, people in and near the north who live with fire
seasons, students, journalists and anyone curious about the province's wildfire history. They
need no GIS or fire-science background. A second audience is any reviewer who clones the repo
to judge the work.

It is **not** built for the Saskatchewan Public Safety Agency (SPSA). SPSA has its own internal
systems; here it is a source of data (through the CNFDB and its public GIS layers), not the user.

## What it must do for them

- **Make them stop and watch.** In the first seconds, fires should ignite, glow, spread and
  cool to scars on a 3D, sun-lit province. Without that, the page is skimmed and closed.
- **Explain without jargon.** Size classes, hotspots, perimeters and causes are put in plain
  words and familiar comparisons. A viewer should understand what they see without a manual.
- **Hold up when they look closely.** Some viewers know the data well (a fire near their town,
  a season they lived through, a journalist checking a figure). Every number, date, place and
  label has to survive that scrutiny. A single invented figure would undo the visuals.
- **Feel local.** Their own geography, communities, big seasons and named fires, from the
  public record (CNFDB records reported by SPSA, SPSA community layers, NRCan satellite data).
- **Be something they would share.** A story that plays on its own (▶ Watch), a fire they can
  click and replay, a search they can link to, a live view of this season, all from one link.
- **Be easy to run.** A reviewer clones the repo, runs two commands, and sees the real thing.

## What success looks like

1. A viewer opens the app, watches the film, and comes away knowing something true about
   Saskatchewan's fire history that they did not know before.
2. Someone looks up a fire they remember near their community, clicks it, and the details
   match the public record.
3. In fire season, Live mode shows real incidents and hotspots without any code change.
4. A reviewer clones the repo on a clean machine and has it running in minutes, with no
   data committed and no dependencies to install.

## What Emberline is not

- **Not an operational tool, and not for the agency.** It is not a substitute for SPSA's
  official incident maps, evacuation orders or warnings, and it does not claim to be. It is
  also not a tool for SPSA staff, who have their own systems.
- **Not a mock-up.** Every mode works on real data through real services. A static picture
  or a scripted demo would miss the point.
- **Not a fire model.** It shows recorded fires and observed detections. Where it fills gaps
  (the spread front between detections, the hour of a lightning strike), it says so.
