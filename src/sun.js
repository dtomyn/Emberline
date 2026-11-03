// Solar position, accurate to well under a degree: plenty for lighting a map.
// Split in two so a whole grid of pixels can share the per-instant terms.
const RAD = Math.PI / 180;

/** Terms that depend only on the instant: solar declination, right ascension, sidereal time. */
export function solarTerms(date) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  return {
    dec: Math.asin(Math.sin(eps) * Math.sin(lambda)),
    ra: Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)),
    gmst: ((280.46061837 + 360.98564736629 * n) % 360) * RAD,
  };
}

/** Sun altitude (degrees above the horizon) and azimuth (degrees clockwise from north). */
export function sunAt(terms, lat, lon) {
  const H = terms.gmst + lon * RAD - terms.ra; // local hour angle
  const phi = lat * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(terms.dec) + Math.cos(phi) * Math.cos(terms.dec) * Math.cos(H);
  const az = Math.atan2(
    -Math.cos(terms.dec) * Math.sin(H),
    Math.sin(terms.dec) * Math.cos(phi) - Math.cos(terms.dec) * Math.cos(H) * Math.sin(phi),
  );
  return { altitude: Math.asin(sinAlt) / RAD, azimuth: ((az / RAD) + 360) % 360 };
}

/** Fast path for many points: altitude only. */
export function sunAltitude(terms, lat, lon) {
  const phi = lat * RAD;
  const H = terms.gmst + lon * RAD - terms.ra;
  return Math.asin(Math.sin(phi) * Math.sin(terms.dec) + Math.cos(phi) * Math.cos(terms.dec) * Math.cos(H)) / RAD;
}

export const sunPosition = (date, lat, lon) => sunAt(solarTerms(date), lat, lon);

// Saskatchewan keeps Central Standard Time (UTC−6) all year: no daylight saving.
export const SK_UTC_OFFSET_H = -6;

/** A Date for the given local (CST) clock time on the calendar day of `day` (taken in CST). */
export function atLocalTime(day, hours) {
  const local = new Date(day.getTime() + SK_UTC_OFFSET_H * 3600000);
  const midnightUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightUtc + (hours - SK_UTC_OFFSET_H) * 3600000);
}

export function localClock(date) {
  const local = new Date(date.getTime() + SK_UTC_OFFSET_H * 3600000);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}
