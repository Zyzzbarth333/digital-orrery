// src/physics/kernelClient.test.mjs
//
// The kernel client with a Worker that is busy but alive (kernelClient.js).
// At a day a second the app's request for Artemis II's entry (separation to
// splashdown under the guidance) held the Worker 3-4 s, past the client's
// 2 s reply timeout, and the client gave up on it: every later step ran on
// the page's thread. Each request to the Worker now carries a time budget
// (kernelHost.js budgetMs) and the entry is flown in pieces.
// Here the Worker is a stand-in that runs kernelHost on this thread a turn
// of the event loop later, so the client sees it as it sees a real one.

import './deNode.js';                 // DE442's Earth and Moon, as in the app
import { readFileSync } from 'node:fs';
import { Craft } from './craft.js';
import { RealMission } from './realMission.js';
import { ORION_CRAFT, ORION_ENTRIES, orionFor } from './orion.js';
import { KernelClient } from './kernelClient.js';
import { createKernelHost, KERNEL_EPOCH_MS, kernelSeconds } from './kernelHost.js';
import { solarSystemBodies } from './bodies.js';

let failures = 0;
function check(name, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; }
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const DAY = 86400;
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
const m = new RealMission({ ...JSON.parse(readFileSync(new URL('../../public/missions/artemis2.json', import.meta.url), 'utf8')), id: 'artemis2' });
const EN = ORION_ENTRIES.artemis2, C = orionFor('artemis2');

// A Worker stand-in: kernelHost, answering a turn later. silent: it never
// answers (a dead Worker). gaps: each request's wall time to its answer.
class StandInWorker {
  constructor() { this.host = createKernelHost(); this.gaps = []; this.silent = false; }
  postMessage(msg) {
    if (this.silent) return;
    const sent = performance.now();
    setTimeout(() => {
      const reply = this.host.handle(structuredClone(msg));
      this.gaps.push(performance.now() - sent);
      this.onmessage({ data: reply });
    }, 0);
  }
  terminate() { this.silent = true; }
}
let lastWorker = null;
const createWorker = () => (lastWorker = new StandInWorker());

// The crew module at separation, as Mission.entry makes it, with the clock
// a day on (a day a second).
function capsule() {
  const s = m.fixAt(m.endMs), c = new Craft({ name: m.name, r: s.r, v: s.v, t: s.t, sys, ...ORION_CRAFT });
  c.setScript(m.script());
  c.advanceClock(kernelSeconds(new Date(EN.separationMs)));
  createKernelHost().handle({ type: 'step', crafts: [c.buildRequest()] }).crafts.forEach((r) => c.applyResult(r));
  c.configure({ dryMass: C.mass, fuel: 0, area: C.area, cd: C.cd, cr: 1.3, vent: null, scriptIsp: null, entry: { aero: C.aero, chutes: C.chutes, target: EN.target } });
  c.advanceClock(c.kState.t + DAY);
  return c;
}

// Warnings the client gives (a fallback is one).
const warnings = [], warn = console.warn;
console.warn = (...a) => { warnings.push(a.join(' ')); warn(...a); };

header('CASE 1: Artemis II\'s entry at a day a second, through the Worker');
let site = null;
{
  // As before: the whole entry in one request.
  const whole = capsule(), host = createKernelHost();
  let wall = performance.now();
  for (let i = 0; i < 20 && !whole.crashed; i++) host.handle({ type: 'step', crafts: [whole.buildRequest()] }).crafts.forEach((r) => whole.applyResult(r));
  const wholeMs = performance.now() - wall;
  console.log(`  in one request: ${(wholeMs / 1000).toFixed(1)} s of kernel time; ${whole.log.at(-1)?.text}`);

  // Through the client, a frame a turn, with the old 2 s timeout.
  const c = capsule(), client = new KernelClient({ createWorker, replyTimeoutMs: 2000 }), w = lastWorker;
  wall = performance.now();
  let frames = 0;
  for (; frames < 2000 && !c.crashed; frames++) { client.tick([c]); await turn(); }
  const longest = Math.max(...w.gaps);
  console.log(`  through the client: ${w.gaps.length} requests in ${((performance.now() - wall) / 1000).toFixed(1)} s, the longest answered in ${longest.toFixed(0)} ms (budget ${client.budgetMs} ms); ${c.log.at(-1)?.text}`);
  check('the kernel stays in the Worker (no fallback, no warning)', client.mode === 'worker' && client.worker === w && warnings.length === 0);
  check(`every request is answered well inside the old 2 s timeout (longest ${longest.toFixed(0)} ms)`, longest < 1000);
  check('the capsule splashes down', c.crashed && c.splashed);
  // Flown in pieces, each piece's first step restarts the integrator and the
  // guidance sees its cycles at other instants, so where the pieces end
  // (wall time here, as frames end them at lower warp) moves the landing:
  // 0-1.4 km measured, cut by step counts from 5 to 500 and by budgets from
  // 25 to 400 ms. Under half Orion's own miss on Artemis I, 2.1 nmi
  // (3.9 km) from its target (AAS 24-174, Table 4).
  const d = norm(sub(c.impactSite.local, whole.impactSite.local)), dt = c.impactSite.t - whole.impactSite.t;
  check(`it lands within 2 km of the one-request entry (${(d * 1000).toFixed(0)} m, ${dt.toFixed(1)} s apart)`, d < 2 && Math.abs(dt) < 10);
  site = whole.impactSite;
}

header('CASE 2: two crafts share a budget');
{
  // The capsule and a craft in cruise (10 million km out, gravity alone)
  // in one batch, the capsule first: its expensive steps do not starve the
  // other of its share.
  const c = capsule(), E = sys.bodyAt('earth', c.kState.t), vE = E.eph.velocity(c.kState.t);
  const o = new Craft({ name: 'cruise', r: [E.r[0], E.r[1] + 1e7, E.r[2]], v: [vE[0], vE[1], vE[2]], t: c.kState.t, sys, bare: true });
  o.advanceClock(c.clockT);
  const req = [c.buildRequest(), o.buildRequest()];
  const wall = performance.now(), reply = createKernelHost().handle({ type: 'step', crafts: req, budgetMs: 200 }), ms = performance.now() - wall;
  const [rc, ro] = reply.crafts;
  console.log(`  one batch: ${ms.toFixed(0)} ms; capsule ${rc.steps} steps (${rc.complete ? 'done' : `${((rc.tEnd - rc.t) / 3600).toFixed(1)} h to go`}), cruise ${ro.steps} steps (${ro.complete ? 'done' : 'not done'})`);
  check('the batch keeps to its budget, give or take a step', ms < 400);
  check('the capsule stops short; the cheap craft is flown the whole day', !rc.complete && ro.complete && ro.t === ro.tEnd);
  check('without a budget nothing changes: a request runs to its end', createKernelHost().handle({ type: 'step', crafts: [o.buildRequest()] }).crafts[0].complete);
}

header('CASE 3: a Worker that has died');
{
  // Silent with a request in flight past the timeout: the client gives up
  // on it and steps on this thread, as before.
  const o = capsule(), client = new KernelClient({ createWorker, replyTimeoutMs: 50 }), w = lastWorker;
  w.silent = true;
  client.tick([o]);
  await new Promise((resolve) => setTimeout(resolve, 80));
  warnings.length = 0;
  for (let i = 0; i < 20 && !o.crashed; i++) client.tick([o]);
  check(`it falls back to this thread ("${warnings[0] ?? ''}")`, client.mode === 'main-thread' && /looks stuck/.test(warnings[0] ?? ''));
  // There it runs to its end in one go: the one-request entry exactly.
  check('and flies the craft there, to the one-request splashdown', o.crashed && o.splashed && norm(sub(o.impactSite.local, site.local)) < 1e-6);
}

console.warn = warn;
console.log('='.repeat(60));
if (failures > 0) { console.log(`RESULT: ${failures} check(s) FAILED`); process.exit(1); }
console.log('RESULT: all checks PASSED');
