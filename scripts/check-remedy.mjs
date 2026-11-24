// scripts/check-remedy.mjs
//
// A GO board remedy checked in the app on this machine's GPU: a journey set
// on the plotting table, its GO station read once the kernel has flown it
// (NO GO, the Trajectory row's why and options), an option's RE-PLAN
// pressed, and the station read again once the new plan is flown. A
// screenshot of each.
//
//   npm run build
//   node scripts/check-remedy.mjs <journey.json> "<option label prefix>" [outDir] [--gpu nvidia]
//
// The journey file holds a journey as journey.js takes it. Needs Node 22
// (WebSocket); ORRERY_BROWSER_MEMORY caps the browser (scripts/lib/chromium.mjs).

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gpuLock, launch, pageApi, serve } from './lib/chromium.mjs';

const args = process.argv.slice(2);
const gi = args.indexOf('--gpu'), gpu = gi >= 0 ? args.splice(gi, 2)[1] : 'intel';
const [file, label, out = 'remedy-check'] = args;
if (!file || !label) { console.error('usage: node scripts/check-remedy.mjs <journey.json> "<option label prefix>" [outDir] [--gpu nvidia]'); process.exit(2); }
const journey = JSON.parse(readFileSync(file, 'utf8'));
mkdirSync(out, { recursive: true });

// The GO station's rows and the Trajectory row's options, as read.
const board = `(() => [...document.querySelectorAll('.go-row')].map((r) => ({
  key: r.querySelector('b')?.textContent, state: r.querySelector('.plot-lamp')?.textContent,
  text: r.querySelector('[role=cell]:last-child')?.childNodes[0]?.textContent ?? '',
  why: r.querySelector('.go-why')?.textContent ?? null,
  options: [...r.querySelectorAll('.go-fixes li')].map((li) => li.querySelector('span')?.textContent),
})))()`;
const flown = (v) => `journey.version === ${v} && journey.kernel.state === 'done' && journey.kernel.forVersion === ${v} && !!journey.remediesNow()`;
const settled = (v) => `journey.version === ${v} && journey.kernel.state === 'done' && journey.kernel.forVersion === ${v} && journey.profilesFor === ${v}`;

const lock = await gpuLock();
const site = await serve('dist');
const b = await launch({ gpu, width: 1440, height: 1000 });
try {
  const p = pageApi(b.cdp);
  // (open() adds ?debug, so the table is opened from the store, not by #plot.)
  await p.open(`${site.url}/`);
  await p.waitFor('!!window.journey');
  await p.eval(`journey.loadSmallBodies?.(location.pathname.replace(/[^/]*$/, ''))`);
  await p.eval(`(() => { journey.setPlotOpen(true); journey.set(${JSON.stringify(journey)}); journey.check(); })()`);
  await p.click('#station-tab-go');
  const v0 = await p.eval('journey.version');
  const t0 = Date.now();
  await p.waitFor(flown(v0), 180e3);
  await p.wait(500);
  const before = await p.eval(board);
  console.log(`flown in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${await p.eval('journey.kernel.reply.model')} model, impact ${await p.eval('JSON.stringify(journey.kernel.reply.impact)')}`);
  console.log(JSON.stringify(before, null, 2));
  await p.shot(join(out, '1-nogo.png'));

  const ok = await p.eval(`(() => {
    const li = [...document.querySelectorAll('.go-fixes li')].find((l) => l.querySelector('span')?.textContent.startsWith(${JSON.stringify(label)}));
    if (!li) return false;
    li.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  if (!ok) throw new Error(`No option "${label}"`);
  const [x, y] = await p.eval(`(() => { const li = [...document.querySelectorAll('.go-fixes li')].find((l) => l.querySelector('span')?.textContent.startsWith(${JSON.stringify(label)})); const r = li.querySelector('button').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await p.shot(join(out, '2-option.png'));
  await p.click([x, y]);
  const v1 = await p.eval('journey.version');
  const t1 = Date.now();
  await p.waitFor(settled(v1), 180e3);
  await p.wait(1500);
  const after = await p.eval(board);
  console.log(`re-planned (version ${v1}), flown in ${((Date.now() - t1) / 1000).toFixed(1)} s: ${await p.eval('journey.kernel.reply.model')} model, total ${await p.eval('journey.solution.totalDv.toFixed(3)')} km/s, impact ${await p.eval('JSON.stringify(journey.kernel.reply.impact)')}`);
  console.log(await p.eval(`JSON.stringify(journey.kernel.reply.arrivals.map((a) => ({ body: a.body, missKm: +a.missKm.toFixed(2) })))`));
  console.log(JSON.stringify(after, null, 2));
  await p.eval(`document.querySelector('.go-row')?.scrollIntoView({ block: 'start' })`);
  await p.shot(join(out, '3-go.png'));
} finally {
  await b.close();
  await site.stop();
  await lock.release();
}
