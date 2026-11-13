// src/physics/timescale.js
//
// The app's clock is UTC (Unix milliseconds). Ephemerides want TT or TDB:
//
//   TT  - UTC = 32.184 s + (TAI - UTC)      leap seconds, NAIF naif0012.tls
//   TDB - TT  = 0.001657 s sin g + 0.000014 s sin 2g,
//               g = 357.53 deg + 0.98560028 deg x (days from J2000)
//
// (the standard two-term approximation, good to about 30 us, which the Moon
// covers in 3 cm). The leap-second table starts in 1972; before it, callers
// fall back to a model (astronomy-engine's, in ephemeris.js).

export const J2000_UTC_MS = Date.UTC(2000, 0, 1, 12);

const LEAP_SECONDS = [
  ['1972-01-01', 10], ['1972-07-01', 11], ['1973-01-01', 12], ['1974-01-01', 13], ['1975-01-01', 14],
  ['1976-01-01', 15], ['1977-01-01', 16], ['1978-01-01', 17], ['1979-01-01', 18], ['1980-01-01', 19],
  ['1981-07-01', 20], ['1982-07-01', 21], ['1983-07-01', 22], ['1985-07-01', 23], ['1988-01-01', 24],
  ['1990-01-01', 25], ['1991-01-01', 26], ['1992-07-01', 27], ['1993-07-01', 28], ['1994-07-01', 29],
  ['1996-01-01', 30], ['1997-07-01', 31], ['1999-01-01', 32], ['2006-01-01', 33], ['2009-01-01', 34],
  ['2012-07-01', 35], ['2015-07-01', 36], ['2017-01-01', 37],
].map(([d, s]) => [Date.parse(`${d}T00:00:00Z`), s]);

export const LEAP_TABLE_START_MS = LEAP_SECONDS[0][0];

// TT - UTC in seconds at a UTC instant, or null before 1972.
export function ttMinusUtc(ms) {
  if (ms < LEAP_TABLE_START_MS) return null;
  let tai = LEAP_SECONDS[0][1];
  for (const [d, s] of LEAP_SECONDS) if (ms >= d) tai = s;
  return 32.184 + tai;
}

// TDB seconds past J2000 (SPICE's ephemeris time) at a UTC instant, from
// 1972 on.
export function tdbSeconds(ms) {
  return tdbFromTt((ms - J2000_UTC_MS) / 1000 + ttMinusUtc(ms));
}

// TDB from TT, seconds past J2000.
export function tdbFromTt(tt) {
  const g = (357.53 + 0.98560028 * (tt / 86400)) * Math.PI / 180;
  return tt + 0.001657 * Math.sin(g) + 0.000014 * Math.sin(2 * g);
}
