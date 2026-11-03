// Guided story. Every number is computed from the loaded dataset, so the narrative stays
// true whichever source (CNFDB, SPSA export, mock) is selected.
//
// Each chapter has on-screen text (`body`) and a spoken line (`say`) for the documentary, with
// numbers written the way a narrator says them. `apply` sets the scene; `cues` run on a spoken
// word in the documentary, and straight after `apply` in the click-through story. `hold` is how
// many seconds the documentary lingers after the line ends.
import { summarize, byYear, fmtHa, fmtInt, fmtDate, MONTHS, seasonT, SEASON_START_DOY } from './data.js';
import { FULL_MONTHS, sayHa, sayCount, sayDate } from './narration.js';

const SASK_AREA_HA = 65_103_600; // 651,036 km²

/** Hectare-weighted centre of a set of fires, for camera targets. */
function weightedCenter(list) {
  let w = 0, x = 0, y = 0;
  for (const f of list) { const k = Math.sqrt(f.size_ha + 1); w += k; x += f.longitude * k; y += f.latitude * k; }
  return w ? [x / w, y / w] : [-105.8, 55];
}

/** The spread replay to feature: the largest one in the worst season, else the largest of all. */
function featuredSpread(spread, year) {
  const big = (list) => list.reduce((a, f) => (!a || f.area_ha > a.area_ha ? f : a), null);
  return big(spread.filter((f) => f.year === year)) ?? big(spread);
}

/**
 * Returns { chapters, opening, closing }. `storms` come from lightning.js; `spread` is the
 * /api/spread list, and adds a True Spread Replay chapter when it has fires.
 */
export function buildStory(fires, displayName, { storms = [], spread = [] } = {}) {
  const yearsAll = [...new Set(fires.map((f) => f.year))].sort((a, b) => a - b);
  // First year of continuous record: the first year with at least 100 fires
  const yearly0 = byYear(fires, yearsAll);
  const firstFull = yearly0.find((y) => y.count >= 100)?.year ?? yearsAll[0];
  const lastYear = yearsAll[yearsAll.length - 1];
  const core = fires.filter((f) => f.year >= firstFull);
  const all = summarize(core);
  const yearly = byYear(core, yearsAll.filter((y) => y >= firstFull));
  const avgHa = all.ha / yearly.length;
  const top = [...yearly].sort((a, b) => b.ha - a.ha)[0];
  const topFires = core.filter((f) => f.year === top.year);
  const topSummary = summarize(topFires);
  const [L, H] = all.byCause;

  const peakMonth = (idx) => {
    const m = Array(12).fill(0);
    core.forEach((f) => f.causeIdx === idx && m[f.month]++);
    return m.indexOf(Math.max(...m));
  };
  const sorted = [...core].sort((a, b) => b.size_ha - a.size_ha);
  const onePct = sorted.slice(0, Math.max(1, Math.round(sorted.length / 100)));
  const onePctHa = onePct.reduce((s, f) => s + f.size_ha, 0);
  const pct = (a, b) => Math.round((a / (b || 1)) * 100);
  // The record's biggest lightning event, from the storm grouping in lightning.js
  const storm = storms.find((s) => s.fires[0].year >= firstFull) ?? null;
  const stormDays = storm ? Math.round(storm.t1 - storm.t0) + 1 : 0;
  const stormLine = (s) => (stormDays > 1
    ? `Over <b>${stormDays} days</b> from ${fmtDate(s.fires[0].ignition_date)}, one lightning outbreak sparked <b>${fmtInt(s.count)} fires</b>.`
    : `On <b>${fmtDate(s.fires[0].ignition_date)}</b>, a single storm sparked <b>${fmtInt(s.count)} fires</b>.`);
  const sayStorm = (s) => (stormDays > 1
    ? `Over ${stormDays} days from ${sayDate(s.fires[0].ignition_date)}, one lightning outbreak sparked ${fmtInt(s.count)} fires.`
    : `On ${sayDate(s.fires[0].ignition_date)}, a single storm sparked ${fmtInt(s.count)} fires.`);
  // A fire's name, or null when the record has only a code for it
  const named = (f) => { const n = displayName(f); return n && n !== f.fire_id ? n : null; };
  const largestName = named(topSummary.largest);
  const sp = featuredSpread(spread, top.year);
  const spName = sp?.cnfdb_fire_id ? named({ fire_id: sp.cnfdb_fire_id, fire_name: sp.fire_name }) : null;
  const spDays = sp ? Math.round((Date.parse(sp.hs_edate) - Date.parse(sp.hs_sdate)) / 864e5) + 1 : 0;
  const decadeSplit = lastYear - 9;
  const recent = core.filter((f) => f.year >= decadeSplit).reduce((s, f) => s + f.size_ha, 0);
  const prior = core.filter((f) => f.year >= decadeSplit - 10 && f.year < decadeSplit).reduce((s, f) => s + f.size_ha, 0);

  const chapters = [
    {
      kicker: `${firstFull} – ${lastYear}`,
      title: `${yearly.length} fire seasons, one province`,
      body: `Since ${firstFull}, <b>${fmtInt(all.count)} wildfires</b> have burned <b>${fmtHa(all.ha)} hectares</b> of Saskatchewan, an area equal to <b>${pct(all.ha, SASK_AREA_HA)}%</b> of the entire province. Each glow on this map is a place that burned.`,
      say: `Since ${firstFull}, Saskatchewan has recorded ${sayCount(all.count)} wildfires. Together they burned ${sayHa(all.ha)} hectares, an area equal to ${pct(all.ha, SASK_AREA_HA)} percent of the entire province. Each glow on this map is a place that burned.`,
      apply: (app) => {
        app.set({ mode: 'explore', viz: 'heat', orbit: false, causes: ['Lightning', 'Human', 'Unknown'], minSize: 0, yrFrom: firstFull, yrTo: lastYear });
        app.fly({ center: [-105.6, 54.6], zoom: 4.75, pitch: 0, bearing: 0 });
      },
    },
    {
      kicker: `The ${top.year} season`,
      title: `The year the north burned`,
      body: `In ${top.year}, <b>${fmtInt(top.count)} fires</b> burned <b>${fmtHa(top.ha)} ha</b>, <b>${(top.ha / avgHa).toFixed(1)}×</b> the average season. The largest, <b>${displayName(topSummary.largest)}</b>, grew to ${fmtHa(topSummary.largest.size_ha)} ha on its own. Watch it unfold.`,
      say: `In ${top.year}, the north burned. ${sayCount(top.count)} fires swept across ${sayHa(top.ha)} hectares, ${(top.ha / avgHa).toFixed(1)} times an average season. ` +
        `${largestName ? `The largest, the ${largestName},` : 'The largest single fire'} grew to ${sayHa(topSummary.largest.size_ha)} hectares on its own. Watch the season unfold.`,
      hold: 6,
      apply: (app) => {
        app.set({ mode: 'timeline', memory: 'season', causes: ['Lightning', 'Human', 'Unknown'], minSize: 0, yrFrom: top.year, yrTo: top.year });
        app.jump(seasonT(top.year, SEASON_START_DOY + 20));
        app.fly({ center: weightedCenter(topFires), zoom: 5.4, pitch: 35, bearing: -8 });
      },
      cues: [{ at: 'Watch', run: (app) => app.play(21) }],
    },
    ...(sp ? [{
      kicker: 'True spread replay',
      title: `Watching ${spName ? `the ${spName}` : 'a giant'} grow`,
      body: `Satellites detected ${spName ? `the <b>${spName}</b>` : 'this fire'} <b>${fmtInt(sp.hotspot_count)} times</b> over <b>${spDays} days</b> as it grew to <b>${fmtHa(sp.area_ha)} ha</b>. The front is interpolated between real detections; the final scar is NBAC's mapped perimeter.`,
      say: `Satellites watched ${spName ? `the ${spName}` : 'one of the largest fires'} grow. Over ${spDays} days, they detected it ${sayCount(sp.hotspot_count)} times as it spread across ${sayHa(sp.area_ha)} hectares. ` +
        'The front you see is interpolated between those real detections.',
      hold: 8,
      apply: (app) => app.spread(sp.id),
    }] : []),
    {
      kicker: 'Natural causes',
      title: 'Struck by lightning',
      body: `Lightning starts <b>${pct(L.count, all.count)}%</b> of Saskatchewan's fires, yet those fires account for <b>${pct(L.ha, all.ha)}%</b> of all area burned. Lightning fires peak in <b>${MONTHS[peakMonth(0)]}</b>.` +
        (storm ? ` ${stormLine(storm)} Watch it strike.` : ''),
      say: `Lightning starts ${pct(L.count, all.count)} percent of Saskatchewan's fires, yet those fires account for ${pct(L.ha, all.ha)} percent of all the area burned. They peak in ${FULL_MONTHS[peakMonth(0)]}.` +
        (storm ? ` ${sayStorm(storm)} Watch it strike.` : ''),
      hold: storm ? 4 : 2,
      apply: (app) => {
        if (!storm) {
          app.set({ mode: 'explore', viz: 'dots', orbit: false, causes: ['Lightning'], minSize: 0, yrFrom: firstFull, yrTo: lastYear });
          app.fly({ center: [-105.8, 56.2], zoom: 5.0, pitch: 20, bearing: 0 });
          return;
        }
        const y = Number(storm.fires[0].ignition_date.slice(0, 4));
        app.set({ mode: 'timeline', memory: 'season', causes: ['Lightning', 'Human', 'Unknown'], minSize: 0, yrFrom: y, yrTo: y });
        app.jump(storm.t0 - 1.5);
        app.fly({ center: storm.center, zoom: 6.1, pitch: 50, bearing: -15 });
      },
      cues: storm ? [{ at: 'Watch', run: (app) => app.play(7) }] : [],
    },
    {
      kicker: 'Human causes',
      title: 'Where people are',
      body: `People start <b>${pct(H.count, all.count)}%</b> of fires but only <b>${pct(H.ha, all.ha)}%</b> of the burned area. They cluster along roads and near communities, are caught sooner, and peak in <b>${MONTHS[peakMonth(1)]}</b>, before green-up.`,
      say: `People start ${pct(H.count, all.count)} percent of fires, but only ${pct(H.ha, all.ha)} percent of the burned area. Their fires cluster along roads and near communities, are caught sooner, and peak in ${FULL_MONTHS[peakMonth(1)]}, before green-up.`,
      apply: (app) => {
        app.set({ mode: 'explore', viz: 'heat', orbit: false, causes: ['Human'], minSize: 0, yrFrom: firstFull, yrTo: lastYear });
        app.fly({ center: [-105.4, 54.2], zoom: 5.3, pitch: 0, bearing: 0 });
      },
    },
    {
      kicker: 'The giants',
      title: `1% of fires, ${pct(onePctHa, all.ha)}% of the damage`,
      body: `The largest <b>${fmtInt(onePct.length)}</b> fires (the top 1%) burned <b>${fmtHa(onePctHa)} ha</b>. Over the last ten seasons (${decadeSplit}–${lastYear}) the province burned <b>${fmtHa(recent)} ha</b>, against ${fmtHa(prior)} ha in the ten before. Each column is a 12 km hexagon, with height showing area burned.`,
      say: `The largest one percent of fires, just ${fmtInt(onePct.length)} of them, burned ${sayHa(onePctHa)} hectares. That is ${pct(onePctHa, all.ha)} percent of all the area burned. ` +
        `In the last ten seasons the province burned ${sayHa(recent)} hectares, against ${sayHa(prior)} in the ten before.`,
      hold: 3,
      apply: (app) => {
        app.set({ mode: 'explore', viz: 'hex', orbit: true, causes: ['Lightning', 'Human', 'Unknown'], minSize: 0, yrFrom: firstFull, yrTo: lastYear });
        app.fly({ center: [-105.6, 55.4], zoom: 5.2, pitch: 58, bearing: 25 });
      },
    },
    {
      kicker: 'Right now',
      title: 'The live picture',
      body: `During fire season this view pulls active incidents from SPSA's ArcGIS services and flags communities within the alert radius. Community locations come live from <b>gis.saskatchewan.ca</b>.`,
      say: 'And this is the live picture. During fire season, this view pulls active fires from the Saskatchewan Public Safety Agency, or from national satellite hotspots, and flags every community inside the alert radius.',
      apply: (app) => {
        app.set({ mode: 'live' });
        app.fly({ center: [-105.6, 55.2], zoom: 5.0, pitch: 30, bearing: 0 });
      },
    },
  ];

  return {
    chapters,
    opening: `Emberline presents. ${yearly.length} fire seasons in Saskatchewan, told from the record.`,
    closing: 'Every figure in this film was computed from the loaded record. The map is yours to explore.',
  };
}
