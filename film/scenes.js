// film/scenes.js: the explainer's scenes, in order (see film/storyboard.md).
//
// Every figure is computed here from the record the app has loaded, so a data refresh changes the
// narration and the voice is remade for the lines that changed. Each scene has a title and what it
// shows (for the storyboard and YouTube chapters), its spoken `lines`, and `run`, a generator that
// drives the real interface through the toolkit `f` from film/director.js.
import { summarize, byYear, fmtHa, fmtInt, displayName } from '/src/data.js';
import { sayHa, sayCount, sayDate } from '/src/narration.js';
import { search, parseText, emptyQuery, mergeQuery } from '/src/search.js';
import { SOURCES } from '/src/provenance.js';

const SASKATOON_HA = 22_800;      // as in main.js
const PROVINCE_HA = 65_103_600;   // Saskatchewan's total area, 651,036 km² (Statistics Canada)
const QUERY = 'lightning over 10,000 ha';
const QUERY_SAID = 'lightning over ten thousand hectares';
const pct = (a, b) => Math.round((a / (b || 1)) * 100);
const pct1 = (a, b) => { const p = (a / (b || 1)) * 100; return p < 10 ? p.toFixed(1).replace(/\.0$/, '') : String(Math.round(p)); };
const named = (f) => { const n = displayName(f); return n && n !== f.fire_id ? n : null; };

export function buildScenes(f, { url = '', provenance = null } = {}) {
  const { state, app, spread, map, sources } = f.E;
  const { W, H } = f;
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
  const provincePct = pct(all.ha, PROVINCE_HA);

  // The search, run with the same module the Search tab uses, over the same fires
  const parsed = parseText(QUERY, { communities: live.communities ?? [] });
  const found = search(state.all, mergeQuery(emptyQuery(), { ...parsed.patch, text: parsed.text }));
  const allHa = state.all.reduce((s, x) => s + x.size_ha, 0);
  const foundShare = (found.ha / allHa) * 100;

  // The ring summary, counted as src/sources-view.js counts its header
  const records = provenance
    ? provenance.sources.filter((s) => s.source !== 'mock').reduce((sum, s) => sum + s.fires, 0) + (provenance.spread?.fires ?? 0) + (provenance.spread?.hotspots ?? 0)
    : null;

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
  const ringAt = (where) => () => sources.locate(where) ?? [W * 0.36, H * 0.55];

  const scenes = [
    {
      id: 'open', title: 'Every fire on record', shows: 'Cold open: in darkness, the record counts up; then a fire front burns through to the app.',
      lines: {
        a: `Since ${firstFull}, Saskatchewan has recorded ${sayCount(all.count)} wildfires.`,
        b: `Together they burned ${sayHa(all.ha)} hectares, equal to ${provincePct} percent of the province.`,
        c: 'This is every one of them.',
      },
      *run(f) {
        f.cover();
        f.embers(true, 3);
        f.music(0.55, 5);
        yield 1.2;
        f.say('a');
        yield* f.word('recorded');
        f.stat({ value: all.count, kicker: `Saskatchewan · ${firstFull}–${lastYear}`, label: 'wildfires on record', at: [W / 2, H * 0.36], size: 150, dur: 2.4, hold: null });
        yield* f.voice(0.5);
        f.say('b');
        yield* f.word('burned');
        f.stat({ value: all.ha, label: 'hectares burned', at: [W / 2, H * 0.7], size: 96, dur: 2.6, hold: null });
        yield* f.voice(0.7);
        f.clearStats();
        f.say('c');
        yield 0.9;
        f.sfx('boom');
        f.embers(false, 2.5);
        f.spawn(f.zoom([W / 2, H * 0.44], { z: 1.12, dur: 9, whoosh: false }));
        yield* f.burn('reveal', { dur: 2.6, origin: [0.5, 0.42] });
      },
    },
    {
      id: 'enter', title: 'Into the atlas', shows: 'Enter the atlas: the camera dives onto the province.',
      lines: { a: 'Emberline is an atlas of that record. Every fire, every season, rebuilt from public data and replayed as it happened.' },
      *run(f) {
        f.place([W * 0.78, H * 0.9]);
        f.say('a');
        yield 1.6;
        f.zoomOut({ dur: 1.4 });
        yield* f.clickOn('#enter', { dur: 1.4 });
        f.sfx('whoosh', { dur: 3.4, dir: 1, big: true });
        f.music(0.7, 3);
        yield* f.move([W * 0.6, H * 0.62], { dur: 1.2 });
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
        yield* f.word('times');
        f.stat({ value: times, label: `an average season, in ${top.year}`, at: [W * 0.47, H * 0.42], size: 130, dur: 1.6, hold: 3, plate: true, format: (n) => `${n.toFixed(1)}×` });
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
        yield 0.5;
        f.spot('#card', { pad: 8, dur: 0.8 });
        f.zoomTo('#card', { z: 1.55, dur: 1.4 });
        yield* f.move('#card .compare', { dur: 1.2 });
        yield* f.word('times');
        f.spot('#card .compare', { pad: 8, dur: 0.6 });
        yield* f.voice(0.5);
        f.spotOff();
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
        f.letterbox(true);
        yield* f.move([W * 0.62, H * 0.6], { dur: 1.4 });
        yield* f.voice(0.3);
        f.letterbox(false, 0.9);
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
          f.letterbox(true);
          f.fire(0.6);
          yield* f.move([W * 0.6, H * 0.35], { dur: 1.6 });
          yield* f.waitFor(() => state.t >= storm.t1 + 3, 12);
        }
        yield* f.voice(0.5);
        if (state.playing) { f.letterbox(false, 0.8); yield* f.clickOn('#play', { dur: 0.8 }); }
        f.fire(0.2);
        // Burn through to the whole province for the search
        yield* f.burn('cover', { dur: 1.1, origin: [0.6, 0.35] });
        f.letterbox(false, 0.1);
        map.jumpTo({ center: [-105.6, 54.6], zoom: 4.75, pitch: 0, bearing: 0 });
        f.place([W * 0.5, H * 0.55]);
        yield 0.3;
      },
    },
    {
      id: 'search', title: 'Search in plain words', shows: `Search: "${QUERY}" typed in plain language becomes filters, and the results ignite in date order.`,
      lines: {
        a: `Search understands plain language. Type ${QUERY_SAID}, and the words become filters.`,
        b: `${sayCount(found.count)} fires. Just ${pct1(found.count, state.all.length)} percent of the record, yet they burned ${pct1(found.ha, allHa)} percent of everything that burned.`,
        c: 'Every result is on the map, the same query runs on the server, and it all exports to CSV or GeoJSON.',
      },
      *run(f) {
        f.spawn(f.burn('reveal', { dur: 1.3, origin: [0.15, 0.2] }));
        yield 0.5;
        yield* f.clickOn('[data-mode="search"]', { dur: 1.1 });
        f.chip('04', 'Search', 'Ask the record in plain words');
        yield 0.4;
        f.say('a');
        f.spot('.sx-box', { pad: 6, dur: 0.8 });
        f.zoomTo('.sx-box', { z: 1.9, dur: 1.3, ax: 0.9 });
        yield* f.clickOn('#sx-input', { dur: 1.0, ax: 0.3 });
        yield 0.2;
        yield* f.type(QUERY, { cps: 12 });
        yield 0.5;
        f.spot('#sx-chips', { pad: 8, dur: 0.6 });
        yield* f.voice(0.2);
        // The results: count, hectares and share, then the list
        f.spotOff(0.4);
        f.zoomTo('.sx-results .kpis', { z: 1.6, dur: 1.4 });
        f.say('b');
        yield* f.move('#sx-k-count', { dur: 1.3 });
        yield* f.word('burned');
        f.spot('#sx-share', { pad: 10, dur: 0.6 });
        f.stat({ value: foundShare, label: 'of all area burned', kicker: `${fmtInt(found.count)} fires`, at: [W * 0.4, H * 0.5], size: 140, dur: 1.6, hold: 3.4, plate: true, format: (n) => `${n.toFixed(1)}%` });
        yield* f.voice(0.3);
        f.spotOff(0.4);
        f.zoomOut({ dur: 1.3 });
        f.say('c');
        yield* f.move('#sx-list .sx-row', { dur: 1.2, ax: 0.35 }); // hovering a row lights its fire on the map
        yield 1.2;
        yield* f.word('exports');
        f.spot('.sx-export', { pad: 8, dur: 0.6 });
        f.zoomTo('.sx-actions', { z: 1.6, dur: 1.2 });
        yield* f.voice(0.3);
        f.spotOff(0.4);
      },
    },
    {
      id: 'explore', title: 'The whole record in 3D', shows: 'Explore: the search becomes 3D hexagon columns; then every fire rises, and the camera orbits.',
      lines: {
        a: 'One click turns that search into three dimensions. A column for every twelve kilometres, its height the area burned.',
        b: `Show every fire, and every season rises together. The largest one percent of fires, just ${fmtInt(onePct.length)} of them, burned ${pct(onePctHa, all.ha)} percent of it all.`,
      },
      *run(f) {
        app.set({ viz: 'hex' });
        f.zoomOut({ dur: 0.8 });
        yield* f.clickOn('#sx-explore', { dur: 1.0 });
        yield 0.4; // let the mode switch settle its own camera, then tilt up for the columns
        app.fly({ center: [-105.4, 54.2], zoom: 5.0, pitch: 52, bearing: -18 });
        f.sfx('whoosh', { dur: 3, dir: 1, big: true });
        f.chip('05', 'Explore', 'The whole record at once');
        f.say('a');
        yield* f.move([W * 0.55, H * 0.5], { dur: 1.6 });
        yield* f.voice(0.3);
        f.say('b');
        yield* f.clickOn('#sx-applied-clear', { dur: 1.2 });
        f.sfx('whoosh', { dur: 1.5, dir: 1 });
        yield 1.2;
        yield* f.clickOn('#orbit', { dur: 1.2 });
        f.zoomTo([W * 0.5, H * 0.5], { z: 1.2, dur: 2.5 });
        yield* f.move([W * 0.7, H * 0.82], { dur: 1.4 });
        yield* f.word('percent');
        f.stat({ value: pct(onePctHa, all.ha), label: `of all area burned by the largest 1% of fires`, at: [W * 0.34, H * 0.8], size: 110, dur: 1.6, hold: 3.6, plate: true, format: (n) => `${Math.round(n)}%` });
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
        app.set({ orbit: false });
        app.fly({ center: [-105.6, 55.0], zoom: 5.0, pitch: 30, bearing: 0 });
        f.chip('06', 'Live', 'SPSA services and national feeds, now');
        f.say('a');
        yield* f.waitFor(() => !map.isMoving(), 4);
        f.zoomTo('#alert-radius', { z: 1.35, dur: 1.3, ax: 0.9 });
        yield* f.drag(() => sliderX('#alert-radius', Number(document.querySelector('#alert-radius').value)), () => sliderX('#alert-radius', 130), { dur: 2.2 });
        f.zoomOut({ dur: 1.4 });
        yield* f.move([W * 0.55, H * 0.5], { dur: 1.4 });
        yield* f.voice(0.2);
        if (live.simulated) { f.zoomTo('#live-source', { z: 1.5, dur: 1.2 }); f.spot('#live-source', { pad: 8 }); }
        f.say('b');
        yield* f.voice(0.8);
        f.spotOff();
        f.zoomOut({ dur: 1.2 });
      },
    },
    {
      id: 'sources', title: 'Read the rings', shows: 'Every source behind the app as a fire-scarred tree cross-section, with a live check of SPSA\'s own server.',
      lines: {
        a: 'And every number you have just seen traces back to where it came from.',
        b: "Read the rings. Like a tree's cross-section, each ring is a year of the record, and the scars are its worst fire seasons. Each source bores through the years it covers.",
        c: "Pick one, and it names the owner, the licence and the exact request. It can even ask the source, live. Here, the Public Safety Agency's own server.",
        d: records
          ? `${SOURCES.length} sources. ${records >= 1e6 ? `Over ${Math.floor(records / 1e5) / 10} million` : `Over ${fmtInt(records)}`} real records. And not one data file in the repository. Every dataset rebuilds from its source with one command.`
          : `${SOURCES.length} sources, and not one data file in the repository. Every dataset rebuilds from its source with one command.`,
      },
      *run(f) {
        yield* f.clickOn('#sources-btn', { dur: 1.3 });
        f.sfx('whoosh', { dur: 2.4, dir: 1, big: true });
        f.say('a');
        yield* f.until(() => document.querySelector('#src-list button[data-id="spsa-communities"]') && sources.locate({ source: 'cnfdb' }));
        f.fire(0.35, 2);
        // Push in on the trunk while the front burns out from the pith
        f.zoomTo(ringAt({ year: top.year }), { z: 1.3, dur: 3.2, whoosh: false });
        yield* f.move([W * 0.33, H * 0.62], { dur: 1.6 });
        yield* f.voice(0.2);
        f.say('b');
        yield* f.word('ring');
        yield* f.move(ringAt({ year: lastYear - 12 }), { dur: 1.2 });
        yield* f.word('scars');
        yield* f.move(ringAt({ year: top.year }), { dur: 1.1 }); // the tooltip names the season
        yield* f.word('bores');
        yield* f.move(ringAt({ source: 'cnfdb' }), { dur: 1.3 });
        yield* f.voice(0.3);
        f.zoomOut({ dur: 1.3 });
        f.say('c');
        f.spot('#src-list', { pad: 8, dur: 0.7 });
        yield* f.clickOn('#src-list button[data-id="spsa-communities"]', { dur: 1.3 });
        // The card runs below the fold: scroll the panel until its live reply line is on screen
        yield* f.move([W * 0.87, H * 0.72], { dur: 0.6 });
        yield* f.scroll('#sources .src-panel', { into: '#src-card .src-ping-out', dur: 1.0 });
        f.spot('#src-card', { pad: 6, dur: 0.7 });
        f.zoomTo('#src-card', { z: 1.55, dur: 1.4 });
        yield* f.word('ask');
        yield* f.clickOn('#src-card .src-ping', { dur: 1.1 });
        // The reply arrives in real time; the film waits for it
        yield* f.until(() => { const t = document.querySelector('#src-card .src-ping-out')?.textContent ?? ''; return t && t !== 'Asking…'; });
        yield 0.2;
        f.spot('#src-card .src-ping-out', { pad: 10, dur: 0.6 });
        f.sfx('hit');
        yield* f.voice(1.2);
        f.spotOff();
        f.zoomOut({ dur: 1.4 });
        f.fire(0.2, 2);
        f.say('d');
        yield 0.6;
        f.spot('#rings-sum', { pad: 10, dur: 0.8 });
        f.zoomTo('#rings-sum', { z: 1.6, dur: 1.6, ax: 0.35 });
        yield* f.move([W * 0.36, H * 0.72], { dur: 1.6 });
        yield* f.voice(0.8);
        f.spotOff(0.8);
        f.zoomOut({ dur: 1.6 });
        yield 1.0;
      },
    },
    {
      id: 'end', title: 'Emberline', shows: 'End card.',
      lines: { a: 'Emberline. Every fire, from the record.' },
      *run(f) {
        f.showCursor(false);
        f.fire(0, 2);
        yield* f.burn('cover', { dur: 1.4, origin: [0.36, 0.55] });
        f.endCard({
          line: `${fmtInt(all.count)} fires · ${fmtHa(all.ha)} ha · ${firstFull}–${lastYear}`,
          sources: 'CNFDB · NBAC · CWFIS · SPSA GIS · ECCC GeoMet',
          url,
        });
        f.music(0.45, 2);
        yield 1.3; // the card fades in under the cover
        f.sfx('boom');
        f.spawn(f.burn('reveal', { dur: 2, origin: [0.5, 0.45], sound: false }));
        yield 0.8;
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
    search: { query: QUERY, count: found.count, share: Number(foundShare.toFixed(1)) }, sources: SOURCES.length, records,
  };
  return scenes;
}
