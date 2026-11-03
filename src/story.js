// Guided story. Every number is computed from the loaded dataset, so the narrative stays
// true whichever source (CNFDB, SPSA export, mock) is selected.
import { summarize, byYear, fmtHa, fmtInt, MONTHS, seasonT, SEASON_START_DOY } from './data.js';

const SASK_AREA_HA = 65_103_600; // 651,036 km²

/** Hectare-weighted centre of a set of fires, for camera targets. */
function weightedCenter(list) {
  let w = 0, x = 0, y = 0;
  for (const f of list) { const k = Math.sqrt(f.size_ha + 1); w += k; x += f.longitude * k; y += f.latitude * k; }
  return w ? [x / w, y / w] : [-105.8, 55];
}

export function buildStory(fires, displayName) {
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

  const peak = (idx) => {
    const m = Array(12).fill(0);
    core.forEach((f) => f.causeIdx === idx && m[f.month]++);
    return MONTHS[m.indexOf(Math.max(...m))];
  };
  const sorted = [...core].sort((a, b) => b.size_ha - a.size_ha);
  const onePct = sorted.slice(0, Math.max(1, Math.round(sorted.length / 100)));
  const onePctHa = onePct.reduce((s, f) => s + f.size_ha, 0);
  const pct = (a, b) => Math.round((a / (b || 1)) * 100);
  const decadeSplit = lastYear - 9;
  const recent = core.filter((f) => f.year >= decadeSplit).reduce((s, f) => s + f.size_ha, 0);
  const prior = core.filter((f) => f.year >= decadeSplit - 10 && f.year < decadeSplit).reduce((s, f) => s + f.size_ha, 0);

  return [
    {
      kicker: `${firstFull} – ${lastYear}`,
      title: `${yearly.length} fire seasons, one province`,
      body: `Since ${firstFull}, <b>${fmtInt(all.count)} wildfires</b> have burned <b>${fmtHa(all.ha)} hectares</b> of Saskatchewan, an area equal to <b>${pct(all.ha, SASK_AREA_HA)}%</b> of the entire province. Each glow on this map is a place that burned.`,
      apply: (app) => {
        app.set({ mode: 'explore', viz: 'heat', orbit: false, causes: ['Lightning', 'Human', 'Unknown'], minSize: 0, yrFrom: firstFull, yrTo: lastYear });
        app.fly({ center: [-105.6, 54.6], zoom: 4.75, pitch: 0, bearing: 0 });
      },
    },
    {
      kicker: `The ${top.year} season`,
      title: `The year the north burned`,
      body: `In ${top.year}, <b>${fmtInt(top.count)} fires</b> burned <b>${fmtHa(top.ha)} ha</b>, <b>${(top.ha / avgHa).toFixed(1)}×</b> the average season. The largest, <b>${displayName(topSummary.largest)}</b>, grew to ${fmtHa(topSummary.largest.size_ha)} ha on its own. Watch it unfold.`,
      apply: (app) => {
        app.set({ mode: 'timeline', memory: 'season', causes: ['Lightning', 'Human', 'Unknown'], minSize: 0, yrFrom: top.year, yrTo: top.year });
        app.jump(seasonT(top.year, SEASON_START_DOY + 20));
        app.fly({ center: weightedCenter(topFires), zoom: 5.4, pitch: 35, bearing: -8 });
        app.play(21);
      },
    },
    {
      kicker: 'Natural causes',
      title: 'Struck by lightning',
      body: `Lightning starts <b>${pct(L.count, all.count)}%</b> of Saskatchewan's fires, yet those fires account for <b>${pct(L.ha, all.ha)}%</b> of all area burned. Remote strikes in the boreal shield grow large before anyone reaches them. Lightning fires peak in <b>${peak(0)}</b>.`,
      apply: (app) => {
        app.set({ mode: 'explore', viz: 'dots', orbit: false, causes: ['Lightning'], minSize: 0, yrFrom: firstFull, yrTo: lastYear });
        app.fly({ center: [-105.8, 56.2], zoom: 5.0, pitch: 20, bearing: 0 });
      },
    },
    {
      kicker: 'Human causes',
      title: 'Where people are',
      body: `People start <b>${pct(H.count, all.count)}%</b> of fires but only <b>${pct(H.ha, all.ha)}%</b> of the burned area. They cluster along roads and near communities, are caught sooner, and peak in <b>${peak(1)}</b>, before green-up.`,
      apply: (app) => {
        app.set({ mode: 'explore', viz: 'heat', orbit: false, causes: ['Human'], minSize: 0, yrFrom: firstFull, yrTo: lastYear });
        app.fly({ center: [-105.4, 54.2], zoom: 5.3, pitch: 0, bearing: 0 });
      },
    },
    {
      kicker: 'The giants',
      title: `1% of fires, ${pct(onePctHa, all.ha)}% of the damage`,
      body: `The largest <b>${fmtInt(onePct.length)}</b> fires (the top 1%) burned <b>${fmtHa(onePctHa)} ha</b>. Over the last ten seasons (${decadeSplit}–${lastYear}) the province burned <b>${fmtHa(recent)} ha</b>, against ${fmtHa(prior)} ha in the ten before. Each column is a 12 km hexagon, with height showing area burned.`,
      apply: (app) => {
        app.set({ mode: 'explore', viz: 'hex', orbit: true, causes: ['Lightning', 'Human', 'Unknown'], minSize: 0, yrFrom: firstFull, yrTo: lastYear });
        app.fly({ center: [-105.6, 55.4], zoom: 5.2, pitch: 58, bearing: 25 });
      },
    },
    {
      kicker: 'Right now',
      title: 'The live picture',
      body: `During fire season this view pulls active incidents from SPSA's ArcGIS services and flags communities within the alert radius. Community locations come live from <b>gis.saskatchewan.ca</b>.`,
      apply: (app) => {
        app.set({ mode: 'live' });
        app.fly({ center: [-105.6, 55.2], zoom: 5.0, pitch: 30, bearing: 0 });
      },
    },
  ];
}
