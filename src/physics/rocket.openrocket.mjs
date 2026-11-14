// src/physics/rocket.openrocket.mjs
//
// Turns OpenRocket's flights of two of its own example designs into the
// shared inputs and results of the ROCKET tab's cross-check
// (fixtures/rocket_xcheck.json, read by rocket.xcheck.test.mjs and
// tools/rocketpy/fly.py):
//
//   npm run oracle:openrocket
//
// It runs tools/openrocket/ORRun.java against the local OpenRocket jar
// (~/OpenRocket/jar/OpenRocket-24.12.jar; OpenRocket is GPL-3.0, used only
// as an outside oracle: nothing of it is copied, only the numbers it
// computes are kept). Each flight is calm and straight up from sea level
// on the equator in the ISA atmosphere, with a fixed random seed and a
// 5 ms step. Per vehicle it keeps:
// - the stages, bottom first. A stage's thrust curve is its motors' curves
//   as OpenRocket flew them, from the moment the stage below separated (so
//   it starts with any wait before its own ignition) to its own
//   separation. Its propellant is the mass OpenRocket's flight lost while
//   it was the bottom stage, and its dry mass what dropped away when it
//   separated: OpenRocket's own mass history, which for the two-stage
//   example loses more than its motors hold (ratedProp, their launch less
//   burnout mass, is kept beside it). The payload is what reaches apogee;
// - the drag: the reference area, and the drag coefficient against Mach
//   while burning and while coasting (OpenRocket's base drag differs with
//   an engine lit), and against time, to replay;
// - the gravity it flew in;
// - the results: apogee, the time to it (where the climb rate crosses
//   zero, between OpenRocket's samples), the top speed and Mach, and the
//   height and speed every half second.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const HOME = process.env.HOME, JAR = `${HOME}/OpenRocket/jar/OpenRocket-24.12.jar`;
const WORK = `${HOME}/.cache/digital-orrery/openrocket`;
const DESIGNS = [
  { key: 'model', file: 'A simple model rocket.ork', name: 'OpenRocket example: a simple model rocket (one stage)' },
  { key: 'twostage', file: 'Two stage high power rocket.ork', name: 'OpenRocket example: a two-stage high-power rocket' },
];

if (!fs.existsSync(JAR)) throw new Error(`no OpenRocket jar at ${JAR}`);
fs.mkdirSync(`${WORK}/out`, { recursive: true });
fs.mkdirSync(`${WORK}/designs`, { recursive: true });
execFileSync('javac', ['-nowarn', '-cp', JAR, '-d', `${WORK}/out`, new URL('../../tools/openrocket/ORRun.java', import.meta.url).pathname]);

// A motor's thrust (N) at time tm (s) from its ignition: linear between the
// points of its curve, as OpenRocket takes it, and nothing outside it.
const thrustAt = (mo, tm) => {
  const ts = mo.time, fs_ = mo.thrust;
  if (!(tm >= ts[0]) || tm > ts.at(-1)) return 0;
  let i = 1;
  while (i < ts.length - 1 && ts[i] < tm) i++;
  return fs_[i - 1] + (fs_[i] - fs_[i - 1]) * (tm - ts[i - 1]) / (ts[i] - ts[i - 1]);
};
const round = (x, n) => +x.toFixed(n);

const out = { source: 'OpenRocket 24.12 (GPL-3.0, run as an outside oracle), its bundled example designs, flown calm and straight up from sea level on the equator in the ISA atmosphere by tools/openrocket/ORRun.java', vehicles: {} };
for (const d of DESIGNS) {
  const ork = `${WORK}/designs/${d.file}`;
  if (!fs.existsSync(ork)) execFileSync('unzip', ['-o', '-j', '-q', JAR, `datafiles/examples/${d.file}`, '-d', `${WORK}/designs`]);
  const json = `${WORK}/${d.key}.json`;
  execFileSync('java', ['-Djava.awt.headless=true', '-cp', `${JAR}:${WORK}/out`, 'ORRun', ork, '0', json], { stdio: 'ignore' });
  const f = JSON.parse(fs.readFileSync(json, 'utf8'));
  const ix = Object.fromEntries(f.columns.map((n, i) => [n, i])), all = f.rows;
  // The top of the climb: where the climb rate crosses zero, between samples.
  const k = all.findLastIndex((r) => r[ix.vz] > 0);
  const [a, b] = [all[k], all[k + 1]];
  const apogeeTime = a[0] + a[ix.vz] / (a[ix.vz] - b[ix.vz]) * (b[0] - a[0]);
  const rows = all.slice(0, k + 2);
  const col = (n) => rows.map((r) => r[ix[n]]);
  const t = col('t'), F = col('thrust').map((x) => x ?? 0), m = col('mass'), cd = col('cd'), mach = col('mach'), area = col('refArea');

  // Stages, bottom first (OpenRocket numbers them from the top).
  const ev = f.events.filter((e) => e.branch === 0);
  const ignition = (mount) => ev.find((e) => e.type === 'IGNITION' && e.source === mount)?.t;
  const separation = (name) => ev.find((e) => e.type === 'STAGE_SEPARATION' && e.source === name)?.t;
  const order = [...f.stages].sort((p, q) => q.stage - p.stage);
  // Where each lower stage dropped away: the biggest fall in the mass from
  // one sample to the next about its separation.
  const drops = order.slice(0, -1).map((S) => {
    const sep = separation(S.name);
    if (!Number.isFinite(sep)) throw new Error(`${d.key}: ${S.name} never separated`);
    let at = -1;
    for (let j = 1; j < rows.length; j++) if (Math.abs(t[j] - sep) < 0.05 && (at < 0 || m[j - 1] - m[j] > m[at - 1] - m[at])) at = j;
    return { sep, at };
  });
  const stages = [];
  let start = 0, from = 0;
  order.forEach((S, i) => {
    const motors = f.motors.filter((mo) => mo.stage === S.stage).map((mo) => ({ mo, lit: ignition(mo.mount) - start }));
    if (motors.some(({ lit }) => !Number.isFinite(lit))) throw new Error(`${d.key}: a motor of ${S.name} never lit`);
    const drop = drops[i];
    // Its curve, on every point of its motors' curves, to its separation.
    const marks = new Set([0]);
    for (const { mo, lit } of motors) for (const tm of mo.time) marks.add(round(lit + tm, 6));
    if (drop) marks.add(round(drop.sep - start, 6));
    const thrustCurve = [...marks].sort((p, q) => p - q).map((tau) => [tau, round(motors.reduce((s, { mo, lit }) => s + mo.count * thrustAt(mo, tau - lit), 0), 5)]);
    // Its propellant: the mass OpenRocket's flight lost while it was the
    // bottom stage (its motors' rated propellant is kept beside it); its
    // dry mass: what dropped away when it separated.
    const to = drop ? drop.at - 1 : rows.length - 1;
    const prop = m[from] - m[to], dry = drop ? m[drop.at - 1] - m[drop.at] : 0;
    const rated = motors.reduce((s, { mo }) => s + mo.count * (mo.launchMass - mo.burnoutMass), 0);
    stages.push({ name: `${S.name} (${motors.map(({ mo }) => (mo.count > 1 ? `${mo.count} x ` : '') + mo.designation).join(' + ')})`, thrustCurve, prop: round(prop, 6), dry: round(dry, 6), ratedProp: round(rated, 6) });
    if (drop) { start = drop.sep; from = drop.at; }
  });
  const payload = m.at(-1);

  // Drag against Mach: from samples above Mach 0.02, burning and coasting,
  // averaged in bins of 0.01.
  const cdRef = cd.map((c, j) => c * area[j] / area[0]);
  const table = (burning) => {
    const bins = new Map();
    rows.forEach((r, j) => {
      if (!(mach[j] > 0.02) || !Number.isFinite(cdRef[j]) || (F[j] > 0) !== burning) return;
      const key = Math.round(mach[j] * 100), v = bins.get(key) ?? [0, 0, 0];
      bins.set(key, [v[0] + mach[j], v[1] + cdRef[j], v[2] + 1]);
    });
    return [...bins.entries()].sort((p, q) => p[0] - q[0]).map(([, [sM, sc, n]]) => [round(sM / n, 4), round(sc / n, 5)]);
  };
  // Against time: every 0.01 s, and both sides of any jump (an engine
  // lighting or burning out moves the base drag at once).
  const replay = [];
  let mark = 0;
  rows.forEach((r, j) => {
    if (!Number.isFinite(cdRef[j])) return;
    const jump = (j > 0 && Math.abs(cdRef[j] - cdRef[j - 1]) > 0.01) || (j < rows.length - 1 && Math.abs(cdRef[j + 1] - cdRef[j]) > 0.01);
    if (t[j] >= mark - 1e-9 || jump) { replay.push([round(t[j], 5), round(cdRef[j], 5)]); if (t[j] >= mark - 1e-9) mark += 0.01; }
  });
  const hist = [];
  for (let s = 0; s <= apogeeTime; s += 0.5) {
    const j = t.findIndex((x) => x >= s - 1e-9);
    hist.push([t[j], round(col('h')[j], 3), round(col('v')[j], 3)]);
  }
  out.vehicles[d.key] = {
    name: d.name, design: d.file, simulation: f.simulation,
    stages, payload: round(payload, 6), liftoffMass: m[0], refArea: area[0], gravity: round(col('g')[0], 5),
    drag: { powerOn: table(true), powerOff: table(false), replay },
    openrocket: { ...f.summary, apogeeTime: round(apogeeTime, 4), events: ev.filter((e) => ['IGNITION', 'BURNOUT', 'STAGE_SEPARATION', 'APOGEE'].includes(e.type)).map(({ type, t: et, source }) => ({ type, t: et, source })), history: hist },
  };
  const S = out.vehicles[d.key];
  const total = S.stages.reduce((s, x) => s + x.prop + x.dry, S.payload);
  console.log(`${d.key}: ${S.stages.map((x) => `${x.name}: burns ${(x.prop * 1000).toFixed(1)} g (motors hold ${(x.ratedProp * 1000).toFixed(1)} g), drops ${(x.dry * 1000).toFixed(1)} g`).join('; ')}; payload ${(S.payload * 1000).toFixed(1)} g; liftoff ${m[0].toFixed(4)} kg (stages and payload add to ${total.toFixed(4)}); apogee ${f.summary.maxAltitude.toFixed(2)} m at ${apogeeTime.toFixed(3)} s, top speed ${f.summary.maxVelocity.toFixed(2)} m/s`);
}
fs.writeFileSync(new URL('./fixtures/rocket_xcheck.json', import.meta.url), JSON.stringify(out));
