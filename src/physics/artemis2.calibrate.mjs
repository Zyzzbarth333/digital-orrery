// src/physics/artemis2.calibrate.mjs
//
// Calibration experiments behind docs/validation/artemis2.md, "What does not
// help". Not part of npm test; run by hand:
//
//   node src/physics/artemis2.calibrate.mjs
//
// A. An empirical push model, fitted on one coast arc, used to predict the
//    next: constant in inertial axes, sunward only, constant in a Sun-
//    ecliptic frame, or sunward plus Earth-radial.
// B. The same models fitted on the whole mission up to a cut (burns as the
//    BET shows them), then flown to entry interface.
// C. Earth's J3 and J4 (EGM2008) on the arcs nearest Earth.
import './deNode.js';
import fs from 'node:fs';
import { createState, advance } from './nbody.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';
const bet = JSON.parse(fs.readFileSync(new URL('./fixtures/artemis2_bet.json', import.meta.url)));
const rows = bet.states.map((s) => ({ ms: Date.parse(s[0]), r: s.slice(2, 5), v: s.slice(5, 8) }));
const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
const EARTH = sys.bodiesAt(0).findIndex((b) => b.key === 'earth');
const kt = (ms) => (ms - KERNEL_EPOCH_MS) / 1000;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]), unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const EPS = 23.4392911 * Math.PI / 180, K = [0, -Math.sin(EPS), Math.cos(EPS)];   // ecliptic north in EQJ
const ARCS = [
  ['2026-04-03T00:02:48.802Z', '2026-04-05T01:20:00Z'], ['2026-04-05T01:50:00Z', '2026-04-06T03:00:00Z'],
  ['2026-04-06T03:10:00Z', '2026-04-08T00:00:00Z'], ['2026-04-08T00:10:00Z', '2026-04-10T02:50:00Z'],
  ['2026-04-10T03:00:00Z', '2026-04-10T18:50:00Z'], ['2026-04-10T19:00:00Z', '2026-04-10T23:29:00Z'],
];
// Basis vectors of each model at (t, heliocentric r).
const MODELS = {
  inertial: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  sunward: (t, r) => [unit([-r[0], -r[1], -r[2]])],
  sunFrame: (t, r) => { const s = unit([-r[0], -r[1], -r[2]]), y = unit(cross(K, s)); return [s, y, cross(s, y)]; },
  sunAndEarth: (t, r) => { const e = sys.bodiesAt(t)[EARTH].r; return [unit([-r[0], -r[1], -r[2]]), unit(sub(r, e))]; },
};
const helioOf = (p) => { const e = helioStateEqj('earth', new Date(p.ms)); return createState(add(p.r, e.r), add(p.v, e.v), kt(p.ms)); };
// Fly from row `start` across rows (with burns applied at given row times), returning geocentric errors.
function fly(pts, model, p, burns = []) {
  const st = helioOf(pts[0]);
  const ex = model && p ? (t, r, out) => { const B = MODELS[model](t, r); out[0] = out[1] = out[2] = 0; B.forEach((b, i) => { out[0] += p[i] * b[0]; out[1] += p[i] * b[1]; out[2] += p[i] * b[2]; }); return out; } : null;
  const opts = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7, extraAccel: ex };
  return pts.map((q, i) => {
    if (i) advance(st, kt(q.ms), opts);
    const b = burns.find((x) => x.to === q.ms); if (b) for (let k = 0; k < 3; k++) { st.r[k] += b.dr[k]; st.v[k] += b.dv[k]; }
    const e = helioStateEqj('earth', new Date(q.ms));
    return sub(sub(st.r, e.r), q.r);
  });
}
const rowsIn = (a, b) => rows.filter((p) => p.ms >= Date.parse(a) && p.ms <= Date.parse(b));
function fit(pts, model, burns = []) {
  const n = MODELS[model](kt(pts[0].ms), helioOf(pts[0]).r).length, eps = 1e-9;
  const base = fly(pts, model, new Array(n).fill(0), burns);
  const J = [...Array(n).keys()].map((k) => { const p = new Array(n).fill(0); p[k] = eps; return fly(pts, model, p, burns).map((d, i) => sub(d, base[i]).map((x) => x / eps)); });
  const N = [...Array(n)].map(() => new Array(n).fill(0)), g = new Array(n).fill(0);
  base.forEach((d, i) => { for (let a = 0; a < n; a++) { g[a] -= J[a][i][0] * d[0] + J[a][i][1] * d[1] + J[a][i][2] * d[2]; for (let c = 0; c < n; c++) N[a][c] += J[a][i][0] * J[c][i][0] + J[a][i][1] * J[c][i][1] + J[a][i][2] * J[c][i][2]; } });
  // Gaussian elimination
  const A = N.map((row, i) => [...row, g[i]]);
  for (let i = 0; i < n; i++) { let m = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k; [A[i], A[m]] = [A[m], A[i]]; for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let c = i; c <= n; c++) A[k][c] -= f * A[i][c]; } }
  const x = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s = A[i][n]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
// Burns as the BET shows them (gravity-only bridge).
const opts0 = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 };
const burns = ARCS.slice(1).map((arc, i) => {
  const a = rows.filter((p) => p.ms <= Date.parse(ARCS[i][1])).at(-1), b = rows.find((p) => p.ms >= Date.parse(arc[0]));
  const g = helioOf(a); advance(g, kt(b.ms), opts0); const e = helioStateEqj('earth', new Date(b.ms));
  return { to: b.ms, dr: sub(b.r, sub(g.r, e.r)), dv: sub(b.v, sub(g.v, e.v)) };
});
const fmt = (x) => x.toFixed(1).padStart(8);
// A. Cross-arc: fit on arc k (whole), predict arc k+1.
console.log('A. fit on one arc, predict the next arc (end error km)');
console.log('arc→next   none' + Object.keys(MODELS).map((m) => m.padStart(12)).join(''));
for (let k = 1; k < ARCS.length - 1; k++) {
  const train = rowsIn(...ARCS[k]), test = rowsIn(...ARCS[k + 1]);
  const line = [norm(fly(test, null, null).at(-1))];
  for (const m of Object.keys(MODELS)) line.push(norm(fly(test, m, fit(train, m)).at(-1)));
  console.log(`${k + 1}→${k + 2}      ` + line.map((x) => x.toFixed(1).padStart(12)).join(''));
}
// B. Whole mission: fit on the coast after TLI up to time T (with burns), fly the rest.
console.log('\nB. whole mission with burns; push fitted on data up to the cut, then predicted (km off at entry interface, and worst after the cut)');
const mission = rowsIn(ARCS[0][0], ARCS.at(-1)[1]);
for (const cut of ['2026-04-05T01:20:00Z', '2026-04-06T03:00:00Z']) {
  const train = mission.filter((p) => p.ms <= Date.parse(cut));
  for (const m of [null, ...Object.keys(MODELS)]) {
    const p = m ? fit(train, m, burns) : null;
    const d = fly(mission, m, p, burns);
    const after = d.filter((_, i) => mission[i].ms > Date.parse(cut));
    console.log(`cut ${cut.slice(5, 10)} ${String(m).padEnd(12)} entry ${fmt(norm(d.at(-1)))}  worst after ${fmt(Math.max(...after.map(norm)))}  p ${p ? p.map((x) => (x * 1e9).toFixed(2)).join(',') : '-'}`);
  }
}

// C. Earth's J3 and J4: the acceleration is the numerical gradient of the
// zonal potential, so no remembered formula is involved.
console.log('\nC. Earth\'s J3 and J4 (EGM2008), end error km');
const E = sys.bodiesAt(0)[EARTH];
const R = 6378.1363, MU = E.mu;
const J3 = -Math.sqrt(7) * 9.57161207093e-7, J4 = -3 * 5.39965866638e-7;   // EGM2008, unnormalised: J_n = -sqrt(2n+1) C_n0
const P3 = (s) => 0.5 * (5 * s ** 3 - 3 * s), P4 = (s) => (35 * s ** 4 - 30 * s * s + 3) / 8;
const U = (d, p) => { const r = norm(d), s = (d[0] * p[0] + d[1] * p[1] + d[2] * p[2]) / r; return -(MU / r) * (J3 * (R / r) ** 3 * P3(s) + J4 * (R / r) ** 4 * P4(s)); };
const extra = (t, r, out) => {
  const b = sys.bodiesAt(t).find((x) => x.key === 'earth'), d = sub(r, b.r), h = 1e-3;
  if (norm(d) > 100 * R) { out[0] = out[1] = out[2] = 0; return out; }
  for (let k = 0; k < 3; k++) { const a = [...d], c = [...d]; a[k] += h; c[k] -= h; out[k] = (U(a, b.pole) - U(c, b.pole)) / (2 * h); }
  return out;
};
function arc(a, b, j34) {
  const pts = rows.filter((p) => p.ms >= Date.parse(a) && p.ms <= Date.parse(b)), st = helioOf(pts[0]);
  const opts = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7, extraAccel: j34 ? extra : null };
  let last;
  for (const [i, q] of pts.entries()) { if (i) advance(st, kt(q.ms), opts); const e = helioStateEqj('earth', new Date(q.ms)); last = norm(sub(sub(st.r, e.r), q.r)); }
  return last;
}
for (const [n, a, b] of [['arc 1 (after TLI)', '2026-04-03T00:02:48.802Z', '2026-04-05T01:20:00Z'], ['arc 1, first 6 h', '2026-04-03T00:02:48.802Z', '2026-04-03T06:00:00Z'], ['final approach', '2026-04-10T19:00:00Z', '2026-04-10T23:29:00Z'], ['return', '2026-04-08T00:10:00Z', '2026-04-10T02:50:00Z']]) {
  console.log(n.padEnd(20), 'J2 only', arc(a, b, false).toFixed(3), 'km | + J3, J4', arc(a, b, true).toFixed(3), 'km');
}
