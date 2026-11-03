# 1. Purpose

## What Emberline is

An animated, interactive atlas of every recorded wildfire in Saskatchewan. It replays fire
seasons day by day, explores more than 45 years of history in 3D, shows the current season
from live government and satellite services, and tells the province's fire history as a
narrated film.

## Who it is for

Emberline is a personal GitHub portfolio project by the repo owner. Its audience is the
**Saskatchewan Public Safety Agency (SPSA)**: the people who fight, plan for and communicate
about wildfire in the province. A second audience is any reviewer who clones the repo to
judge the work.

## What it must do for them

- **Make them stop and watch.** In the first seconds, fires should ignite, glow, spread and
  cool to scars on a 3D, sun-lit province. Without that, a portfolio piece is skimmed and closed.
- **Hold up when they look closely.** SPSA staff know their own data. Every number, date,
  place and label has to survive an expert's scrutiny. A single invented figure would undo
  the visuals.
- **Speak their language.** Their own data (CNFDB records reported by SPSA, SPSA GIS layers,
  SPSA communities), their own geography, their own big seasons and named fires.
- **Be something they would show other people.** A story that can be played in a meeting
  (▶ Watch), a fire they can click and replay, a live view of this season, all from one link.
- **Be easy to run.** A reviewer clones the repo, runs two commands, and sees the real thing.

## What success looks like

1. A viewer opens the app, watches the film, and comes away knowing something true about
   Saskatchewan's fire history that they did not know before.
2. An SPSA analyst picks a fire they remember, clicks it, and the details match their records.
3. In fire season, Live mode shows real incidents and hotspots without any code change.
4. A reviewer clones the repo on a clean machine and has it running in minutes, with no
   data committed and no dependencies to install.

## What Emberline is not

- **Not an operational tool.** It is not a substitute for SPSA's official incident maps or
  warnings, and it does not claim to be.
- **Not a mock-up.** Every mode works on real data through real services. A static picture
  or a scripted demo would miss the point.
- **Not a fire model.** It shows recorded fires and observed detections. Where it fills gaps
  (the spread front between detections, the hour of a lightning strike), it says so.
