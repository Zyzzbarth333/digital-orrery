// Runs the app for a long while in one page, as a user would, and fails if
// the frame or the memory climbs from one cycle to the next
// (docs/performance.md#a-long-run).
//
//   npm run build && npm run bench:soak                       (./dist, Intel, 25 min)
//   npm run bench:soak -- --minutes 5 --gpu nvidia
//   npm run bench:soak -- --url http://127.0.0.1:5173         (a dev server)
//   npm run bench:soak -- --json soak.json
//
// Options:
//   --dist DIR | --url URL     the build (default ./dist)
//   --gpu intel|nvidia         the GPU (intel)
//   --minutes M                how long to keep cycling (25)
//   --cycles N                 or a number of cycles instead
//   --size WxH                 the desktop viewport (1440x900)
//   --skip a,b                 leave steps out (layers, warp, fly, find, plot, craft, phone)
//   --per-layer                also time each rail switch alone, every cycle
//   --profile                  a 3 s CPU profile with every layer on, every cycle
//   --json FILE                every sample and every cycle as JSON
//   --force                    start with less memory than the cap needs
//
// One cycle is what a user does in a couple of minutes: every rail switch
// on, then off; the clock warped up to a year a second and back; flights to
// Mars, Jupiter, Saturn and the Moon; a FIND search; the plotting table
// opened and closed; a craft launched, followed and removed; the phone
// layout with its sheet raised and lowered. Each cycle starts and ends at
// one reference view (the Earth at 20,000 km, every layer off, real time),
// where the frame is timed: the check is that view's frame cost and the
// page's memory, and the frame with every layer on, in the first quarter
// of the cycles against the last. Exit status 1 if any climbs.
//
// Every 10 s it also samples the frame (the app's render callback plus a
// one-pixel readPixels, as bench:frames times it), the JS heap, DOM nodes,
// listeners, three.js's geometries, textures and programs, the hand-uploaded
// maps' video memory, the live workers and their messages in flight, long
// tasks, and the GPU and page processes' resident memory.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadavg } from 'node:os';
import { GPUS, gpuLock, launch, pageApi, serve } from './lib/chromium.mjs';

const REF = { km: 20000, query: '?focus=earth&t=2026-11-10T15:00Z' };
const STEPS = ['layers', 'warp', 'fly', 'find', 'plot', 'craft', 'phone'];

// ---- In the page ----------------------------------------------------------

// Before the app's own scripts: count workers (live, and messages each way
// per script, a backlog shows as sent climbing over received) and long tasks.
const PRELUDE = `(() => {
  const s = window.__soak = { made: 0, live: new Set(), byUrl: {}, longN: 0, longMs: 0 };
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url, opts) {
      super(url, opts);
      const k = String(url).startsWith('blob:') ? 'blob (three.js loader)' : String(url).split('/').pop().replace(/-[\\w-]{8}\\.js$/, '.js').replace(/\\?.*$/, '');
      const e = s.byUrl[k] ??= { made: 0, live: 0, sent: 0, recv: 0 };
      e.made++; e.live++; s.made++; s.live.add(this); this.__k = k;
      this.addEventListener('message', () => e.recv++);
    }
    postMessage(...a) { s.byUrl[this.__k].sent++; return super.postMessage(...a); }
    terminate() { if (s.live.delete(this)) s.byUrl[this.__k].live--; return super.terminate(); }
  };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { s.longN++; s.longMs += e.duration; } }).observe({ type: 'longtask', buffered: true });
  } catch { /* no longtask timing */ }
})()`;

// The frame hook of bench:frames, which keeps every frame's cost and start.
const HOOK = `(() => {
  const o = window.orrery;
  if (o.__bench) return true;
  const frame = o.frame, gl = o.renderer.getContext(), px = new Uint8Array(4);
  const s = o.__bench = { cost: [], start: [], calls: 0, triangles: 0, points: 0, lines: 0 };
  // The whole frame's draws: three.js resets its counts at every pass
  // (the bloom and final passes each render), so they are reset here.
  const info = o.renderer.info;
  info.autoReset = false;
  o.frame = (now) => {
    info.reset();
    const t0 = performance.now();
    frame(now);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    s.cost.push(performance.now() - t0);
    s.start.push(t0);
    if (info.render.calls) Object.assign(s, { calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines });
  };
  return true;
})()`;

// The frames since the last call (and forgets them), and the page's counts.
const SAMPLE = `(() => {
  const o = orrery, b = o.__bench, s = window.__soak;
  const q = (a, f) => { if (!a.length) return null; const t = a.slice().sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.floor(t.length * f))]; };
  const gaps = b.start.slice(1).map((t, i) => t - b.start[i]);
  const r = { frames: b.cost.length, cost: q(b.cost, 0.5), p90: q(b.cost, 0.9), worst: b.cost.length ? Math.max(...b.cost) : null,
    gap: q(gaps, 0.5), gapWorst: gaps.length ? Math.max(...gaps) : null };
  b.cost.length = 0; b.start.length = 0;
  const i = o.renderer.info;
  r.geometries = i.memory.geometries; r.textures = i.memory.textures; r.programs = i.programs?.length ?? null;
  r.calls = b.calls; r.triangles = b.triangles; r.points = b.points; r.lines = b.lines;
  r.mapsMB = Math.round((o.uploader?.gpuBytes ?? 0) / 1e6);
  r.heapMB = performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null;
  r.markers = document.querySelectorAll('.body-marker, .sat-label, .small-label').length;
  r.workers = s.live.size; r.workersMade = s.made;
  r.inFlight = Object.fromEntries(Object.entries(s.byUrl).map(([k, e]) => [k, e.sent - e.recv]).filter(([, d]) => d));
  r.workerLive = Object.fromEntries(Object.entries(s.byUrl).map(([k, e]) => [k, e.live]));
  r.longN = s.longN; r.longMs = Math.round(s.longMs);
  r.crafts = window.mission?.crafts?.length ?? null;
  r.rate = o.clock.snapshot.rate; r.km = Math.round(o.rig.dist); r.focus = o.focus;
  return r;
})()`;

// The rail's layer switches (the moon grids' and colours' are not layers).
const SWITCHES = `[...document.querySelectorAll('nav.rail [role=switch]')]`;
const setAll = (on) => `(() => { let n = 0; for (const b of ${SWITCHES}) if ((b.getAttribute('aria-checked') === 'true') !== ${on}) { b.click(); n++; } return n; })()`;
const LAYERS_ON = `${SWITCHES}.filter((b) => b.getAttribute('aria-checked') === 'true').length`;

// ---- The browser's processes ----------------------------------------------

// The GPU and page processes of the browser with this profile: resident
// memory (MB) each, and their cgroup's memory, which counts the iGPU's
// textures held in system memory.
function processes(profile) {
  const out = { gpuMB: 0, rendererMB: 0, otherMB: 0, cgroupMB: null };
  let cg = null;
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    let cmd;
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    if (!cmd.includes(profile)) continue;
    let rss = 0;
    try { rss = Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) / 1024; } catch { continue; }
    const type = /--type=([\w-]+)/.exec(cmd)?.[1];
    if (type === 'gpu-process') {
      out.gpuMB += rss;
      try { cg = readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().split(':').pop(); } catch { /* gone */ }
    } else if (type === 'renderer') out.rendererMB += rss;
    else out.otherMB += rss;
  }
  if (cg) { try { out.cgroupMB = Number(readFileSync(`/sys/fs/cgroup${cg}/memory.current`, 'utf8')) / 2 ** 20; } catch { /* no cgroup v2 */ } }
  for (const k of Object.keys(out)) if (out[k] !== null) out[k] = Math.round(out[k]);
  return out;
}

// ---- A cycle ----------------------------------------------------------------

async function cycle(ctx, n) {
  const { p, cdp, o, log } = ctx;
  const step = async (name, f) => {
    if (o.skip.includes(name)) return;
    const t0 = Date.now();
    ctx.mark(name);
    try { await f(); } catch (e) { log(`  cycle ${n} ${name}: ${e.message.split('\n')[0].slice(0, 200)}`); ctx.errors.push(`${n} ${name}: ${e.message.slice(0, 200)}`); }
    ctx.marks.at(-1).s = (Date.now() - t0) / 1000;
  };
  const flyTo = async (key, km) => {
    await p.eval(`orrery.focusOn(${JSON.stringify(key)}), true`);
    await p.wait(500);
    await p.waitFor('!orrery.flying', 30000);
    if (km) await p.zoomTo(km, 1000);
    await p.wait(2500);
  };

  // The reference view, timed after a settle: where cycles are compared.
  const reference = async (label) => {
    await p.eval(setAll(false));
    await p.setRate(1);
    await flyTo('earth', REF.km);
    await p.waitFor(`Math.abs(Math.log(orrery.rig.dist / ${REF.km})) < 0.03`, 15000).catch(() => {});
    await p.wait(o.settle * 1000);
    await p.eval('orrery.__bench.cost.length = 0, orrery.__bench.start.length = 0');
    await p.wait(o.seconds * 1000);
    // Counted after a full collection: the listener count otherwise swings
    // between about 1,000 and 3,600 with when V8 last collected.
    await cdp.send('HeapProfiler.collectGarbage');
    const s = { ...(await p.eval(SAMPLE)), ...processes(ctx.profile), ...(await domCounts(cdp)) };
    ctx.refs.push({ cycle: n, label, t: (Date.now() - ctx.t0) / 1000, load: loadavg()[0], ...s });
    log(`cycle ${n} ${label.padEnd(5)} frame ${f1(s.cost)} ms (p90 ${f1(s.p90)}, gap ${f1(s.gap)}), heap ${s.heapMB} MB, maps ${s.mapsMB} MB, GPU proc ${s.gpuMB} MB, cgroup ${s.cgroupMB} MB, geo ${s.geometries}, tex ${s.textures}, prog ${s.programs}, nodes ${s.nodes}, listeners ${s.listeners}, workers ${s.workers}, load ${loadavg()[0].toFixed(0)}`);
    return s;
  };

  await reference('start');
  await step('layers', async () => {
    const turned = await p.eval(setAll(true));
    await p.wait(8000);
    await p.eval('orrery.__bench.cost.length = 0, orrery.__bench.start.length = 0');
    await p.wait(o.seconds * 1000);
    const s = await p.eval(SAMPLE);
    ctx.allOn.push({ cycle: n, switches: turned, on: await p.eval(LAYERS_ON), ...s });
    log(`cycle ${n} all on (${turned} switches) frame ${f1(s.cost)} ms, gap ${f1(s.gap)}, geo ${s.geometries}, tex ${s.textures}, workers ${s.workers}`);
    if (o.profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
      await p.wait(3000);
      const { profile } = await cdp.send('Profiler.stop');
      ctx.profiles.push({ cycle: n, top: topSelf(profile) });
      log(`cycle ${n} all on, self time: ${ctx.profiles.at(-1).top.slice(0, 6).map((f) => `${f.name} ${f.ms} ms`).join(', ')}`);
    }
    // Half off and on again, one at a time, as a hand would.
    const k = await p.eval(`${SWITCHES}.length`);
    for (let i = 0; i < k; i += 2) { await p.eval(`${SWITCHES}[${i}].click()`); await p.wait(150); }
    await p.wait(2000);
    for (let i = 0; i < k; i += 2) { await p.eval(`${SWITCHES}[${i}].click()`); await p.wait(150); }
    await p.wait(2000);
    await p.eval(setAll(false));
    await p.wait(2000);
    // Each switch alone, against all off: which layer a climb is in.
    if (o.perLayer) {
      const names = await p.eval(`${SWITCHES}.map((b) => b.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40))`);
      const row = { cycle: n };
      await p.eval('orrery.__bench.cost.length = 0, orrery.__bench.start.length = 0');
      await p.wait(2000);
      const off = (await p.eval(SAMPLE)).cost;
      for (let i = 0; i < names.length; i++) {
        await p.eval(`${SWITCHES}[${i}].click()`);
        await p.wait(3000);
        await p.eval('orrery.__bench.cost.length = 0, orrery.__bench.start.length = 0');
        await p.wait(2000);
        const c = (await p.eval(SAMPLE)).cost;
        row[names[i]] = c === null || off === null ? null : +(c - off).toFixed(1);
        await p.eval(`${SWITCHES}[${i}].click()`);
        await p.wait(500);
      }
      ctx.perLayer.push(row);
      log(`cycle ${n} each switch over all off (${f1(off)} ms): ${Object.entries(row).filter(([k]) => k !== 'cycle').map(([k, v]) => `${k} ${v === null ? '—' : `${v >= 0 ? '+' : ''}${v}`}`).join(', ')}`);
    }
  });
  await step('warp', async () => {
    for (const r of [60, 3600, 86400, 7 * 86400, 30 * 86400, 365.25 * 86400, 30 * 86400, 86400, 1]) { await p.setRate(r); await p.wait(2500); }
    await p.setRate(-86400); await p.wait(3000); await p.setRate(1);
  });
  await step('fly', async () => {
    for (const [k, km] of [['mars', 30000], ['jupiter', 700000], ['saturn', 500000], ['moon', 15000], ['sun', 0], ['earth', 0]]) await flyTo(k, km);
  });
  await step('find', async () => {
    for (const q of ['Ceres', 'ISS', 'Halley', 'Apollo 11', 'Titan']) {
      await p.click('.find input, input[type=search]');
      await p.eval(`(() => { const i = document.querySelector('.find input, input[type=search]'); i.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await cdp.send('Input.insertText', { text: q });
      await p.wait(1500);
      await p.key('Enter');
      await p.wait(500);
      await p.waitFor('!orrery.flying', 30000);
      await p.wait(2500);
      await p.key('Escape');
    }
  });
  await step('plot', async () => {
    await p.eval(`(() => { const k = document.querySelector('.console-key'); if (k && k.getAttribute('aria-expanded') !== 'true') k.click(); return true; })()`);
    await p.wait(800);
    await p.click('#ctab-planner');
    await p.wait(800);
    await p.button('Open the plotting table');
    await p.waitFor(`!!document.querySelector('.plot-table')`, 10000);
    await p.wait(5000);
    // Its stations, one after another.
    const tabs = await p.eval(`document.querySelectorAll('.plot-stations [role=tab]').length`);
    for (let i = 0; i < tabs; i++) { await p.eval(`document.querySelectorAll('.plot-stations [role=tab]')[${i}].click()`); await p.wait(1500); }
    await p.key('Escape');
    await p.waitFor(`!document.querySelector('.plot-table')`, 10000);
    await p.eval(`(() => { const k = document.querySelector('.console-key'); if (k?.getAttribute('aria-expanded') === 'true') k.click(); return true; })()`);
    await p.wait(1000);
  });
  await step('craft', async () => {
    const id = await p.eval(`(() => { const c = mission.launchOrbit(orrery.clock.snapshot.timeMs, 400, 51.6); return c.id; })()`);
    await p.wait(1000);
    await p.eval(`orrery.focusOnCraft(${id}), true`);
    await p.waitFor('!orrery.flying', 30000);
    await p.zoomTo(3, 1000);
    await p.wait(4000);
    await p.setRate(3600); await p.wait(4000); await p.setRate(1);
    await p.zoomTo(3000, 1000);
    await p.wait(2000);
    await p.eval(`(() => { const c = mission.crafts.find((c) => c.id === ${id}); if (c) mission.remove(c); return true; })()`);
    await p.wait(2000);
  });
  await step('phone', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await p.wait(4000);
    for (let i = 0; i < 2; i++) {
      await p.eval(`(() => { for (const b of document.querySelectorAll('.sheet-latch')) b.click(); return true; })()`);
      await p.wait(2000);
    }
    await flyTo('mars', 0);
    await flyTo('earth', 0);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...o.view, deviceScaleFactor: 1, mobile: false });
    await p.wait(3000);
  });
  return reference('end');
}

// The functions with the most self time in a CPU profile, in ms.
function topSelf(profile) {
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const nd = byId.get(profile.samples[i]), cf = nd.callFrame;
    const k = `${cf.functionName || '(anonymous)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + (dt[i + 1] ?? 0) / 1000);
  }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, ms]) => ({ name, ms: Math.round(ms) }));
}

async function domCounts(cdp) {
  const d = await cdp.send('Memory.getDOMCounters');
  return { nodes: d.nodes, listeners: d.jsEventListeners, documents: d.documents };
}

// ---- The check ----------------------------------------------------------------

const f1 = (v) => (v === null || v === undefined ? '—' : v.toFixed(1));
const median = (a) => { const s = a.filter((x) => x !== null).sort((x, y) => x - y); const m = s.length >> 1; return !s.length ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Each measure at the reference view: the first cycles against the last,
// with a limit that allows for a busy machine. Memory is allowed to settle
// in the first cycle (caches, JIT, maps seen once), so it compares the end
// of the first cycle with the end of the last.
const LIMITS = [
  ['cost', 'frame cost', 'ms', (a, b) => b - a > Math.max(2, a * 0.25)],
  ['heapMB', 'JS heap', 'MB', (a, b) => b - a > Math.max(40, a * 0.3)],
  ['cgroupMB', 'GPU and page memory', 'MB', (a, b) => b - a > Math.max(400, a * 0.2)],
  ['geometries', 'geometries', '', (a, b) => b - a > 20],
  ['textures', 'textures', '', (a, b) => b - a > 10],
  ['nodes', 'DOM nodes', '', (a, b) => b - a > Math.max(500, a * 0.2)],
  ['listeners', 'event listeners', '', (a, b) => b - a > Math.max(100, a * 0.2)],
  ['workers', 'live workers', '', (a, b) => b > a],
];
// The every-layer-on frame too: a cost that builds up only where a layer
// is drawn (the satellites' SDP4 integrating from ever further away, 19
// November 2026) never shows with every layer off. From the second cycle:
// the first loads each layer's code and data as it is switched on.
const ALL_ON = ['cost', 'frame cost, every layer on', 'ms', (a, b) => b - a > Math.max(5, a * 0.25)];
function verdict(refs, allOn) {
  const ends = refs.filter((r) => r.label === 'end');
  if (ends.length < 2) return { ok: true, lines: ['Fewer than two cycles: nothing to compare'] };
  const part = (a) => [a.slice(0, Math.max(1, Math.floor(a.length / 4))), a.slice(-Math.max(1, Math.floor(a.length / 4)))];
  const lines = [], fails = [];
  const row = (rows, [k, name, unit, bad]) => {
    const [first, last] = part(rows);
    const a = median(first.map((r) => r[k])), b = median(last.map((r) => r[k]));
    if (a === null || b === null) return;
    const fail = bad(a, b);
    lines.push(`| ${name} | ${f1(a)} | ${f1(b)} | ${b - a >= 0 ? '+' : '−'}${f1(Math.abs(b - a))}${unit ? ` ${unit}` : ''} | ${fail ? 'climbs' : 'flat'} |`);
    if (fail) fails.push(name);
  };
  for (const l of LIMITS) row(ends, l);
  const later = allOn.length > 2 ? allOn.slice(1) : allOn;
  if (later.length >= 2) row(later, ALL_ON);
  return { ok: !fails.length, fails, lines: ['| Measure | First cycles | Last cycles | Change | |', '| --- | ---: | ---: | ---: | --- |', ...lines] };
}

// ---- Main -------------------------------------------------------------------

function args() {
  const argv = process.argv.slice(2);
  const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv.splice(i, 2)[1]; };
  const flag = (k) => { const i = argv.indexOf(k); return i < 0 ? false : (argv.splice(i, 1), true); };
  const o = {
    force: flag('--force'), url: opt('--url'), dist: opt('--dist', 'dist'), gpu: opt('--gpu', 'intel'),
    minutes: Number(opt('--minutes', 25)), cycles: Number(opt('--cycles', 0)), size: opt('--size', '1440x900'),
    perLayer: flag('--per-layer'), profile: flag('--profile'),
    skip: (opt('--skip', '') || '').split(',').filter(Boolean), json: opt('--json'),
    settle: Number(opt('--settle', 6)), seconds: Number(opt('--seconds', 5)),
  };
  if (!GPUS.includes(o.gpu)) throw new Error(`--gpu ${o.gpu}: one of ${GPUS.join(', ')}`);
  for (const s of o.skip) if (!STEPS.includes(s)) throw new Error(`--skip ${s}: one of ${STEPS.join(', ')}`);
  const m = o.size.match(/^(\d+)x(\d+)$/);
  if (!m) throw new Error('--size wants WIDTHxHEIGHT');
  o.view = { width: Number(m[1]), height: Number(m[2]) };
  if (argv.length) throw new Error(`Unknown argument ${argv[0]}`);
  return o;
}

async function main() {
  const o = args();
  const log = (s) => console.error(s);
  const lock = await gpuLock({ log, force: o.force });
  let server = null, browser = null;
  const ctx = { o, log, refs: [], allOn: [], samples: [], perLayer: [], profiles: [], marks: [], errors: [], t0: Date.now(),
    mark: (what) => ctx.marks.push({ t: (Date.now() - ctx.t0) / 1000, what }) };
  try {
    let base = o.url?.replace(/\/$/, '');
    if (!base) { server = await serve(o.dist); base = server.url; }
    browser = await launch({ gpu: o.gpu, ...o.view });
    const { cdp } = browser;
    ctx.cdp = cdp; ctx.profile = browser.profile;
    const p = ctx.p = pageApi(cdp);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Performance.enable');
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: x }) => { const m = (x.exception?.description ?? x.text).split('\n').slice(0, 3).map((l) => l.trim()).join(' | '); ctx.errors.push(`page: ${m}`); log(`  page: ${m}`); });
    cdp.on('Inspector.targetCrashed', () => { ctx.errors.push('the renderer crashed'); log('  page: the renderer crashed'); });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE });
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...o.view, deviceScaleFactor: 1, mobile: false });
    // A fresh profile: no kept view or switches (remember.js).
    await p.open(`${base}/${REF.query}`);
    await p.eval(HOOK);
    await p.waitFor('!orrery.flying', 30000);
    const gl = await p.eval(`(() => { const gl = orrery.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`);
    log(`${o.gpu}: ${gl}; ${o.cycles ? `${o.cycles} cycles` : `${o.minutes} minutes`}`);
    ctx.renderer = gl;

    // The sampler, every 10 s whatever the cycle is doing.
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        await p.wait(10000);
        if (!sampling) break;
        try {
          const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
          ctx.samples.push({ t: (Date.now() - ctx.t0) / 1000, ...(await p.eval(SAMPLE)), ...processes(ctx.profile), ...(await domCounts(cdp)),
            jsHeapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1), layouts: m.LayoutCount, styles: m.RecalcStyleCount, scriptS: +m.ScriptDuration.toFixed(1), taskS: +m.TaskDuration.toFixed(1), load: +loadavg()[0].toFixed(1), mark: ctx.marks.at(-1)?.what ?? '' });
        } catch (e) { if (sampling) log(`  sample: ${e.message.slice(0, 120)}`); }
      }
    })();
    const until = ctx.t0 + o.minutes * 60e3;
    try {
      for (let n = 1; o.cycles ? n <= o.cycles : Date.now() < until; n++) await cycle(ctx, n);
    } finally {
      sampling = false;
      await sampler;
    }
  } finally {
    await browser?.close();
    await server?.stop();
    await lock.release();
  }

  const v = verdict(ctx.refs, ctx.allOn);
  const minutes = ((Date.now() - ctx.t0) / 60e3).toFixed(0);
  const onCost = median(ctx.allOn.map((s) => s.cost));
  console.log(`Long run, ${ctx.refs.filter((r) => r.label === 'end').length} cycles in ${minutes} min on ${ctx.renderer}, ${o.view.width} × ${o.view.height}:\n`);
  console.log(v.lines.join('\n'));
  if (onCost !== null) console.log(`\nEvery layer on: ${f1(onCost)} ms a frame (median over cycles; ${ctx.allOn.map((s) => f1(s.cost)).join(', ')}).`);
  if (ctx.errors.length) console.log(`\nErrors:\n${[...new Set(ctx.errors)].slice(0, 20).map((e) => `- ${e}`).join('\n')}`);
  if (o.json) writeFileSync(o.json, JSON.stringify({ options: o, renderer: ctx.renderer, refs: ctx.refs, allOn: ctx.allOn, perLayer: ctx.perLayer, profiles: ctx.profiles, samples: ctx.samples, marks: ctx.marks, errors: ctx.errors, verdict: v }, null, 2));
  if (!v.ok) { console.error(`Climbs over the run: ${v.fails.join(', ')}`); process.exitCode = 1; }
}

export { verdict, PRELUDE };
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
