// src/physics/artemis1.lib.mjs
//
// What the Artemis I validation (artemis1.validate.mjs) and the app's
// mission file (artemis1.export.mjs) share: NASA's as-flown burns, and a
// reader for JPL Horizons' vector tables as artemis1.fetch.mjs caches them.

const FT = 0.3048;

// NASA's as-flown burns: ignition (UTC) and delta-v from the post-flight
// review column of AAS 23-363 (Table 1, Fig. 7), duration and engine from
// Belair et al. (Artemis I engine performance, Table 1). OMS-E: the main
// engine; aux: auxiliary thrusters; RCS: reaction control.
export const AAS = 'https://ntrs.nasa.gov/api/citations/20230010480/downloads/AAS_23-363_artemis1-operations_rev2.pdf';
export const NASA_BURNS = [
  ['OTC-1', '2022-11-16T14:32:39Z', 114.67, 30.5, 'OMS-E'], ['OTC-2', '2022-11-17T11:32:39Z', 0.73, 8.6, 'RCS'],
  ['OTC-3', '2022-11-20T12:12:44Z', 2.87, 5.5, 'aux'], ['OTC-4', '2022-11-21T06:44:14Z', 0.71, 7.5, 'RCS'],
  ['Outbound powered flyby', '2022-11-21T12:44:14Z', 586.09, 149.6, 'OMS-E'], ['OTC-5', '2022-11-22T06:02:44Z', 3.21, 5.6, 'aux'],
  ['OTC-6', '2022-11-24T21:52:28Z', 8.79, 15.2, 'aux'], ['DRO insertion', '2022-11-25T21:52:28Z', 362.99, 87.9, 'OMS-E'],
  ['DRO maintenance 1', '2022-11-26T21:52:28Z', 0.05, 1.23, 'RCS'], ['DRO maintenance 3', '2022-11-30T21:53:56Z', 43.37, 94.9, 'aux'],
  ['DRO departure', '2022-12-01T21:53:56Z', 454.34, 105.1, 'OMS-E'], ['RTC-1', '2022-12-02T03:53:56Z', 0.48, 4.8, 'RCS'],
  ['RTC-2', '2022-12-04T16:43:20Z', 1.71, 17, 'RCS'], ['RTC-3', '2022-12-05T10:43:20Z', 2.05, 21.92, 'RCS'],
  ['Return powered flyby', '2022-12-05T16:43:20Z', 960.97, 207.1, 'OMS-E'], ['RTC-4', '2022-12-06T10:43:20Z', 0.50, 5, 'RCS'],
  ['RTC-5', '2022-12-10T20:20:14Z', 5.00, 7.2, 'aux'], ['RTC-6', '2022-12-11T12:20:14Z', 0.98, 8.4, 'RCS'],
].map(([name, utc, ftps, s, engine]) => ({ name, ms: Date.parse(utc), ftps, dv: ftps * FT / 1000, s, engine }));

// The rows of a Horizons vector table (CSV, JDUT first): [ISO UTC, x, y, z,
// vx, vy, vz], km and km/s.
export function parseHorizons(text) {
  const i0 = text.indexOf('$$SOE'), i1 = text.indexOf('$$EOE');
  if (i0 < 0 || i1 < 0) throw new Error('not a Horizons vector table');
  return text.slice(i0 + 5, i1).trim().split('\n').map((line) => {
    const f = line.split(',').map((s) => s.trim());
    const ms = (Number(f[0]) - 2440587.5) * 86400e3;
    return [new Date(Math.round(ms)).toISOString(), ...f.slice(2, 8).map(Number)];
  });
}
