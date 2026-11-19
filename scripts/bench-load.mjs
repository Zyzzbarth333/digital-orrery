// Measures how long the app takes to load over a slow network: the first
// frame, the sky, the Earth's maps and a flight to Mars, on a first visit
// (a fresh browser profile, so nothing is cached), on a real GPU
// (docs/performance.md#loading).
//
//   npm run build && npm run bench:load
//   npm run bench:load -- --url https://zyzzbarth333.github.io/digital-orrery/ --net fast4g,cable
//   npm run bench:load -- --base-dist /tmp/orrery-main/dist --gpu intel,nvidia
//
// Options:
//   --dist DIR | --url URL       the build (default ./dist), served over HTTP/2 with
//                                byte ranges and Pages' max-age=600 (scripts/lib/netshape.mjs)
//   --base-dist DIR | --base-url URL   a second build, timed interleaved as the baseline
//   --net fast4g|cable|none[,…]  network profiles (fast4g); every request, the
//                                page's and its workers', shares one shaped link
//   --gpu intel|nvidia[,…]       the GPUs (intel)
//   --rounds N                   rounds of each (2)
//   --size WxH, --dpr N          the viewport (1920x1080, 1)
//   --json FILE                  every run's numbers, per map, as JSON
//   --force                      start with less memory than the cap needs
//   scenario … | all             start, earth (all by default)
//
// Scenarios:
// - start: the page as a first visit opens it (the Sun and the sky): the
//   first frame, the first sky and the full sky, and every byte fetched
//   until nothing has loaded for 3 s;
// - earth: a link to the Earth (?focus=earth): its day map first shown and
//   at full size, all its maps; once settled, a flight to Mars, and Mars's
//   day and relief maps first shown and full, from the flight's start.
// Per map, the time to fetch it (network), from its last byte to its
// upload starting (decode or transcode, in workers) and its upload.

import { writeFileSync } from 'node:fs';
import { GPUS, gpuLock, launch, pageApi } from './lib/chromium.mjs';
import { PROFILES, shaper, staticServer } from './lib/netshape.mjs';

const DATE = 't=2026-11-10T15:00Z';
const SCENARIOS = {
  start: { label: 'Start (the Sun and the sky)', query: `?${DATE}` },
  earth: { label: 'Earth, then a flight to Mars', query: `?focus=earth&${DATE}` },
};
const GPU_NAME = { intel: 'Intel', nvidia: 'NVIDIA' };

// Installed before the app's scripts. Each frame: when the scene first
// drew, the sky first showed and its full map was up, and when each body's
// day, relief and night maps first showed and showed at full size (a
// preview's texture says so in userData.preview). Each map the surface
// loader is asked for, and each upload, with their times.
const WATCH = `(() => {
  const t = window.__load = { frame: null, sky: null, full: null, maps: {}, loads: {}, uploads: [] };
  let patched = false;
  const patch = (o) => {
    patched = true;
    const load = o.surfaces.load.bind(o.surfaces);
    o.surfaces.load = (path, ...rest) => {
      const p = load(path, ...rest);
      if (!t.loads[path]) { const r = t.loads[path] = { t0: performance.now(), tIn: null }; p.then(() => { r.tIn = performance.now(); }, () => {}); }
      return p;
    };
    const up = o.uploader;
    for (const m of ['upload', 'uploadCompressed']) {
      const f = up[m].bind(up);
      up[m] = (src, colour) => {   // both take (source, colour)
        const w = src.width ?? src.levels[0].width, h = src.height ?? src.levels[0].height;
        const r = { tQ: performance.now(), tDone: null, w, h, compressed: m !== 'upload' };
        t.uploads.push(r);
        const p = f(src, colour);
        p.then(() => { r.tDone = performance.now(); }, () => {});
        return p;
      };
    }
  };
  const tick = () => {
    const now = performance.now(), o = window.orrery;
    if (o && !patched && o.surfaces && o.uploader) patch(o);
    if (o && t.frame === null) t.frame = now;
    const s = o && o.stars, m = o && o.manifest;
    if (s && t.sky === null) t.sky = now;
    if (s && m && m.stars && t.full === null && !o.surfaces.cache.has(m.stars.preview) && o.surfaces.cache.has(m.stars.map)) t.full = now;
    if (o && o.materials) for (const [key, mat] of o.materials) {
      const u = mat.uniforms;
      for (const kind of ['day', 'normal', 'night']) {
        const use = u['use' + kind[0].toUpperCase() + kind.slice(1)];
        const tex = use && use.value === 1 && u[kind + 'Map'].value;
        if (!tex) continue;
        const r = (t.maps[key] ??= {})[kind] ??= { first: now, full: null };
        if (r.full === null && !(tex.userData && tex.userData.preview)) r.full = now;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const STATE = `(() => {
  const o = orrery;
  return { pending: o.uploader.pending, flying: o.rig.flying, now: performance.now(), timeOrigin: performance.timeOrigin, ...__load };
})()`;

// Every request the page and its workers make: url, start and end (page
// clock, ms, once the time origin is known), bytes. Workers are attached
// paused, given the network domain, then let run, so none is missed.
async function watchNetwork(cdp) {
  const reqs = new Map();
  let offset = null;           // wall clock minus the monotonic clock, s
  const event = (method, params) => {
    if (method === 'Network.requestWillBeSent') {
      offset ??= params.wallTime - params.timestamp;
      if (!reqs.has(params.requestId)) reqs.set(params.requestId, { url: params.request.url, start: params.timestamp, end: null, bytes: 0, range: params.request.headers.Range ?? null });
    }
    const r = reqs.get(params.requestId);
    if (!r) return;
    if (method === 'Network.loadingFinished') { r.end = params.timestamp; r.bytes = params.encodedDataLength; }
    if (method === 'Network.loadingFailed') { r.end = params.timestamp; r.failed = params.errorText; }
  };
  for (const m of ['Network.requestWillBeSent', 'Network.loadingFinished', 'Network.loadingFailed']) cdp.on(m, (p) => event(m, p));
  let id = 0;
  const toWorker = (sessionId, method) => cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: ++id, method }) }).catch(() => {});
  cdp.on('Target.attachedToTarget', async (e) => {
    await toWorker(e.sessionId, 'Network.enable');
    await toWorker(e.sessionId, 'Runtime.runIfWaitingForDebugger');
  });
  cdp.on('Target.receivedMessageFromTarget', (e) => { const m = JSON.parse(e.message); if (m.method) event(m.method, m.params); });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
  return {
    inFlight: () => [...reqs.values()].filter((r) => r.end === null).length,
    // Requests on the page's clock, given its time origin (epoch ms).
    list: (timeOrigin) => [...reqs.values()].map((r) => ({
      ...r, start: (r.start + offset) * 1000 - timeOrigin, end: r.end === null ? null : (r.end + offset) * 1000 - timeOrigin,
    })),
  };
}

// Until nothing is queued for upload, no request is open and the test
// holds, for 3 s; at most `ms`.
async function settle(p, net, ms, test = () => true) {
  const t0 = Date.now();
  let calm = 0, s;
  while (Date.now() - t0 < ms) {
    s = await p.eval(STATE);
    calm = s.pending === 0 && !s.flying && net.inFlight() === 0 && test(s) ? calm + 1 : 0;
    if (calm >= 12) return s;
    await p.wait(250);
  }
  throw new Error(`not settled in ${ms / 1000} s: ${JSON.stringify({ pending: s.pending, flying: s.flying, open: net.inFlight(), maps: s.maps })}`);
}

const CATEGORY = [[/\/textures\//, 'maps'], [/\/ephemeris\//, 'ephemeris'], [/\/models\//, 'models'], [/\/data\//, 'data'],
  [/\/missions\/|\/trajbrowser\//, 'missions'], [/basis_transcoder/, 'transcoder'], [/gibs\.earthdata/, 'clouds (NASA GIBS)'], [/\.(js|css|html|woff2?)(\?|$)|\/$/, 'app']];
const category = (url) => CATEGORY.find(([re]) => re.test(url))?.[1] ?? 'other';

// Per map file: its requests' first start and last end, bytes, and the
// load's own times (asked for, in).
function perMap(s, reqs) {
  const out = {};
  for (const r of reqs) {
    const m = r.url.match(/\/textures\/(.+?)(\?|$)/);
    if (!m) continue;
    const f = out[m[1]] ??= { start: Infinity, end: 0, bytes: 0, requests: 0 };
    f.start = Math.min(f.start, r.start);
    f.end = Math.max(f.end, r.end ?? Infinity);
    f.bytes += r.bytes;
    f.requests++;
  }
  for (const [path, l] of Object.entries(s.loads)) {
    const f = out[path] ??= { start: null, end: null, bytes: 0, requests: 0 };
    f.asked = l.t0;
    f.in = l.tIn;
  }
  return out;
}

// The last request's end or upload's finish after `from`, page clock, ms.
function lastActivity(s, reqs, from) {
  const ends = [...reqs.map((r) => r.end), ...s.uploads.map((u) => u.tDone)].filter((t) => t != null && t >= from);
  return ends.length ? Math.max(...ends) : from;
}

async function run(o, t, scName, gpu, proxyPort) {
  const sc = SCENARIOS[scName], base = t.base;
  const browser = await launch({ gpu, ...o.view, args: [
    `--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>',
    ...(o.spki.length ? [`--ignore-certificate-errors-spki-list=${o.spki.join(',')}`] : []),
  ] });
  try {
    const { cdp } = browser;
    const p = pageApi(cdp);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...o.view, deviceScaleFactor: o.dpr, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
    const net = await watchNetwork(cdp);
    await p.open(`${base}${sc.query}`);
    const res = {};
    if (scName === 'start') {
      const s = await settle(p, net, 240000, (s) => s.full !== null);
      res.reqs = net.list(s.timeOrigin);
      Object.assign(res, { frame: s.frame, sky: s.sky, fullSky: s.full, settled: lastActivity(s, res.reqs, 0) });
      res.maps = perMap(s, res.reqs);
      res.uploads = s.uploads;
    } else {
      const earthIn = (s) => ['day', 'normal', 'night'].every((k) => s.maps.earth?.[k]?.full != null);
      let s = await settle(p, net, 300000, earthIn);
      const e = s.maps.earth;
      Object.assign(res, { frame: s.frame, sky: s.sky, earthDayFirst: e.day.first, earthDayFull: e.day.full,
        earthAll: Math.max(e.day.full, e.normal.full, e.night.full), earthSettled: lastActivity(s, net.list(s.timeOrigin), 0) });
      const t0 = await p.eval(`(orrery.focusOn('mars'), performance.now())`);
      const marsIn = (s) => s.maps.mars?.day?.full != null && s.maps.mars?.normal?.full != null;
      s = await settle(p, net, 300000, marsIn);
      const m = s.maps.mars;
      Object.assign(res, { flightStart: t0, marsDayFirst: m.day.first - t0, marsNormalFirst: m.normal.first - t0,
        marsDayFull: m.day.full - t0, marsAll: Math.max(m.day.full, m.normal.full) - t0 });
      res.reqs = net.list(s.timeOrigin);
      res.marsSettled = lastActivity(s, res.reqs, t0) - t0;
      res.maps = perMap(s, res.reqs);
      res.uploads = s.uploads;
    }
    res.bytes = {};
    for (const r of res.reqs) res.bytes[category(r.url)] = (res.bytes[category(r.url)] ?? 0) + r.bytes;
    res.bytes.total = res.reqs.reduce((a, r) => a + r.bytes, 0);
    return res;
  } finally {
    await browser.close();
  }
}

const median = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); const m = s.length >> 1; return !s.length ? NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sec = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : '–');
const mb = (b) => (Number.isFinite(b) ? (b / 1e6).toFixed(1) : '–');

function args() {
  const argv = process.argv.slice(2);
  const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv.splice(i, 2)[1]; };
  const flag = (k) => { const i = argv.indexOf(k); return i < 0 ? false : (argv.splice(i, 1), true); };
  const o = {
    force: flag('--force'),
    url: opt('--url'), dist: opt('--dist', 'dist'), baseUrl: opt('--base-url'), baseDist: opt('--base-dist'),
    gpus: opt('--gpu', 'intel').split(','), nets: opt('--net', 'fast4g').split(','),
    rounds: Number(opt('--rounds', 2)), dpr: Number(opt('--dpr', 1)), size: opt('--size', '1920x1080'), json: opt('--json'),
  };
  for (const g of o.gpus) if (!GPUS.includes(g)) throw new Error(`--gpu ${g}: one of ${GPUS.join(', ')}`);
  for (const n of o.nets) if (!(n in PROFILES)) throw new Error(`--net ${n}: one of ${Object.keys(PROFILES).join(', ')}`);
  const [w, h] = o.size.split('x').map(Number);
  o.view = { width: w, height: h };
  o.names = argv.length && !argv.includes('all') ? argv : Object.keys(SCENARIOS);
  for (const n of o.names) if (!SCENARIOS[n]) throw new Error(`No scenario "${n}": ${Object.keys(SCENARIOS).join(', ')}`);
  return o;
}

const ROWS = {
  start: [['First frame', (r) => r.frame], ['First sky', (r) => r.sky], ['Full sky', (r) => r.fullSky], ['Nothing left to load', (r) => r.settled]],
  earth: [['First frame', (r) => r.frame], ['Earth\'s day map shown', (r) => r.earthDayFirst], ['Earth\'s day map, full size', (r) => r.earthDayFull],
    ['All the Earth\'s maps, full size', (r) => r.earthAll], ['Nothing left to load', (r) => r.earthSettled],
    ['Mars: day map shown, from the flight\'s start', (r) => r.marsDayFirst], ['Mars: day map, full size', (r) => r.marsDayFull],
    ['Mars: day and relief, full size', (r) => r.marsAll], ['Mars: nothing left to load', (r) => r.marsSettled]],
};

async function main() {
  const o = args();
  o.spki = [];
  const targets = [];
  const servers = [];
  const lock = await gpuLock({ force: o.force });
  try {
    const add = async (label, url, dist) => {
      if (url) return targets.push({ label, base: url.replace(/\/?$/, '/') });
      const s = await staticServer(dist);
      servers.push(s);
      o.spki.push(s.spki);
      targets.push({ label, base: `${s.url}/` });
    };
    if (o.baseUrl || o.baseDist) await add('base', o.baseUrl, o.baseDist);
    await add('this', o.url, o.dist);
    const results = {};
    for (const net of o.nets) {
      const proxy = await shaper(net);
      try {
        for (const gpu of o.gpus) {
          for (let r = 0; r < o.rounds; r++) {
            for (const n of o.names) {
              const order = r % 2 ? targets.slice().reverse() : targets;
              for (const t of order) {
                const res = await run(o, t, n, gpu, proxy.port);
                (((results[net] ??= {})[gpu] ??= {})[n] ??= {})[t.label] ??= [];
                results[net][gpu][n][t.label].push(res);
                const rows = ROWS[n].map(([k, f]) => `${k.split(',')[0].toLowerCase()} ${sec(f(res))}`).join(', ');
                console.error(`${net} ${gpu} r${r + 1} ${n} ${t.label}: ${rows}; ${mb(res.bytes.total)} MB`);
              }
            }
          }
        }
      } finally {
        await proxy.close();
      }
    }
    const pair = targets.length > 1;
    for (const n of o.names) {
      console.log(`\n**${SCENARIOS[n].label}**, s from navigation${pair ? ' (base → this)' : ''}:\n`);
      const cols = o.nets.flatMap((net) => o.gpus.map((g) => `${net}, ${GPU_NAME[g]}`));
      console.log(`| | ${cols.join(' | ')} |`);
      console.log(`| --- | ${cols.map(() => '---:').join(' | ')} |`);
      const cell = (net, g, f, fmt) => targets.map((t) => fmt(median(results[net][g][n][t.label].map(f)))).join(' → ');
      for (const [k, f] of ROWS[n]) console.log(`| ${k} | ${o.nets.flatMap((net) => o.gpus.map((g) => cell(net, g, f, sec))).join(' | ')} |`);
      const cats = [...new Set(o.nets.flatMap((net) => o.gpus.flatMap((g) => targets.flatMap((t) => results[net][g][n][t.label].flatMap((r) => Object.keys(r.bytes))))))];
      for (const c of cats.sort((a, b) => (a === 'total') - (b === 'total'))) console.log(`| ${c}, MB | ${o.nets.flatMap((net) => o.gpus.map((g) => cell(net, g, (r) => r.bytes[c] ?? 0, mb))).join(' | ')} |`);
    }
    console.log(`\nMedians of ${o.rounds} rounds, ${o.view.width} × ${o.view.height} at DPR ${o.dpr}, a fresh profile each run. ${o.nets.map((n) => PROFILES[n] ? `${n}: ${PROFILES[n].down / 1e6} / ${PROFILES[n].up / 1e6} Mbit/s, ${PROFILES[n].rttMs} ms` : `${n}: unshaped`).join('; ')}.`);
    if (o.json) writeFileSync(o.json, JSON.stringify({ options: o, targets, results }, null, 1));
  } finally {
    for (const s of servers) await s.close();
    await lock.release();
  }
}

main().catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
