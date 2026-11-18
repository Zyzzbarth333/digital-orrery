// src/scene/satellites.worker.ts
//
// SGP4 for the whole catalogue, off the main thread (satellites.ts). Given
// the GP elements once (CelesTrak's CSV), then a time, it runs SGP4 for
// every satellite, turns each state into J2000 and from there into the
// two-body ellipse through it, which the points' vertex shader carries on
// until the next time (a few seconds of the clock at most): the perifocal
// axes P and Q, a, e, the mean anomaly at the time and the mean motion.
// 16,892 satellites take about 8 ms once the code is warm.
//
// The catalogue comes in sets, one per rail switch (the active satellites,
// the debris, the rocket bodies, the analyst objects), each given once and
// stepped only while its switch is on.
//
// It also samples the named satellites' orbits by SGP4 over one period
// centred on a time, for their orbit lines.
//
// Messages in:  { type: 'gp', set, csv } | { type: 'step', t, sets } | { type: 'orbits', t, ids, samples }
// Messages out: { type: 'ready', set, count } | { type: 'step', t, sets, bufs } | { type: 'orbits', t, ids, buf, periods }

import { parseGpCsv, satrecOf, stateTeme, temeToEqj, apply } from '../physics/satellites.js';

const MU = 398600.8;                 // km^3/s^2: WGS-72's, SGP4's own
type Sat = ReturnType<typeof satrecOf>;
const sets = new Map<string, Sat[]>();
const byId = new Map<number, Sat>();

// The ellipse through (r, v), as the shader reads it: 10 floats from o.
function ellipse(r: number[], v: number[], out: Float32Array, o: number): void {
  const rn = Math.hypot(r[0], r[1], r[2]), v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const a = 1 / (2 / rn - v2 / MU);
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const hn = Math.hypot(h[0], h[1], h[2]);
  if (!(a > 0) || !(hn > 0)) { out.fill(0, o, o + 10); return; }
  // Eccentricity vector (v x h)/mu - r/|r|.
  const ev = [(v[1] * h[2] - v[2] * h[1]) / MU - r[0] / rn, (v[2] * h[0] - v[0] * h[2]) / MU - r[1] / rn, (v[0] * h[1] - v[1] * h[0]) / MU - r[2] / rn];
  let e = Math.hypot(ev[0], ev[1], ev[2]);
  const W = [h[0] / hn, h[1] / hn, h[2] / hn];
  let P: number[], E: number;
  if (e < 1e-9) { e = 0; P = [r[0] / rn, r[1] / rn, r[2] / rn]; E = 0; }
  else {
    P = [ev[0] / e, ev[1] / e, ev[2] / e];
    const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
    E = Math.atan2(rv / Math.sqrt(MU * a), 1 - rn / a);
  }
  if (!(e < 1)) { out.fill(0, o, o + 10); return; }
  const Q = [W[1] * P[2] - W[2] * P[1], W[2] * P[0] - W[0] * P[2], W[0] * P[1] - W[1] * P[0]];
  out[o] = P[0]; out[o + 1] = P[1]; out[o + 2] = P[2];
  out[o + 3] = Q[0]; out[o + 4] = Q[1]; out[o + 5] = Q[2];
  out[o + 6] = a; out[o + 7] = e; out[o + 8] = E - e * Math.sin(E); out[o + 9] = Math.sqrt(MU / (a * a * a));
}

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'gp') {
    for (const s of sets.get(m.set) ?? []) byId.delete(s.omm.NORAD_CAT_ID);
    const sats = parseGpCsv(m.csv).map(satrecOf);
    sets.set(m.set, sats);
    for (const s of sats) byId.set(s.omm.NORAD_CAT_ID, s);
    (self as unknown as Worker).postMessage({ type: 'ready', set: m.set, count: sats.length });
  } else if (m.type === 'step') {
    const t: number = m.t, M = temeToEqj(t), names: string[] = m.sets.filter((k: string) => sets.has(k)), bufs: Float32Array[] = [];
    for (const name of names) {
      const sats = sets.get(name)!, buf = new Float32Array(sats.length * 10);
      for (let k = 0; k < sats.length; k++) {
        const s = stateTeme(sats[k], t);
        if (s) ellipse(apply(M, s.r), apply(M, s.v), buf, k * 10);
      }
      bufs.push(buf);
    }
    (self as unknown as Worker).postMessage({ type: 'step', t, sets: names, bufs }, bufs.map((b) => b.buffer));
  } else if (m.type === 'orbits') {
    const t: number = m.t, ids: number[] = m.ids, n: number = m.samples, M = temeToEqj(t);
    const buf = new Float32Array(ids.length * n * 3), periods = new Float64Array(ids.length);
    ids.forEach((id, j) => {
      const s = byId.get(id);
      if (!s) return;
      const T = 86400e3 / s.omm.MEAN_MOTION;
      periods[j] = T;
      let last = [0, 0, 0];
      for (let k = 0; k < n; k++) {
        const st = stateTeme(s, t + (k / (n - 1) - 0.5) * T);
        if (st) last = apply(M, st.r);
        buf.set(last, (j * n + k) * 3);
      }
    });
    (self as unknown as Worker).postMessage({ type: 'orbits', t, ids, buf, periods }, [buf.buffer, periods.buffer]);
  }
};
