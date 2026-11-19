// validation/flown.lib.mjs
//
// What the real missions beyond Artemis share (docs/frontend/mission.md#real-missions):
// a flown trajectory from JPL Horizons, the kernel flying it step by step
// to find the burns, and the coast arcs between them flown and compared.
// Each mission's own facts (its Horizons id, span, burns as published) are
// in missions.data.mjs; this is the machinery. Node only.
//
// States are J2000 equatorial (Horizons' ICRF), km and km/s, about the
// mission's centre: 'sun' (heliocentric, as the kernel flies) or 'earth'.
// Times are Unix ms, UTC.

import '@digital-orrery/physics/deNode.js';
import fs from 'node:fs';
import dns from 'node:dns';
import { createState, advance } from '@digital-orrery/physics/nbody.js';
import { solarSystemBodies } from '@digital-orrery/physics/bodies.js';
import { KERNEL_EPOCH_MS, kernelSeconds, aimTo, stepCraft } from '@digital-orrery/physics/kernelHost.js';
import { makeEnvironment } from '@digital-orrery/physics/environment.js';
import { helioStateEqj } from '@digital-orrery/physics/ephemeris.js';
import { dot, cross, norm, unit } from '@digital-orrery/physics/vec.js';
export { dot, cross, norm, unit };

dns.setDefaultResultOrder('ipv4first');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
export const CACHE_ROOT = `${process.env.HOME}/.cache/digital-orrery/missions`;

export const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
export const kt = (ms) => kernelSeconds(new Date(ms));
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const opts = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 };

// Horizons' code for a centre the app knows.
export const HORIZONS_CENTRE = { sun: '500@10', earth: '500@399', moon: '500@301', mercury: '500@199', venus: '500@299', mars: '500@499', jupiter: '500@599' };

// A body's heliocentric state in the app (the Sun is the origin: the
// ephemeris's own 'sun' is the barycentre's offset, not this).
export function bodyState(key, ms) {
  if (key === 'sun') return { r: [0, 0, 0], v: [0, 0, 0] };
  return helioStateEqj(key, new Date(ms));
}
// A kernel state from a row about centre, and back.
export function helioOf(p, centre) {
  const c = bodyState(centre, p.ms);
  return createState(add(p.r, c.r), add(p.v, c.v), kt(p.ms));
}
export function about(state, ms, centre) {
  const c = bodyState(centre, ms);
  return { r: sub(state.r, c.r), v: sub(state.v, c.v) };
}
// Row p (about centre) carried by the kernel's gravity alone (or with an
// environment) to ms; the result about toCentre (the same, by default).
export function coast(p, ms, centre, env = null, toCentre = centre) {
  const s = helioOf(p, centre);
  advance(s, kt(ms), env ? { ...opts, extraAccel: (t, r, out, mid, v) => { out[0] = out[1] = out[2] = 0; return env(t, r, v, out); }, stepCap: env.stepCap } : opts);
  return about(s, ms, toCentre);
}

// The local orbital frame about a body: prograde, in-plane (prograde x
// normal) and the orbit normal, as realMission.js and craft.js steer.
export function vnb(r, v) {
  const V = unit(v), N = unit(cross(r, v));
  return [V, cross(V, N), N];
}

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
export const toRow = (s) => ({ ms: Date.parse(s[0]), r: s.slice(1, 4), v: s.slice(4, 7) });

// Horizons vectors for command about centre, start to stop ('YYYY-MM-DD
// HH:MM', UTC), every step ('10m', '1h', or 's10' for every 10 s, which
// Horizons is asked for as that many equal intervals). Cached in
// CACHE_ROOT/<dir>; a span over maxRows rows is asked for in pieces.
export async function vectors(dir, command, centre, start, stop, step, { maxRows = 80000 } = {}) {
  const cache = `${CACHE_ROOT}/${dir}`;
  fs.mkdirSync(cache, { recursive: true });
  const t0 = Date.parse(start.replace(' ', 'T') + 'Z'), t1 = Date.parse(stop.replace(' ', 'T') + 'Z');
  const stepS = step.startsWith('s') ? Number(step.slice(1)) : step.endsWith('m') ? 60 * Number(step.slice(0, -1)) : step.endsWith('h') ? 3600 * Number(step.slice(0, -1)) : NaN;
  if (!(stepS > 0)) throw new Error(`step ${step}`);
  const rows = (t1 - t0) / 1000 / stepS;
  if (rows > maxRows) {
    // In pieces, each a whole number of steps.
    const piece = Math.floor(maxRows) * stepS * 1000, out = [];
    for (let a = t0; a < t1; a += piece) {
      const b = Math.min(t1, a + piece);
      const part = await vectors(dir, command, centre, iso(a), iso(b), step, { maxRows });
      out.push(...(out.length ? part.slice(1) : part));
    }
    return out;
  }
  const stepSize = step.startsWith('s') ? String(Math.round(rows)) : step;
  const q = {
    format: 'text', COMMAND: `'${command}'`, EPHEM_TYPE: "'VECTORS'", CENTER: `'${HORIZONS_CENTRE[centre] ?? centre}'`,
    REF_PLANE: "'FRAME'", REF_SYSTEM: "'ICRF'", VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'",
    CSV_FORMAT: "'YES'", VEC_LABELS: "'NO'", TIME_TYPE: "'UT'", TIME_DIGITS: "'FRACSEC'",
    START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: `'${stepSize}'`,
  };
  const name = `${cache}/${command}@${centre}_${start}_${stop}_${step}.txt`.replace(/[ :]/g, '-');
  let text;
  if (fs.existsSync(name)) text = fs.readFileSync(name, 'utf8');
  else {
    const url = `${API}?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'digital-orrery trajectory validation' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    if (!text.includes('$$SOE')) throw new Error(`no data from Horizons for ${command} ${start} to ${stop}:\n${text.slice(-800)}`);
    fs.writeFileSync(name, text);
    await new Promise((r) => setTimeout(r, 1500));
  }
  return parseHorizons(text);
}
// 'YYYY-MM-DD HH:MM', with the seconds when there are any.
export const iso = (ms) => new Date(ms).toISOString().slice(0, ms % 60e3 ? 19 : 16).replace('T', ' ');

// Each step from one row to the next flown by the kernel's gravity alone:
// what is left in the next row's velocity (km/s) is thrust, or a join
// between navigation solutions, or the forces the kernel leaves out.
// env: the full environment (environment.js), for steps near a planet,
// where its field beyond J2 would otherwise look like thrust.
export function stepResiduals(rows, centre, env = null) {
  const out = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const g = coast(rows[i], rows[i + 1].ms, centre, env);
    out.push({ i, ms: rows[i].ms, sec: (rows[i + 1].ms - rows[i].ms) / 1000, dv: sub(rows[i + 1].v, g.v), dr: sub(rows[i + 1].r, g.r) });
  }
  return out;
}

// Events in the step residuals: runs of steps whose velocity residual is
// over threshold (km/s), steps within gap of each other joined. Each:
// { a, b (step indices), peak, net (km/s), kind }. A burn spreads its change
// over its steps; a join between navigation solutions is one step, so an
// event whose largest step holds over 1.5 times the whole change is a join.
// drKm: a step whose position is that far from the kernel's is an event too
// (MESSENGER's solutions join with jumps of up to 21 km and a few mm/s).
export function findEvents(steps, threshold, gap = 3, drKm = Infinity) {
  const events = [];
  steps.forEach((s, i) => {
    const d = norm(s.dv);
    if (d <= threshold && norm(s.dr) <= drKm) return;
    const e = events.at(-1);
    if (e && i - e.b <= gap) { e.b = i; e.peak = Math.max(e.peak, d); } else events.push({ a: i, b: i, peak: d });
  });
  for (const e of events) {
    e.net = [0, 0, 0];
    for (let i = e.a; i <= e.b; i++) e.net = add(e.net, steps[i].dv);
    e.kind = e.peak <= 1.5 * norm(e.net) ? 'burn' : 'join';
  }
  return events;
}

// Where Horizons' interpolation rings across a join between solutions:
// runs of steps whose residuals point against their neighbours' (cosine
// under -0.5), each over minKms and twenty times the window's median. A
// burn's steps all point the same way; ringing swings back and forth, its
// steps' magnitudes large and their sum small (LRO's join two minutes
// after lunar orbit insertion: 450 m/s of steps, 3.6 m/s in sum). Each
// region [first, last] step index, a step wider either side.
export function ringingRegions(steps, minKms = 1e-6) {
  if (!steps.length) return [];
  const n = steps.map((s) => norm(s.dv));
  const median = [...n].sort((a, b) => a - b)[n.length >> 1];
  const big = (i) => n[i] > minKms && n[i] > 20 * median;
  const regions = [];
  for (let i = 0; i + 1 < steps.length; i++) {
    if (!(big(i) && big(i + 1) && dot(steps[i].dv, steps[i + 1].dv) < -0.5 * n[i] * n[i + 1])) continue;
    const r = regions.at(-1);
    if (r && i - r[1] <= 3) r[1] = i + 1; else regions.push([i, i + 1]);
  }
  return regions.map(([a, b]) => [Math.max(0, a - 1), Math.min(steps.length - 1, b + 1)]);
}

// A burn the samples can't resolve in time, fitted as the engine would fly
// it: a steady push of seconds sec centred on the span (msFrom, msTo) the
// samples ring across, along one J2000 direction, its change solved for (by
// the kernel's aim, kernelHost.aimTo) so that the craft flown from a clean
// sample ten minutes before the span reaches the sample half an hour after
// it (a minute after, the position hardly constrains the velocity). rows: about key; craft: { mass, area, cr } as the environment takes
// it. Returns { t0, t1 (ms), dv (km/s), missKm, offMms (the velocity left
// at the sample after: how well one steady push stands for the burn) }, or
// null.
export function fitSteadyBurn(rows, msFrom, msTo, key, sec, craft, { scanS = 600, stepS = 30, centreMs = null } = {}) {
  // The centre: given, or the one within scanS of the span's middle that
  // leaves the least velocity at the far sample.
  const fitAt = (mid) => {
    const t0 = Math.round(mid - sec * 500), t1 = t0 + Math.round(sec * 1000);
    const pre = [...rows].reverse().find((p) => p.ms <= Math.min(msFrom, t0) - 600e3), post = rows.find((p) => p.ms >= Math.max(msTo, t1) + 1800e3);
    if (!pre || !post) return null;
    const env = makeEnvironment(sys, craft);
    const s0 = coast(pre, t0, key, env, 'sun'), B = bodyState(key, post.ms);
    const target = add(post.r, B.r), vTarget = add(post.v, B.v);
    const k = aimTo(sys, { r: s0.r, v: s0.v, t0: kt(t0), T: kt(post.ms), target, env: craft, spread: (t1 - t0) / 1000, damped: true, rounds: 8 });
    if (!k) return null;
    const n = norm(k.dv);
    const res = stepCraft(sys, { id: 0, version: 0, r: s0.r, v: s0.v, t: kt(t0), tEnd: kt(post.ms), primary: null, maxSteps: 1e6, env: craft,
      burns: [{ t0: kt(t0), t1: kt(t1), dir: k.dv.map((x) => x / n), F: n * 1000 / ((t1 - t0) / 1000), m0: 1, mdot: 0, scripted: true }] });
    return { t0, t1, dv: k.dv, missKm: k.after, offMms: norm(sub(res.v, vTarget)) * 1e6, centreMs: mid };
  };
  if (centreMs !== null) return fitAt(centreMs);
  const mid0 = (msFrom + msTo) / 2;
  let best = null;
  for (let d = -scanS; d <= scanS; d += stepS) {
    const f = fitAt(mid0 + d * 1000);
    if (f && f.missKm < 0.1 && (!best || f.offMms < best.offMms)) best = f;
  }
  return best;
}

// A burn the samples can't resolve in time (LRO's after lunar orbit
// insertion, which Horizons' interpolation rings across): one steady push
// of the whole change dv (km/s, in the axes of the rows' centre `key`) from
// msFrom to msTo, along it in the orbital frame about key at the middle
// (p: the state there), or in J2000 axes. The shape burnFromSamples returns.
export function steadyBurn(msFrom, msTo, dv, p, key, eqj = false) {
  const m = norm(dv), sec = (msTo - msFrom) / 1000;
  const L = eqj || !p ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : frameAbout(key, p, (msFrom + msTo) / 2, key);
  return { intervals: [[msFrom, msTo, ...L.map((ax) => Math.round(dot(dv, ax) / m * 1e6) / 1e6), Math.round(m / sec * 1e9) / 1e6]], dv, ignitionMs: msFrom, cutoffMs: msTo, peak: m / sec * 1000 };
}

// A burn from samples every few seconds through it (rows), as the app's
// mission files hold them: each interval's change beyond gravity, steered in
// the orbital frame about the body `about`. The burn runs from the first
// interval over a twentieth of the peak to the last (or, given floor, km/s
// in a step, over that: MESSENGER's burns open and close on the small
// thrusters, at a few percent of the main engine's push). Returns { intervals
// ([t0, t1, prograde, in-plane, normal, m/s^2]; with eqj, the direction in
// J2000 axes instead), dv (km/s, about centre's axes), along (km/s: the
// change summed along the path, which the rocket equation counts; over
// |dv| for a burn steered as it fires, as MESSENGER's orbit insertion
// turned 30 degrees), ignitionMs, cutoffMs }.
export function burnFromSamples(rows, centre, aboutKey, env = null, eqj = false, floor = null) {
  const steps = rows.slice(0, -1).map((a, i) => {
    const b = rows[i + 1], sec = (b.ms - a.ms) / 1000, dv = sub(b.v, coast(a, b.ms, centre, env).v);
    return { a, b, sec, dv, acc: norm(dv) / sec };
  });
  const peak = Math.max(...steps.map((s) => s.acc));
  const on = steps.map((s) => (floor ? norm(s.dv) > floor : s.acc > peak / 20));
  const first = on.indexOf(true), last = on.lastIndexOf(true);
  const used = steps.slice(first, last + 1);
  const dv = used.reduce((acc, s) => add(acc, s.dv), [0, 0, 0]);
  const along = used.reduce((acc, s) => acc + norm(s.dv), 0);
  const intervals = used.map((s) => {
    const mid = hermiteMid(s.a, s.b, s.sec), msMid = (s.a.ms + s.b.ms) / 2;
    const L = eqj ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : frameAbout(aboutKey, mid, msMid, centre), m = norm(s.dv);
    return [s.a.ms, s.b.ms, ...L.map((ax) => Math.round(dot(s.dv, ax) / m * 1e6) / 1e6), Math.round(s.acc * 1e9) / 1e6];
  });
  // Ignition and cutoff: the first and last step over half the peak.
  const half = steps.map((s) => s.acc > peak / 2);
  return { intervals, dv, along, ignitionMs: steps[half.indexOf(true)].a.ms, cutoffMs: steps[half.lastIndexOf(true)].b.ms, peak: peak * 1000 };
}

// The state halfway between two samples h seconds apart, by cubic Hermite.
export const hermiteMid = (a, b, h) => ({
  r: [0, 1, 2].map((k) => (a.r[k] + b.r[k]) / 2 + (a.v[k] - b.v[k]) * h / 8),
  v: [0, 1, 2].map((k) => 1.5 * (b.r[k] - a.r[k]) / h - (a.v[k] + b.v[k]) / 4),
});
// The orbital frame about body key, at a state about centre.
export function frameAbout(key, p, ms, centre) {
  const B = bodyState(key, ms), C = bodyState(centre, ms);
  return vnb(sub(add(p.r, C.r), B.r), sub(add(p.v, C.v), B.v));
}
// A row's distance from a body's centre (km).
export function distanceTo(key, p, centre) {
  const B = bodyState(key, p.ms), C = bodyState(centre, p.ms);
  return norm(sub(add(p.r, C.r), B.r));
}
// The closest approach to body key among rows, refined between samples by
// the kernel from the sample before it: { d (km from the centre), ms }.
export function closestApproach(key, rows, centre, from = -Infinity, to = Infinity) {
  let best = null;
  rows.forEach((p, i) => {
    if (p.ms < from || p.ms > to) return;
    const d = distanceTo(key, p, centre);
    if (!best || d < best.d) best = { d, ms: p.ms, i };
  });
  if (!best) return null;
  // Second by second about the sample nearest it, flown from the one before.
  const a = rows[Math.max(0, best.i - 1)], z = rows[Math.min(rows.length - 1, best.i + 1)];
  for (let ms = a.ms; ms <= z.ms; ms += 1000) {
    const g = coast(a, ms, centre), d = distanceTo(key, { ms, ...g }, centre);
    if (d < best.d) best = { ...best, d, ms };
  }
  return best;
}

// Sunlight fitted piece by piece along a coast arc (MESSENGER's: it trimmed
// its course by tilting its sunshade and arrays, "solar sailing", and its
// push changed with its attitude). The arc is flown once from its first
// row a (about a.about) in env (the full environment, its sunlight off),
// through obs (rows about their own .about, in time order); the arc is cut
// into pieces of about pieceDays, and in each a push of 1/r^2 from the Sun
// along the local radial, along-track and normal axes (radial alone for an
// arc under 5 days, where the three are not told apart). Each push is
// solved for by least squares on every obs position, linearised about the
// flight with no sunlight. The strengths are Cr A/m (m^2/kg) at 1 AU.
// Returns { pieces: [{ from, to (ms), k: [R, T, N] }], base, fitted (km at
// each obs: no sunlight, fitted) }.
export function fitSunlightPieces(a, obs, env, pieceDays) {
  const AU = 1.495978707e8, P1 = 1361 / 299792458 / 1000;   // km/s^2 per m^2/kg at 1 AU
  const b = obs.at(-1), days = (b.ms - a.ms) / 864e5;
  const n = Math.max(1, Math.round(days / pieceDays)), axes = days < 5 ? [0] : [0, 1, 2];
  const edges = Array.from({ length: n + 1 }, (_, i) => a.ms + (b.ms - a.ms) * i / n);
  const pushed = (ax, t0, t1) => {
    const f = (t, r, v, out) => {
      env(t, r, v, out);
      if (ax < 0 || t < t0 || t >= t1) return out;
      const d = Math.hypot(r[0], r[1], r[2]), R = [r[0] / d, r[1] / d, r[2] / d], N = unit(cross(r, v)), T = cross(N, R), u = [R, T, N][ax], k = P1 * AU * AU / (d * d);
      out[0] += k * u[0]; out[1] += k * u[1]; out[2] += k * u[2];
      return out;
    };
    f.stepCap = env.stepCap;
    return f;
  };
  // Flown from state s0 through marks; returns each mark's state about its body.
  const fly = (s0, marks, e) => {
    const s = createState([...s0.r], [...s0.v], s0.t), o = { ...opts, extraAccel: (t, r, out, mid, v) => { out[0] = out[1] = out[2] = 0; return e(t, r, v, out); }, stepCap: e.stepCap };
    return marks.map((m) => { if (kt(m.ms) > s.t) advance(s, kt(m.ms), o); return { ...about(s, m.ms, m.about), s: createState([...s.r], [...s.v], s.t) }; });
  };
  const s0 = helioOf(a, a.about);
  const cuts = edges.slice(1, -1).map((ms) => ({ ms, about: 'sun', cut: true }));
  const marks = [...obs, ...cuts].sort((x, y) => x.ms - y.ms);
  const flown = fly(s0, marks, env);
  const base = obs.map((o) => sub(flown[marks.indexOf(o)].r, o.r));
  const startOf = (j) => (j === 0 ? s0 : flown[marks.indexOf(cuts[j - 1])].s);
  // Each push's effect on every obs (zero before its piece).
  const cols = [];
  for (let j = 0; j < n; j++) for (const ax of axes) {
    const later = obs.filter((o) => o.ms > edges[j]), r = fly(startOf(j), later, pushed(ax, kt(edges[j]), kt(edges[j + 1])));
    cols.push(obs.map((o, i) => { const k = later.indexOf(o); return k < 0 ? [0, 0, 0] : sub(sub(r[k].r, o.r), base[i]); }));
  }
  const m = cols.length, A = Array.from({ length: m }, () => Array(m + 1).fill(0));
  obs.forEach((_, i) => { for (let p = 0; p < m; p++) { A[p][m] -= dot(cols[p][i], base[i]); for (let q = p; q < m; q++) { A[p][q] += dot(cols[p][i], cols[q][i]); A[q][p] = A[p][q]; } } });
  // Gaussian elimination with partial pivoting.
  for (let p = 0; p < m; p++) {
    let w = p; for (let q = p + 1; q < m; q++) if (Math.abs(A[q][p]) > Math.abs(A[w][p])) w = q;
    [A[p], A[w]] = [A[w], A[p]];
    for (let q = p + 1; q < m; q++) { const f = A[q][p] / A[p][p]; for (let c = p; c <= m; c++) A[q][c] -= f * A[p][c]; }
  }
  const x = Array(m).fill(0);
  for (let p = m - 1; p >= 0; p--) { let t = A[p][m]; for (let c = p + 1; c < m; c++) t -= A[p][c] * x[c]; x[p] = t / A[p][p]; }
  const pieces = edges.slice(0, -1).map((from, j) => ({ from, to: edges[j + 1], k: [0, 1, 2].map((ax) => { const c = axes.indexOf(ax); return c < 0 ? 0 : x[j * axes.length + c]; }) }));
  const fitted = obs.map((_, i) => norm(base[i].map((y, c) => y + cols.reduce((acc, col, p) => acc + x[p] * col[i][c], 0))));
  return { pieces, base: base.map(norm), fitted };
}
