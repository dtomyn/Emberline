// film/scenes.js: the explainer's scenes, in order (see film/storyboard.md).
//
// Every figure is computed here from the record the app has loaded, so a data refresh changes the
// narration and the voice is remade for the lines that changed. Each scene has a title and what it
// shows (for the storyboard and YouTube chapters), its spoken `lines`, and `run`, a generator that
// drives the real interface through the toolkit `f` from film/director.js.
import { summarize, byYear, fmtHa, fmtInt, seasonT, SEASON_START_DOY, displayName } from '/src/data.js';
import { sayHa, sayCount, sayDate } from '/src/narration.js';

const SASKATOON_HA = 22_800; // as in main.js
const pct = (a, b) => Math.round((a / (b || 1)) * 100);
const named = (f) => { const n = displayName(f); return n && n !== f.fire_id ? n : null; };

export function buildScenes(f, { url = '' } = {}) {
  const { state, app, spread, map } = f.E;
  // ---- figures, the same way src/story.js finds them
  const years = [...new Set(state.all.map((x) => x.year))].sort((a, b) => a - b);
  const firstFull = byYear(state.all, years).find((y) => y.count >= 100)?.year ?? years[0];
  const lastYear = years[years.length - 1];
  const core = state.all.filter((x) => x.year >= firstFull);
  const all = summarize(core);
  const yearly = byYear(core, years.filter((y) => y >= firstFull));
  const top = [...yearly].sort((a, b) => b.ha - a.ha)[0];
  const topFires = core.filter((x) => x.year === top.year);
  const largest = summarize(topFires).largest;
  const times = top.ha / (all.ha / yearly.length);
  const [L] = all.byCause;
  const sorted = [...core].sort((a, b) => b.size_ha - a.size_ha);
  const onePct = sorted.slice(0, Math.max(1, Math.round(sorted.length / 100)));
  const onePctHa = onePct.reduce((s, x) => s + x.size_ha, 0);
  const storm = state.storms.find((s) => s.fires[0].year >= firstFull) ?? null;
  const stormDays = storm ? Math.round(storm.t1 - storm.t0) + 1 : 0;
  const sp = spread.forCnfdb(largest.fire_id)
    ?? [...state.spreadList].filter((x) => x.year === top.year).sort((a, b) => b.area_ha - a.area_ha)[0]
    ?? [...state.spreadList].sort((a, b) => b.area_ha - a.area_ha)[0];
  const spFull = sp && state.spreadList.find((x) => x.id === sp.id);
  const spDays = spFull ? Math.round((Date.parse(spFull.hs_edate) - Date.parse(spFull.hs_sdate)) / 864e5) + 1 : 0;
  const largestName = named(largest);
  const saskatoons = largest.size_ha / SASKATOON_HA;
  const live = state.live;
  const liveCount = live.incidents.filter((i) => i.status !== 'Out').length;

  const trackX = (t) => {
    const r = document.querySelector('#track').getBoundingClientRect();
    const d = new Date(Date.UTC(2006, 0, 1) + Math.floor(t) * 864e5);
    const y = d.getUTCFullYear();
    const doy = Math.floor((d - Date.UTC(y, 0, 1)) / 864e5) + 1;
    return [r.left + state.axis.toX(y, doy) * r.width, r.top + r.height / 2];
  };
  const sliderX = (sel, v) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const k = (v - Number(el.min)) / (Number(el.max) - Number(el.min));
    return [r.left + 8 + k * (r.width - 16), r.top + r.height / 2];
  };

  const scenes = [
    {
      id: 'open', title: 'Every fire on record', shows: 'The intro: embers rising behind the Emberline title.',
      lines: { a: `Since ${firstFull}, Saskatchewan has recorded ${sayCount(all.count)} wildfires. This is every one of them.` },
      *run(f) {
        f.music(0.55, 4);
        document.querySelector('#film .f-black').style.opacity = '1';
        f.spawn(f.fade(0, 2.2));
        f.spawn(f.zoom([f.W / 2, f.H * 0.44], { z: 1.14, dur: 9, whoosh: false }));
        yield 0.8;
        f.sfx('boom');
        f.say('a');
        yield* f.voice(0.6);
      },
    },
    {
      id: 'enter', title: 'Into the atlas', shows: 'Enter the atlas: the camera dives onto the province.',
      lines: { a: 'Emberline is an atlas of that record. Every fire, every season, rebuilt from public data and replayed as it happened.' },
      *run(f) {
        f.zoomOut({ dur: 1.6 });
        f.place([f.W * 0.78, f.H * 0.9]);
        f.say('a');
        yield 0.3;
        yield* f.clickOn('#enter', { dur: 1.4 });
        f.sfx('whoosh', { dur: 3.4, dir: 1, big: true });
        f.music(0.7, 3);
        yield* f.move([f.W * 0.6, f.H * 0.62], { dur: 1.2 });
        yield* f.voice(0.4);
        yield* f.waitFor(() => !map.isMoving(), 4);
      },
    },
    {
      id: 'replay', title: `Replay: the ${top.year} season`, shows: `${top.year}, the worst season in the record, replayed day by day.`,
      lines: {
        a: 'Pick any season, and it replays day by day. Each fire flares on the date it was reported, glows while it burns, and cools to a scar.',
        b: `${top.year} was the worst season in the record. ${sayCount(top.count)} fires burned ${sayHa(top.ha)} hectares, ${times.toFixed(1)} times an average year.`,
      },
      *run(f) {
        f.chip('01', 'Replay', 'Every fire, on the day it was reported');
        // The season bars on the right jump straight to a year and play it
        yield* f.move(`#yearbars .ybar[title^="${top.year}:"]`, { dur: 1.1 });
        f.zoomTo('#yearbars', { z: 1.6, dur: 1.0 });
        yield 1.2;
        app.play(7); // the bar plays its season at the current speed: start at 1×, speed up below
        yield* f.click();
        f.say('a');
        f.fire(0.5);
        yield 0.5;
        f.zoomTo([400, 330], { z: 1.35, dur: 1.4 });
        yield* f.move([520, 380], { dur: 1.2 });
        yield* f.voice(0.2);
        f.zoomTo([1400, 160], { z: 1.5, dur: 1.4 });
        f.say('b');
        f.fire(0.8);
        yield* f.word('fires');
        yield* f.clickOn('#speed [data-speed="21"]', { dur: 1.3 });
        f.zoomOut({ dur: 1.4 });
        yield* f.voice(0.3);
        yield* f.waitFor(() => state.t >= largest.t + 12, 20);
        if (state.playing) yield* f.clickOn('#play', { dur: 1 });
        f.fire(0.4);
      },
    },
    {
      id: 'fire', title: largestName ? `The ${largestName}` : 'A single fire', shows: `The season's largest fire, ${displayName(largest)}, opens its detail card.`,
      lines: {
        a: `Every fire can be opened. The largest that year${largestName ? `, the ${largestName},` : ''} burned ${sayHa(largest.size_ha)} hectares, about ${Math.round(saskatoons)} times the area of Saskatoon.`,
      },
      *run(f) {
        yield* f.clickOn('#largest button', { dur: 1.2 });
        f.say('a');
        yield 0.4;
        f.zoomTo('#card', { z: 1.55, dur: 1.4 });
        yield* f.move('#card .compare', { dur: 1.2 });
        yield* f.voice(0.5);
      },
    },
    {
      id: 'spread', title: 'True spread replay', shows: 'NBAC perimeter and satellite detections rebuild how the fire grew.',
      lines: {
        a: `For the biggest fires, Emberline goes further. Satellites detected this one ${sayCount(spFull?.hotspot_count ?? 0)} times over ${spDays} days.`,
        b: 'From those detections it rebuilds how the fire grew, with the front interpolated between real sightings, and the final scar mapped from the burned area.',
      },
      *run(f) {
        if (document.querySelector('#card-spread')) yield* f.clickOn('#card-spread', { dur: 1 });
        else { yield* f.clickOn('[data-mode="spread"]', { dur: 1.2 }); app.spread(sp.id); }
        f.zoomOut({ dur: 1.2 });
        f.chip('02', 'True spread', 'Satellite detections, rebuilt into a growing fire');
        yield* f.until(() => spread.state.fire?.id === sp.id);
        f.say('a');
        yield 1; // the spread timeline slides in
        f.fire(0.9, 3);
        yield* f.move('#spread-speed [data-speed="8"]', { dur: 1.4 });
        yield* f.waitFor(() => spread.state.playing, 5);
        yield 0.6;
        yield* f.click();
        yield* f.move([f.W * 0.62, f.H * 0.6], { dur: 1.4 });
        yield* f.voice(0.3);
        f.zoomTo('#spread-chart', { z: 1.45, dur: 1.4 });
        f.say('b');
        yield* f.voice(0.4);
        f.zoomOut({ dur: 1.4 });
        yield* f.waitFor(() => !spread.state.playing, 14);
        yield 1.5;
        f.fire(0.3);
      },
    },
    {
      id: 'lightning', title: 'Struck by lightning', shows: storm ? `The record's biggest lightning outbreak, ${storm.fires[0].ignition_date}.` : 'Lightning-caused fires.',
      lines: {
        a: `Lightning starts ${pct(L.count, all.count)} percent of Saskatchewan's fires, yet those fires burn ${pct(L.ha, all.ha)} percent of the area.` +
          (storm ? (stormDays > 1
            ? ` Over ${stormDays} days from ${sayDate(storm.fires[0].ignition_date)}, one outbreak sparked ${fmtInt(storm.count)} of them.`
            : ` On ${sayDate(storm.fires[0].ignition_date)}, a single storm sparked ${fmtInt(storm.count)} of them.`) : ''),
      },
      *run(f) {
        yield* f.clickOn('[data-mode="timeline"]', { dur: 1.3 });
        f.chip('03', 'Lightning storms', 'Bolts where lightning started a fire');
        f.say('a');
        yield 0.8; // the replay timeline slides back in
        if (storm) {
          // Scrub the timeline to the outbreak (the playhead lands to the pixel; the exact day is set on release)
          f.zoomTo('#track', { z: 1.5, dur: 1.2, ax: 0.5 });
          yield* f.drag(() => trackX(state.t), () => trackX(storm.t0 - 2), { dur: 1.6 });
          app.jump(storm.t0 - 1.5);
          f.zoomOut({ dur: 1.4 });
          app.fly({ center: storm.center, zoom: 6.1, pitch: 50, bearing: -15 });
          f.sfx('whoosh', { dur: 3, dir: 1, big: true });
          yield* f.move('#speed [data-speed="7"]', { dur: 1.2 });
          yield* f.click();
          yield* f.waitFor(() => !map.isMoving(), 4);
          yield* f.clickOn('#play', { dur: 0.8 });
          f.fire(0.6);
          yield* f.move([f.W * 0.6, f.H * 0.35], { dur: 1.6 });
          yield* f.waitFor(() => state.t >= storm.t1 + 3, 12);
        }
        yield* f.voice(0.5);
        if (state.playing) yield* f.clickOn('#play', { dur: 0.8 });
        f.fire(0.2);
      },
    },
    {
      id: 'explore', title: `${yearly.length} seasons in 3D`, shows: 'Explore: the whole record as a heat map, then 3D hexagon columns that rise and orbit.',
      lines: {
        a: `Explore folds ${yearly.length} seasons into one map. As heat, or as columns, one for every twelve kilometres, their height the area burned.`,
        b: `The largest one percent of fires, just ${fmtInt(onePct.length)} of them, burned ${pct(onePctHa, all.ha)} percent of it all.`,
      },
      *run(f) {
        app.set({ viz: 'heat' }); // the tab opens on the heat map; the columns come next
        yield* f.clickOn('[data-mode="explore"]', { dur: 1.2 });
        app.fly({ center: [-105.6, 54.9], zoom: 4.9, pitch: 0, bearing: 0 });
        f.chip('04', 'Explore', 'The whole record at once');
        f.say('a');
        yield* f.move('#explore-viz [data-viz="heat"]', { dur: 1 });
        yield* f.word('columns');
        yield* f.clickOn('#explore-viz [data-viz="hex"]', { dur: 0.6 });
        f.sfx('whoosh', { dur: 1.5, dir: 1 });
        yield 1.6;
        const big = sorted[0];
        yield* f.move({ lngLat: big.position }, { dur: 1.4 });
        yield* f.voice(0.2);
        f.say('b');
        yield* f.clickOn('#orbit', { dur: 1.2 });
        f.zoomTo([f.W * 0.5, f.H * 0.5], { z: 1.22, dur: 2.5 });
        yield* f.move([f.W * 0.7, f.H * 0.82], { dur: 1.4 });
        yield* f.voice(1.5);
        f.zoomOut({ dur: 1.4 });
      },
    },
    {
      id: 'live', title: 'Live', shows: 'Live mode: SPSA communities, incidents and the alert radius.',
      lines: {
        a: "Live mode reads the Saskatchewan Public Safety Agency's own map services and the national satellite feeds, and links every community inside the alert radius.",
        b: live.simulated
          ? 'Off-season, when nothing is published, it says so, and labels its simulation.'
          : `Right now it is tracking ${sayCount(liveCount)} active fires and hotspots.`,
      },
      *run(f) {
        yield* f.clickOn('[data-mode="live"]', { dur: 1.3 });
        app.fly({ center: [-105.6, 55.0], zoom: 5.0, pitch: 30, bearing: 0 });
        f.chip('05', 'Live', 'SPSA services and national feeds, now');
        f.say('a');
        yield* f.waitFor(() => !map.isMoving(), 4);
        f.zoomTo('#alert-radius', { z: 1.35, dur: 1.3, ax: 0.9 });
        yield* f.drag(() => sliderX('#alert-radius', Number(document.querySelector('#alert-radius').value)), () => sliderX('#alert-radius', 130), { dur: 2.2 });
        f.zoomOut({ dur: 1.4 });
        yield* f.move([f.W * 0.55, f.H * 0.5], { dur: 1.4 });
        yield* f.voice(0.2);
        if (live.simulated) f.zoomTo('#live-source', { z: 1.5, dur: 1.2 });
        f.say('b');
        yield* f.voice(0.8);
        f.zoomOut({ dur: 1.2 });
      },
    },
    {
      id: 'sources', title: 'Read the rings', shows: 'Every source behind the app as a fire-scarred tree cross-section.',
      lines: {
        a: 'And every number traces back to where it came from. Read the rings: each ring is a year of the record, the scars are its great fire seasons, and every source is one click away, with its exact request and licence.',
      },
      *run(f) {
        yield* f.clickOn('#sources-btn', { dur: 1.3 });
        f.say('a');
        yield* f.until(() => document.querySelector('#src-list button[data-id="nbac"]'));
        yield* f.move([f.W * 0.36, f.H * 0.5], { dur: 1.6 });
        yield* f.word('scars');
        yield* f.clickOn('#src-list button[data-id="nbac"]', { dur: 1.2 });
        f.zoomTo('#src-card', { z: 1.45, dur: 1.4 });
        yield* f.voice(1.2);
        f.zoomOut({ dur: 1.2 });
      },
    },
    {
      id: 'end', title: 'Emberline', shows: 'End card.',
      lines: { a: 'Emberline. Every fire, from the record.' },
      *run(f) {
        f.showCursor(false);
        f.endCard({
          line: `${fmtInt(all.count)} fires · ${fmtHa(all.ha)} ha · ${firstFull}–${lastYear}`,
          sources: 'CNFDB · NBAC · CWFIS · SPSA GIS · ECCC GeoMet',
          url,
        });
        f.music(0.45, 2);
        yield 1.2;
        f.sfx('boom');
        f.say('a');
        yield* f.voice(3);
        f.music(0, 3);
        yield* f.fade(1, 2.5);
        yield 0.5;
      },
    },
  ];
  scenes.facts = {
    fires: all.count, hectares: Math.round(all.ha), firstYear: firstFull, lastYear, seasons: yearly.length,
    topYear: top.year, topHa: Math.round(top.ha), largest: displayName(largest), spread: sp?.id ?? null, liveSimulated: !!live.simulated,
  };
  return scenes;
}
