// src/app/stores.test.mjs: the app's two stores between the workers and
// the panels, JourneyStore (journey.ts) and Mission (mission.ts), in Node
// with a stand-in Worker and fetch.
//
// They are TypeScript, so Vite's module runner loads them (it strips the
// types and gives import.meta.env), on Node 20 as on 22.
//
//   node src/app/stores.test.mjs

import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));

let passed = 0, failed = 0;
function check(name, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (ok) passed++; else failed++; }

// A Worker that keeps what it is sent; a check answers for it with reply().
const workers = [];
class FakeWorker {
  constructor(url) { this.url = String(url); this.posted = []; this.terminated = false; this.onmessage = null; this.onerror = null; workers.push(this); }
  postMessage(msg) { this.posted.push(msg); }
  terminate() { this.terminated = true; }
  reply(data) { this.onmessage?.({ data }); }
}
globalThis.Worker = FakeWorker;

// fetch answers from a list, one a call, and counts the calls.
let answers = [], fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  const a = answers.shift() ?? { status: 404 };
  return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body, arrayBuffer: async () => new ArrayBuffer(0) };
};
// The stores warn on a failed load; the checks keep what they say.
const warned = [];
console.warn = (...a) => warned.push(a.join(' '));

const load = async (id) => (await runnerImport(id, { root, configFile: false, logLevel: 'error' })).module;
const { JourneyStore } = await load('/src/app/journey.ts');
const { Mission } = await load('/src/app/mission.ts');

const flight = (forVersion) => ({ forVersion, frame: 'sun', pathEcl: [], arrivals: [], burns: [], start: null, unsupported: [], log: [], impact: null, ms: 0, correctionsDv: 0, landings: [] });

console.log('JourneyStore: a worker reply for an older version is dropped');
{
  const s = new JourneyStore(Date.UTC(2026, 10, 19));
  s.add('mars', 'orbit');
  check('a journey to Mars solves (so the kernel is asked to fly it)', s.solution.ok);
  s.check();
  const [p1, w1] = workers.slice(-2);
  const v1 = s.version;
  check('it asks one worker for the flight and one for the profiles, for this version', w1.posted.at(-1).forVersion === v1 && p1.posted.at(-1).type === 'profiles' && s.kernel.state === 'flying');

  s.edit(0, { stayDays: 5 });
  const v2 = s.version;
  s.check();
  const [p2, w2] = workers.slice(-2);
  check('an edit while the flight is under way stops that worker and asks a new one', v2 > v1 && w1.terminated && p1.terminated && w2 !== w1 && w2.posted.at(-1).forVersion === v2);

  w2.reply(flight(v2));
  w1.reply(flight(v1));                // the older answer, arriving last
  check('the newer answer is kept, the older one arriving after it is dropped', s.kernel.state === 'done' && s.kernel.forVersion === v2 && s.view()?.flown !== null);

  s.edit(0, { stayDays: 6 });
  const v3 = s.version;
  s.check();
  const p3 = workers.at(-1);
  check('once a flight is done, the next edit goes to the same worker', !w2.terminated && w2.posted.at(-1).forVersion === v3 && p3 !== w2);
  w2.reply(flight(v2));                // an answer for the last version, not this one
  check('on one worker, an answer for an older version leaves the flight under way', s.kernel.state === 'flying' && s.kernel.forVersion === v3);
  w2.reply(flight(v3));
  check('and the answer for this version is taken', s.kernel.state === 'done' && s.kernel.forVersion === v3);

  p3.reply({ type: 'profiles', forVersion: v2, profiles: [{ k: 0 }] });
  check('window profiles for an older version are dropped', s.profilesFor !== v2 && s.profiles.length === 0);
  p3.reply({ type: 'profiles', forVersion: v3, profiles: [{ k: 0 }] });
  check('and those for this version kept', s.profilesFor === v3 && s.profiles.length === 1);

  w2.onerror?.({ message: 'boom' });
  check('a worker that fails marks the flight failed, for this version', s.kernel.state === 'failed' && s.kernel.error === 'boom' && s.kernel.forVersion === v3);
  s.dispose();
}

console.log('JourneyStore: a failed small-body load (404) is asked again');
{
  const s = new JourneyStore(Date.UTC(2026, 10, 19));
  answers = [{ status: 404 }]; fetched = []; warned.length = 0;
  await s.loadSmallBodies('/');
  check('a 404 leaves the list empty and says why', s.named.length === 0 && warned.some((w) => w.includes('HTTP 404')));
  answers = [{ status: 200, body: { named: [] } }];
  await s.loadSmallBodies('/');
  check('the next call fetches again', fetched.length === 2 && fetched.every((u) => u.endsWith('data/smallbodies.json')));
  await s.loadSmallBodies('/');
  check('and once loaded, it is not fetched a third time', fetched.length === 2);
}

console.log('Mission: a real mission that cannot be fetched');
{
  const before = workers.length;
  const m = new Mission();
  check('the mission runs its kernel in a worker', workers.length === before + 1 && m.client.worker === workers.at(-1));
  answers = [{ status: 404 }]; fetched = [];
  const err = await m.fetchReal('artemis1').then(() => null, (e) => e);
  check('a 404 rejects, naming the mission and the status', err?.message === 'mission artemis1: HTTP 404' && fetched[0].endsWith('missions/artemis1.json'));
  answers = [{ status: 200, body: { flownFrom: 'artemis1-flown' } }, { status: 404 }]; fetched = [];
  const err2 = await m.fetchReal('artemis1-plan').then(() => null, (e) => e);
  check('so does a 404 for the flown path it borrows (flownFrom)', err2?.message === 'mission artemis1-flown: HTTP 404' && fetched.length === 2);
  m.client.dispose();
}

console.log(`stores: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
