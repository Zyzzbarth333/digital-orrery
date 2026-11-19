// packages/physics/src/spacecraft.test.mjs
//
// The spacecraft layer's trajectories (spacecraft.js) against JPL Horizons:
// held-out samples (states the fetch did not keep, one a month a craft,
// mid-way between two kept ones), the joins between days, and what the
// packed files say of themselves.
//
//   node packages/physics/src/spacecraft.test.mjs
//
// Reference: JPL Horizons, each craft's trajectory as Horizons serves it
// (fixtures/spacecraft_horizons.json, from npm run fetch:spacecraft).

import './deNode.js';
import { readFileSync } from 'node:fs';
import { helioStateEqj } from './ephemeris.js';
import { parseMonth, segmentAt, stateIn } from './spacecraft.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}
const dir = new URL('../../../public/data/spacecraft/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const centres = index.centres;
const months = new Map();
for (const m of index.months) {
  const json = JSON.parse(readFileSync(new URL(`${m}.json`, dir), 'utf8'));
  const bin = readFileSync(new URL(`${m}.bin`, dir));
  months.set(m, parseMonth(json, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)));
}
const craftIndex = new Map(index.craft.map((c, i) => [c.key, i]));
const at = (key, t) => {
  const month = months.get(new Date(t).toISOString().slice(0, 7));
  return month ? segmentAt(month, craftIndex.get(key), t) : null;
};
// A state about another centre, by the centres' heliocentric states (DE442).
function shift(s, from, to, t) {
  if (from === to) return s;
  const d = new Date(t), zero = { r: [0, 0, 0], v: [0, 0, 0] };
  const a = from === 'sun' ? zero : helioStateEqj(from, d), b = to === 'sun' ? zero : helioStateEqj(to, d);
  return { r: s.r.map((x, i) => x + a.r[i] - b.r[i]), v: s.v.map((x, i) => x + a.v[i] - b.v[i]) };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

console.log(`Spacecraft from JPL Horizons: ${index.craft.length} craft, ${index.months.length} months, tolerance ${index.tolKm} km`);

// ----- Held-out Horizons samples -----
{
  const { samples } = JSON.parse(readFileSync(new URL('./fixtures/spacecraft_horizons.json', import.meta.url), 'utf8'));
  const worst = new Map();
  let missing = 0;
  for (const h of samples) {
    const seg = at(h.craft, h.t);
    if (!seg) { missing++; continue; }
    const centre = centres[seg.centre];
    const s = shift(stateIn(seg, h.t, centre.mu), centre.key, h.centre, h.t);
    const e = dist(s.r, h.r), ev = dist(s.v, h.v);
    const w = worst.get(h.craft) ?? { e: 0, ev: 0, n: 0 };
    worst.set(h.craft, { e: Math.max(w.e, e), ev: Math.max(w.ev, ev), n: w.n + 1 });
  }
  check(missing === 0, `${samples.length} held-out samples, each inside a packed day${missing ? ` (${missing} not)` : ''}`);
  // The tolerance, plus the DE442 table's metre for a craft held about a
  // planet it passes.
  const tol = index.tolKm + 0.01;
  for (const [key, w] of worst) {
    check(w.e <= tol, `${key.padEnd(12)} ${w.n} samples within ${index.tolKm} km: worst ${w.e.toFixed(3)} km, ${(w.ev * 1e3).toFixed(2)} m/s`);
  }
}

// ----- Days join where they meet -----
{
  let joins = 0, worstJoin = 0, where = '';
  for (const [ci, c] of index.craft.entries()) {
    for (let k = 0; k + 1 < index.months.length * 31; k++) {
      const t = Date.parse(index.span[0]) + (k + 1) * 86400e3;
      const a = at(c.key, t - 1), b = at(c.key, t);
      if (!a || !b || a === b) continue;
      const ca = centres[a.centre], cb = centres[b.centre];
      const sa = shift(stateIn(a, t, ca.mu), ca.key, c.centre, t), sb = shift(stateIn(b, t, cb.mu), cb.key, c.centre, t);
      const e = dist(sa.r, sb.r);
      if (e > worstJoin) { worstJoin = e; where = `${c.key} ${new Date(t).toISOString().slice(0, 10)}`; }
      joins++;
    }
    void ci;
  }
  // Float32 states round a position 10^5 km from its centre to 4 m.
  check(worstJoin < 0.01, `${joins} joins between days agree within 10 m (worst ${(worstJoin * 1e3).toFixed(2)} m, ${where})`);
}

// ----- What the files say -----
{
  check(index.craft.every((c) => c.days === 0 || c.maxErrKm <= index.tolKm), 'every craft packed within the tolerance on every checked day');
  const span = index.craft.filter((c) => c.days > 0);
  check(span.length >= 20, `${span.length} of ${index.craft.length} craft have days in 2026-2027`);
  check(index.craft.every((c) => !c.days || /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(c.revised ?? '')), "every craft carries Horizons' revision date (before it: fitted to tracking; after: predicted)");
  console.log(`  (${index.craft.filter((c) => c.legs?.length).length} of ${index.craft.length} carry Horizons' table of trajectory legs too)`);
}

if (failed) { console.log(`\n${failed} spacecraft check(s) failed`); process.exit(1); }
console.log('\nspacecraft: all checks passed');
