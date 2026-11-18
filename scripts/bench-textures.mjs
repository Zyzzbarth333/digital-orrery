// Measures what the maps cost to load: the download, the video memory and
// the time to the full sky, with the KTX2 maps and with the WebP ones
// (?webp), interleaved, on a real GPU (docs/performance.md#textures).
//
//   npm run build && npm run bench:textures
//   npm run bench:textures -- --gpu intel,nvidia --dpr 2 --rounds 3
//
// Options:
//   --dist DIR | --url URL   the build (default ./dist)
//   --gpu intel|nvidia[,…]   the GPUs, one after the other (intel)
//   --rounds N               rounds of each variant (3)
//   --size WxH, --dpr N      the viewport (1920x1080, 1)
//   --json FILE              every round's numbers as JSON
//   --force                  start with less memory than the cap needs
//   scenario … | all         sky, moon, mars (all by default)
//
// Each round opens each scenario afresh, with the browser's cache off, in
// both variants (alternating which goes first). Per scenario:
// - download: the bytes of every map file and the Basis transcoder fetched,
//   by the page or its workers (the DevTools protocol's network events);
// - video memory from the formats: what the app's uploader and the sky's
//   tile array allocated (window.orrery with ?debug), level by level;
// - video memory from the driver: the browser's GPU process, from the
//   NVIDIA driver's process table or the i915 driver's fdinfo, which
//   includes the canvas, render targets and buffers as well;
// - three.js's renderer.info.memory.textures (textures three made itself);
// - for the sky, the time from navigation to the first sky (any map) and
//   to the full 8192-wide map, sampled every frame.
// Progress goes to stderr, a Markdown table to stdout.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GPUS, gpuLock, launch, pageApi, serve } from './lib/chromium.mjs';

const DATE = 't=2026-11-10T15:00Z';
const SCENARIOS = {
  sky: { label: 'Start (the Sun and the sky)', query: `?focus=sun&${DATE}` },
  moon: { label: 'The Moon, 6,000 km', query: `?focus=moon&${DATE}`, km: 6000, body: 'moon' },
  mars: { label: 'Mars, 12,000 km', query: `?focus=mars&${DATE}`, km: 12000, body: 'mars' },
};
const VARIANTS = [{ label: 'KTX2', q: '' }, { label: 'WebP', q: '&webp' }];
const GPU_NAME = { intel: 'Intel', nvidia: 'NVIDIA' };

// Installed before the app's scripts: notes, each frame, when the sky first
// shows and when its full map is up (the preview is dropped then).
const WATCH = `(() => {
  const t = window.__tex = { sky: null, full: null };
  const tick = () => {
    const o = window.orrery, s = o && o.stars, m = o && o.manifest;
    if (s && t.sky === null) t.sky = performance.now();
    if (s && m && m.stars && t.full === null && !o.surfaces.cache.has(m.stars.preview) && o.surfaces.cache.has(m.stars.map)) t.full = performance.now();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const STATE = `(() => {
  const o = orrery, d = o.stars && o.stars.userData.skyDetail;
  return {
    sky: __tex.sky, full: __tex.full,
    pending: o.uploader.pending, loading: d ? d.loading.size + d.ready.length : 0,
    upBytes: o.uploader.gpuBytes, tileBytes: d ? d.gpuBytes : 0,
    textures: o.renderer.info.memory.textures,
    unloaded: [...o.unloadedSurfaces],
  };
})()`;

// The GPU memory the driver holds for the browser's GPU process, MiB.
function driverMiB(gpu, groupPid) {
  const pids = execFileSync('pgrep', ['-g', String(groupPid), '-f', 'type=gpu-process']).toString().trim().split('\n').map(Number);
  if (gpu === 'nvidia') {
    const out = execFileSync('nvidia-smi', [], { encoding: 'utf8' });
    let mib = 0;
    for (const line of out.split('\n')) {
      const m = line.match(/^\|\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+.*?(\d+)MiB\s*\|$/);
      if (m && pids.includes(Number(m[1]))) mib += Number(m[2]);
    }
    return mib;
  }
  let bytes = 0;
  for (const pid of pids) {
    for (const fd of readdirSync(`/proc/${pid}/fdinfo`)) {
      let s;
      try { s = readFileSync(`/proc/${pid}/fdinfo/${fd}`, 'utf8'); } catch { continue; }
      if (!/drm-driver:\s+i915/.test(s)) continue;
      // One client can hold several fds to the same device: count each client once.
      const id = s.match(/drm-client-id:\s+(\d+)/)?.[1];
      if (id && driverMiB.seen?.has(`${pid}:${id}`)) continue;
      (driverMiB.seen ??= new Set()).add(`${pid}:${id}`);
      const m = s.match(/drm-total-system0:\s+(\d+)\s*(KiB|MiB)?/);
      if (m) bytes += Number(m[1]) * (m[2] === 'MiB' ? 2 ** 20 : m[2] === 'KiB' ? 1024 : 1);
    }
  }
  driverMiB.seen = null;
  return bytes / 2 ** 20;
}

// Bytes fetched for maps and the transcoder, by the page and its workers
// (the WebP maps are fetched by the decode worker). Workers are attached
// paused, given the network domain, then let run, so no request is missed.
async function countDownloads(cdp) {
  const url = new Map(), got = { bytes: 0, files: 0 };
  const event = (e) => {
    if (e.method === 'Network.requestWillBeSent') url.set(e.params.requestId, e.params.request.url);
    if (e.method === 'Network.loadingFinished' && /\/textures\/|basis_transcoder/.test(url.get(e.params.requestId) ?? '')) {
      got.bytes += e.params.encodedDataLength;
      got.files++;
    }
  };
  cdp.on('Network.requestWillBeSent', (params) => event({ method: 'Network.requestWillBeSent', params }));
  cdp.on('Network.loadingFinished', (params) => event({ method: 'Network.loadingFinished', params }));
  let id = 0;
  const toWorker = (sessionId, method) => cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: ++id, method }) }).catch(() => {});
  cdp.on('Target.attachedToTarget', async (e) => {
    await toWorker(e.sessionId, 'Network.enable');
    await toWorker(e.sessionId, 'Runtime.runIfWaitingForDebugger');
  });
  cdp.on('Target.receivedMessageFromTarget', (e) => { const m = JSON.parse(e.message); if (m.method) event(m); });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
  return got;
}

async function measure(p, browser, gpu, base, sc, v, got) {
  await p.open(`${base}/${sc.query}${v.q}`);
  if (sc.km) {
    await p.waitFor('!orrery.flying', 60000);
    await p.zoomTo(sc.km);
  }
  // Settled: the sky full, the body's maps in, nothing queued, for 2 s.
  const t0 = Date.now();
  let calm = 0, s;
  while (Date.now() - t0 < 90000) {
    s = await p.eval(STATE);
    const done = s.full !== null && s.pending === 0 && s.loading === 0 && (!sc.body || !s.unloaded.includes(sc.body));
    calm = done ? calm + 1 : 0;
    if (calm >= 8) break;
    await p.wait(250);
  }
  if (calm < 8) throw new Error(`not settled in 90 s: ${JSON.stringify(s)}`);
  s.driver = driverMiB(gpu, browser.proc.pid);
  s.bytes = got.bytes;
  s.files = got.files;
  return s;
}

const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); const m = s.length >> 1; return !s.length ? NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mb = (b) => (b / 1e6).toFixed(1);
const mib = (b) => (b / 2 ** 20).toFixed(0);

function args() {
  const argv = process.argv.slice(2);
  const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv.splice(i, 2)[1]; };
  const flag = (k) => { const i = argv.indexOf(k); return i < 0 ? false : (argv.splice(i, 1), true); };
  const o = {
    force: flag('--force'),
    url: opt('--url'), dist: opt('--dist', 'dist'), gpus: opt('--gpu', 'intel').split(','),
    rounds: Number(opt('--rounds', 3)), dpr: Number(opt('--dpr', 1)), size: opt('--size', '1920x1080'), json: opt('--json'),
  };
  for (const g of o.gpus) if (!GPUS.includes(g)) throw new Error(`--gpu ${g}: one of ${GPUS.join(', ')}`);
  const [w, h] = o.size.split('x').map(Number);
  o.view = { width: w, height: h };
  o.names = argv.length && !argv.includes('all') ? argv : Object.keys(SCENARIOS);
  for (const n of o.names) if (!SCENARIOS[n]) throw new Error(`No scenario "${n}": ${Object.keys(SCENARIOS).join(', ')}`);
  return o;
}

async function main() {
  const o = args();
  const results = {};
  // One GPU run at a time, shared with bench:frames and docs:clips.
  const lock = await gpuLock({ force: o.force });
  let server = null;
  try {
    server = o.url ? null : await serve(o.dist);
    const base = o.url ?? server.url;
    for (const gpu of o.gpus) {
      results[gpu] = {};
      for (let r = 0; r < o.rounds; r++) {
        for (const n of o.names) {
          const order = r % 2 ? VARIANTS.slice().reverse() : VARIANTS;
          for (const v of order) {
            // A fresh browser each time, so the driver's figure is this page's alone.
            const browser = await launch({ gpu, ...o.view });
            try {
              const { cdp } = browser;
              const p = pageApi(cdp);
              await cdp.send('Page.enable');
              await cdp.send('Network.enable');
              await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
              await cdp.send('Emulation.setDeviceMetricsOverride', { ...o.view, deviceScaleFactor: o.dpr, mobile: false });
              await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
              const got = await countDownloads(cdp);
              const s = await measure(p, browser, gpu, base, SCENARIOS[n], v, got);
              ((results[gpu][n] ??= {})[v.label] ??= []).push(s);
              console.error(`${gpu} r${r + 1} ${n.padEnd(5)} ${v.label.padEnd(5)} download ${mb(s.bytes)} MB (${s.files} files), maps ${mib(s.upBytes + s.tileBytes)} MiB (tiles ${mib(s.tileBytes)}), driver ${s.driver.toFixed(0)} MiB, three ${s.textures} textures, sky ${s.sky?.toFixed(0)} ms, full ${s.full?.toFixed(0)} ms`);
            } finally {
              await browser.close();
            }
          }
        }
      }
    }
  } finally {
    await server?.stop();
    await lock.release();
  }
  const cols = ['Download, MB', 'Maps in video memory, MiB', 'GPU process (driver), MiB', 'First sky, ms', 'Full sky, ms'];
  console.log(`| Scenario | GPU | ${cols.map((c) => `${c}`).join(' | ')} |`);
  console.log(`| --- | --- | ${cols.map(() => '---:').join(' | ')} |`);
  for (const n of o.names) {
    for (const gpu of o.gpus) {
      const get = (label, f) => median(results[gpu][n][label].map(f));
      const cell = (f, fmt) => `${fmt(get('WebP', f))} → ${fmt(get('KTX2', f))}`;
      console.log(`| ${SCENARIOS[n].label} | ${GPU_NAME[gpu]} | ${cell((s) => s.bytes, mb)} | ${cell((s) => s.upBytes + s.tileBytes, mib)} | ${cell((s) => s.driver, (x) => x.toFixed(0))} | ${cell((s) => s.sky, (x) => x.toFixed(0))} | ${cell((s) => s.full, (x) => x.toFixed(0))} |`);
    }
  }
  console.log(`\nWebP → KTX2, medians of ${o.rounds} rounds, ${o.view.width} × ${o.view.height} at DPR ${o.dpr}, cache off.`);
  if (o.json) writeFileSync(o.json, JSON.stringify({ options: o, results }, null, 2));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
