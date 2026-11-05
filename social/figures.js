/**
 * The figures printed on the social images (LinkedIn cover, Viva Engage banner), computed from the
 * loaded record the same way the app and the film pick their range: the continuous record starts at
 * the first year with at least 100 fires (CNFDB is sparse before 1981). Real sources only; the mock
 * dataset never reaches a social image.
 */
import { byYear, fmtInt } from '../src/data.js';

export const REAL_SOURCES = ['cnfdb', 'spsa'];
export const FULL_YEAR_FIRES = 100;

/** Hectares as a short headline number: 25,653,060 → "25.7M", 812,400 → "812k". */
export function headlineHa(ha) {
  if (ha >= 1e6) return `${(ha / 1e6).toFixed(1)}M`;
  if (ha >= 1e3) return `${Math.round(ha / 1e3)}k`;
  return fmtInt(ha);
}

/**
 * fires: rows with at least { year, size_ha }. Returns the raw numbers and the strings the cards show.
 */
export function socialFigures(fires, source = 'cnfdb') {
  if (!REAL_SOURCES.includes(source)) throw new Error(`Social images use real data only (got '${source}').`);
  if (!fires.length) throw new Error(`No ${source} fires loaded.`);
  const ys = [...new Set(fires.map((f) => f.year))].sort((a, b) => a - b);
  const yearly = byYear(fires, ys);
  const firstYear = yearly.find((y) => y.count >= FULL_YEAR_FIRES)?.year ?? ys[0];
  const lastYear = ys[ys.length - 1];
  let count = 0, ha = 0;
  for (const f of fires) if (f.year >= firstYear) { count++; ha += f.size_ha; }
  const range = `${firstYear}–${lastYear}`;
  const label = { cnfdb: 'CNFDB', spsa: 'SPSA' }[source];
  return {
    source, firstYear, lastYear, fires: count, hectares: Math.round(ha), recordFrom: ys[0],
    text: {
      fires: fmtInt(count),
      hectares: headlineHa(ha),
      range,
      since: String(firstYear),
      caption: `Real app, real data · column height = area burned, ${range} · ${label}`,
    },
  };
}
