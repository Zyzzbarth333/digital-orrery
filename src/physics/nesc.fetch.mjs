// src/physics/nesc.fetch.mjs
//
// Builds src/physics/fixtures/nesc_orbital.json from NASA's 6-DOF orbital
// check cases (NASA Engineering and Safety Center, NASA/TM-2015-218675;
// https://nescacademy.nasa.gov/flightsim/2015). The data are four NASA
// simulations' results (the report masks which tool is which: sims A to D)
// for each case, every 60 s for 8 hours.
//
//   npm run fetch:nesc
//
// Downloads Orbital_checkcases.zip (11 MB) once into
// ~/.cache/digital-orrery/nesc (needs the unzip command), then keeps, for
// each case and tool, every hour of the states the test compares
// (nesc.test.mjs), the tools' own pairwise differences over all samples,
// and, for the cases that record or use the MET atmosphere (5A to 5C and
// the drag cases), sim B's density and temperature every 60 s, which
// atmosphereMET.js is checked against.

import fs from 'node:fs';
import dns from 'node:dns';
import { execFileSync } from 'node:child_process';

dns.setDefaultResultOrder('ipv4first');
const URL_ZIP = 'https://nescacademy.nasa.gov/src/flightsim/Datasets/Orbital_checkcases.zip';
const CACHE = `${process.env.HOME}/.cache/digital-orrery/nesc`;
const CASES_DIR = `${CACHE}/cases/Orbital_checkcases`;
const EVERY = 3600;                       // s between kept samples
const MET = ['05A', '05B', '05C', '06B', '07C', '07D', '11'];  // MET cases: atmosphere only, or drag in it

if (!fs.existsSync(CASES_DIR)) {
  fs.mkdirSync(`${CACHE}/raw`, { recursive: true });
  const zip = `${CACHE}/raw/Orbital_checkcases.zip`;
  if (!fs.existsSync(zip)) {
    console.log(`downloading ${URL_ZIP}`);
    const res = await fetch(URL_ZIP);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync('unzip', ['-qo', zip, '-x', '__MACOSX/*', '-d', `${CACHE}/cases`]);
}

const sig = (x) => Number(x.toPrecision(11));
const V = (row, col, prefix) => ['X', 'Y', 'Z'].map((a) => row[col(prefix + a)]);
function readTool(file) {
  const L = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/), h = L[0].split(','), col = (n) => h.indexOf(n);
  return L.slice(1).map((l) => {
    const x = l.split(',').map(Number);
    return {
      t: x[0], r: V(x, col, 'eiPosition_m_'), v: V(x, col, 'eiVelocity_m_s_'), ecef: V(x, col, 'gePosition_m_'),
      omega: ['Roll', 'Pitch', 'Yaw'].map((a) => x[col(`bodyAngularRateWrtEi_rad_s_${a}`)]),
      euler: ['Roll', 'Pitch', 'Yaw'].map((a) => x[col(`eulerAngleWrtEi_rad_${a}`)]),
      alt: x[col('altitudeMsl_m')], rho: x[col('airDensity_kg_m3')], T: x[col('ambientTemperature_dgK')], g: V(x, col, 'eiGravitation_m_s2_'),
    };
  });
}

const out = { source: 'NASA Engineering and Safety Center, 6-DOF check cases (NASA/TM-2015-218675), orbital set', url: 'https://nescacademy.nasa.gov/flightsim/2015', every: EVERY, cases: {} };
for (const dir of fs.readdirSync(CASES_DIR).sort()) {
  const key = dir.match(/^Orbit_(\d+[A-D]?)_/)[1];
  const tools = {};
  for (const f of fs.readdirSync(`${CASES_DIR}/${dir}`).sort()) {
    const m = f.match(/_sim_([A-D])\.csv$/);
    if (m) tools[m[1]] = readTool(`${CASES_DIR}/${dir}/${f}`);
  }
  // The tools' pairwise differences in position over every sample (rows
  // matched by time, to 1 ms).
  const spread = {};
  const letters = Object.keys(tools);
  for (const a of letters) for (const b of letters) {
    if (a >= b) continue;
    const byT = new Map(tools[b].map((x) => [Math.round(x.t), x]));
    let d = 0;
    for (const x of tools[a]) { const y = byT.get(Math.round(x.t)); if (y && Math.abs(x.t - y.t) < 1e-3) d = Math.max(d, Math.hypot(x.r[0] - y.r[0], x.r[1] - y.r[1], x.r[2] - y.r[2])); }
    spread[a + b] = sig(d);
  }
  const keep = (rows) => rows.filter((x) => Math.abs(x.t / EVERY - Math.round(x.t / EVERY)) * EVERY < 1e-3 && x.t <= 28800 + 1e-3)
    .map((x) => ({ t: sig(x.t), r: x.r.map(sig), v: x.v.map(sig), ecef: x.ecef.map(sig), omega: x.omega.map(sig), euler: x.euler.map(sig), alt: sig(x.alt), g: x.g.map(sig) }));
  out.cases[key] = { spread, tools: Object.fromEntries(letters.map((s) => [s, keep(tools[s])])) };
  if (MET.includes(key)) {
    const B = tools.B.filter((x) => x.t <= 28800 + 1e-3), sig9 = (x) => Number(x.toPrecision(9));
    out.cases[key].metB = { every: 60, rho: B.map((x) => sig9(x.rho)), T: B.map((x) => sig9(x.T)) };
  }
  console.log(`${key.padEnd(4)} tools ${letters.join('')}, spread ${Object.entries(spread).map(([k, v]) => `${k} ${v.toPrecision(3)} m`).join(', ')}`);
}
const path = new URL('./fixtures/nesc_orbital.json', import.meta.url);
fs.writeFileSync(path, JSON.stringify(out));
console.log(`wrote ${path.pathname}, ${(fs.statSync(path).size / 1024).toFixed(0)} kB`);
