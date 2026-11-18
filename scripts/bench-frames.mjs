// Times the app's frames on a real GPU and prints a Markdown table for a
// pull request (docs/performance.md#measuring has the method).
//
//   npm run build && npm run bench:frames                    (./dist, Intel)
//   npm run bench:frames -- --gpu nvidia earth belt          (some scenarios)
//   npm run bench:frames -- --gpu intel,nvidia --base-dist ../main/dist
//   npm run bench:frames -- --url http://127.0.0.1:5173 --base-url https://…
//   npm run bench:frames -- --list                           (the scenarios)
//
// Options:
//   --dist DIR | --url URL            the build to time (default ./dist)
//   --base-dist DIR | --base-url URL  a baseline, timed interleaved with it
//   --label NAME, --base-label NAME   their names (default after, before)
//   --gpu intel|nvidia[,…]            the GPUs, one after the other (intel)
//   --rounds N                        rounds of every variant (3)
//   --settle S, --seconds S           seconds to load, then to time (8, 4)
//   --size WxH, --dpr N               the viewport (1920x1080, 1)
//   --json FILE                       every round's numbers as JSON
//   scenario … | all                  which scenarios (the defaults below)
//
// Each round loads every scenario afresh in each variant, the variants
// alternating which goes first, so drift in the machine's load falls on
// both. A frame's cost is the app's render callback (window.orrery.frame,
// exposed by ?debug) plus a one-pixel readPixels, which waits for the GPU
// to finish it: CPU and GPU time together, whatever the display's pacing.
// The frame gap is the time from one callback to the next. The table gives
// the median over the timed seconds, then the median over the rounds;
// progress and each round's numbers go to stderr, the table to stdout.
//
// The render scale is held (?scale=fixed). Run one benchmark at a time:
// two browsers share the GPU and time each other.

import { writeFileSync } from 'node:fs';
import { GPUS, launch, pageApi, serve } from './lib/chromium.mjs';

// ---- Scenarios ------------------------------------------------------------
// A URL query (App.tsx's initialState documents it) and a camera distance
// from what it shows, in km. A past date keeps the sky the same each run.

const DATE = 't=2026-11-10T15:00Z';
const CRAFT = 'orrery.focusCraftId !== null';
const SCENARIOS = {
  'overview': { label: 'Overview (the Sun)', query: `?focus=sun&${DATE}`, km: 1.6e9 },
  'earth': { label: 'Earth close-up', query: `?focus=earth&${DATE}`, km: 20000 },
  'belt': { label: 'The asteroid belt', query: `?focus=sun&${DATE}`, km: 9e8 },
  'craft-near': { label: 'Craft in LEO (6-DOF)', query: `?craft=orbit,400,51.6&${DATE}`, km: 0.4, ready: CRAFT },
  'craft-far': { label: 'Craft in LEO (6-DOF)', query: `?craft=orbit,400,51.6&${DATE}`, km: 3000, ready: CRAFT },
  'point-near': { label: 'Craft in LEO (point)', query: `?craft=orbit,400,51.6,point&${DATE}`, km: 0.4, ready: CRAFT },
  'point-far': { label: 'Craft in LEO (point)', query: `?craft=orbit,400,51.6,point&${DATE}`, km: 3000, ready: CRAFT },
};
const DEFAULTS = ['earth', 'belt', 'craft-near', 'craft-far', 'point-near', 'point-far'];
const GPU_NAME = { intel: 'Intel', nvidia: 'NVIDIA' };

// ---- Timing in the page ---------------------------------------------------

// Wraps the scene's frame callback once. OrreryScene.frame asks for the
// next frame with this.frame, so the wrapper stays in the loop.
const HOOK = `(() => {
  const o = window.orrery;
  if (o.__bench) return true;
  const frame = o.frame, gl = o.renderer.getContext(), px = new Uint8Array(4);
  const s = o.__bench = { cost: [], start: [] };
  o.frame = (now) => {
    const t0 = performance.now();
    frame(now);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    s.cost.push(performance.now() - t0);
    s.start.push(t0);
  };
  return true;
})()`;
const RESET = 'orrery.__bench.cost.length = 0, orrery.__bench.start.length = 0';
const STATS = `(() => {
  const { cost, start } = orrery.__bench;
  const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
  const gaps = start.slice(1).map((t, i) => t - start[i]);
  const c = orrery.renderer.domElement;
  return { frames: cost.length, cost: q(cost, 0.5), p90: q(cost, 0.9), worst: Math.max(...cost), gap: q(gaps, 0.5),
    km: orrery.rig.dist, canvas: c.width + ' x ' + c.height };
})()`;
const RENDERER = `(() => {
  const gl = orrery.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info');
  return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
})()`;

// One scenario in one variant: load, frame the camera, settle, time.
async function measure(p, base, sc, opts) {
  await p.open(`${base}/${sc.query}`);
  if (sc.ready) await p.waitFor(sc.ready);
  await p.waitFor('!orrery.flying');
  await p.zoomTo(sc.km);
  await p.waitFor(`Math.abs(Math.log(orrery.rig.dist / ${sc.km})) < 0.02`, 15000);
  await p.eval(HOOK);
  await p.wait(opts.settle * 1000);
  await p.eval(RESET);
  await p.wait(opts.seconds * 1000);
  const s = await p.eval(STATS);
  if (s.frames < 10) throw new Error(`only ${s.frames} frames in ${opts.seconds} s`);
  return s;
}

// ---- Output ---------------------------------------------------------------

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ms = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const kmText = (km) => {
  if (km < 1e6) return `${km.toLocaleString('en-AU')} km`;
  const e = Math.floor(Math.log10(km));
  return `${+(km / 10 ** e).toPrecision(3)} × 10${[...String(e)].map((c) => SUP[c]).join('')} km`;
};
function cell(after, before) {
  if (before === undefined) return ms(after);
  const d = (after - before) / before * 100;
  const pct = Math.abs(d) < 0.5 ? '±0 %' : `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(0)} %`;
  return `${ms(before)} → ${ms(after)} (${pct})`;
}

function table(results, names, variants, gpus) {
  const [after, before] = [variants[0].label, variants[1]?.label];
  const heads = gpus.flatMap((g) => [`${GPU_NAME[g]} frame`, `${GPU_NAME[g]} gap`]);
  const lines = [
    `| Scenario | ${heads.join(' | ')} |`,
    `| --- | ${heads.map(() => '---:').join(' | ')} |`,
  ];
  for (const n of names) {
    const sc = SCENARIOS[n];
    const cells = gpus.flatMap((g) => {
      const get = (label, k) => { const r = results[g][n][label]; return r?.length ? median(r.map((x) => x[k])) : undefined; };
      return ['cost', 'gap'].map((k) => cell(get(after, k), before && get(before, k)));
    });
    lines.push(`| ${sc.label}, ${kmText(sc.km)} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

// ---- Main -----------------------------------------------------------------

function args() {
  const argv = process.argv.slice(2);
  const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv.splice(i, 2)[1]; };
  const flag = (k) => { const i = argv.indexOf(k); return i < 0 ? false : (argv.splice(i, 1), true); };
  const num = (k, d) => { const v = Number(opt(k, d)); if (!(v > 0)) throw new Error(`${k} wants a positive number`); return v; };
  const o = {
    list: flag('--list'),
    url: opt('--url'), dist: opt('--dist'), baseUrl: opt('--base-url'), baseDist: opt('--base-dist'),
    label: opt('--label'), baseLabel: opt('--base-label'),
    gpus: opt('--gpu', 'intel').split(','),
    rounds: num('--rounds', 3), settle: num('--settle', 8), seconds: num('--seconds', 4), dpr: num('--dpr', 1),
    size: opt('--size', '1920x1080'), json: opt('--json'),
  };
  for (const g of o.gpus) if (!GPUS.includes(g)) throw new Error(`--gpu ${g}: one of ${GPUS.join(', ')}`);
  const m = o.size.match(/^(\d+)x(\d+)$/);
  if (!m) throw new Error('--size wants WIDTHxHEIGHT, as 1920x1080');
  o.view = { width: Number(m[1]), height: Number(m[2]) };
  const unknown = argv.find((a) => a.startsWith('--'));
  if (unknown) throw new Error(`Unknown option ${unknown}`);
  o.names = argv.includes('all') ? Object.keys(SCENARIOS) : argv.length ? argv : DEFAULTS;
  for (const n of o.names) if (!SCENARIOS[n]) throw new Error(`No scenario "${n}": ${Object.keys(SCENARIOS).join(', ')}`);
  if (o.url && o.dist) throw new Error('--url or --dist, not both');
  if (o.baseUrl && o.baseDist) throw new Error('--base-url or --base-dist, not both');
  return o;
}

async function main() {
  const o = args();
  if (o.list) {
    for (const [n, sc] of Object.entries(SCENARIOS)) console.log(`${n.padEnd(12)} ${sc.label}, ${kmText(sc.km)}: ${sc.query}${DEFAULTS.includes(n) ? '' : ' (not by default)'}`);
    return;
  }
  const hasBase = !!(o.baseUrl || o.baseDist);
  const variants = [{ label: o.label ?? (hasBase ? 'after' : 'this build'), url: o.url, dist: o.url ? null : (o.dist ?? 'dist') }];
  if (hasBase) variants.push({ label: o.baseLabel ?? 'before', url: o.baseUrl, dist: o.baseDist });
  if (variants[1]?.label === variants[0].label) throw new Error('The two variants need different labels');

  const results = {};
  const renderers = {};
  const log = (s) => console.error(s);
  const started = new Date();
  try {
    for (const v of variants) {
      if (v.dist) { v.server = await serve(v.dist); v.base = v.server.url; } else v.base = v.url.replace(/\/$/, '');
      v.where = v.dist ?? v.url;
    }
    for (const gpu of o.gpus) {
      results[gpu] = Object.fromEntries(o.names.map((n) => [n, Object.fromEntries(variants.map((v) => [v.label, []]))]));
      const browser = await launch({ gpu, ...o.view });
      try {
        const { cdp } = browser;
        const p = pageApi(cdp);
        await cdp.send('Page.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', { ...o.view, deviceScaleFactor: o.dpr, mobile: false });
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        for (let r = 0; r < o.rounds; r++) {
          for (const n of o.names) {
            const order = r % 2 ? variants.slice().reverse() : variants;
            for (const v of order) {
              const s = await measure(p, v.base, SCENARIOS[n], o).catch((e) => { throw new Error(`${gpu}, round ${r + 1}, ${n}, ${v.label}: ${e.message}`); });
              if (!renderers[gpu]) {
                renderers[gpu] = await p.eval(RENDERER);
                log(`${gpu}: ${renderers[gpu]}, canvas ${s.canvas}`);
                if (gpu === 'nvidia' && !/nvidia/i.test(renderers[gpu])) throw new Error(`--gpu nvidia, but the page renders on ${renderers[gpu]}`);
              }
              results[gpu][n][v.label].push(s);
              log(`${gpu} r${r + 1} ${n.padEnd(10)} ${v.label.padEnd(10)} frame ${ms(s.cost)} ms (p90 ${ms(s.p90)}, worst ${ms(s.worst)}), gap ${ms(s.gap)} ms, ${s.frames} frames, camera ${kmText(+s.km.toPrecision(3))}`);
            }
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    for (const v of variants) await v.server?.stop();
  }

  const day = started.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const what = hasBase ? `${variants[1].label} (${variants[1].where}) → ${variants[0].label} (${variants[0].where})` : `${variants[0].where}`;
  console.log(`Frame cost and frame gap, median ms, ${what}:\n`);
  console.log(table(results, o.names, variants, o.gpus));
  console.log(`\n\`npm run bench:frames\`, ${day}: ${o.view.width} × ${o.view.height} at DPR ${o.dpr}, ${o.rounds} round${o.rounds === 1 ? '' : 's'}${variants.length > 1 ? ' interleaved' : ''}, ${o.seconds} s timed after ${o.settle} s; ${o.gpus.map((g) => `${GPU_NAME[g]}: ${renderers[g]}`).join('; ')}.`);
  if (o.json) writeFileSync(o.json, JSON.stringify({ started, options: { ...o, names: o.names }, renderers, variants: variants.map(({ label, where }) => ({ label, where })), results }, null, 2));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
