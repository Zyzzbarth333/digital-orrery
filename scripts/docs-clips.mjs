// Rebuilds the docs' animated clips (docs/clips/*.webp, *.gif) from the app.
//
//   npm run build && npm run docs:clips              (all clips)
//   npm run docs:clips -- overview-to-earth time-warp (some of them)
//   npm run docs:clips -- --url http://localhost:5173 (an app already up)
//   npm run docs:clips -- --keep                      (keep the frames)
//   npm run docs:clips -- --gif                       (a GIF for every clip)
//
// It drives headless Chromium over the DevTools protocol through
// scripts/lib/chromium.mjs (no extra npm packages): Playwright's Chromium
// by default, or CHROME=/path/to/chrome. The page renders on the real GPU
// through ANGLE, and on an NVIDIA laptop GPU when DOCS_CLIPS_GPU=nvidia
// (PRIME offload); a software renderer draws the same frames, only slowly.
// Each clip records the page's screencast, frames timed as they were
// drawn, then ffmpeg resamples them to a steady rate and writes an
// animated WebP and a GIF fallback. Without --url it serves ./dist with
// `vite preview` on a free port.
//
// Needs Node 22 (or Node 20 with --experimental-websocket) and ffmpeg.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gpuLock, launch, pageApi, serve } from './lib/chromium.mjs';

const OUT = resolve('docs/clips');
const VIEW = { width: 1200, height: 750 }; // CSS px, captured at DPR 1
const WIDTH = 800;     // px, the WebP
const FPS = 15;       // the WebP's frame rate
const GIF_WIDTH = 640; // the GIF fallback, smaller to keep it to a few MB
const GIF_FPS = 10;

// ---- The clips ------------------------------------------------------------
// Each starts from a URL (App.tsx's initialState documents the query) and
// then plays a short script against the page. Times are wall-clock.

// A past day: NASA's daily cloud mosaic for the Earth is complete by then.
const DATE = 't=2026-11-10T15:00Z';
const DAY = 86400;

const CLIPS = {
  // The README's hero: from the inner solar system down to the Earth.
  // It starts at the Earth and flies out to the Sun first, so the Earth's
  // maps and that day's clouds are loaded before the flight in is filmed.
  'overview-to-earth': {
    gif: true, // the README's front page plays everywhere
    query: `?focus=earth&${DATE}`,
    settle: 15000,
    async setup(p) {
      await p.click('.body-row', 'Sun');
      await p.wait(1000);
      await p.waitFor('!orrery.flying');
      await p.wait(2500);
    },
    async play(p) {
      await p.wait(700);
      await p.click('.body-marker', 'Earth');
      await p.wait(6300);
      await p.drag([520, 330], [660, 310], 1200); // round toward the day side
      await p.wait(600);
    },
  },
  // A month a second: the inner planets go round, the clock and the plate
  // run with them.
  'time-warp': {
    query: `?${DATE}`,
    settle: 6000,
    async play(p) {
      await p.zoomTo(5.2e8, 600);
      await p.wait(400);
      await p.setRate(30 * DAY);
      await p.wait(7000);
    },
  },
  // A day a second about Jupiter: the inner and Galilean moons on their
  // orbits from JPL's satellite ephemerides, then a flight to Io.
  'jupiter-moons': {
    query: `?focus=jupiter&${DATE}`,
    settle: 7000,
    async play(p) {
      await p.zoomTo(1.3e6, 600);
      await p.setRate(DAY);
      await p.wait(3800);
      await p.setRate(3600);
      await p.click('.body-marker', 'Io');
      await p.wait(3800);
    },
  },
  // The rail's guides: the Earth's EGM2008 surface gravity and spin axis,
  // then the summed gravity field flowing in the frame turning with the
  // Moon, and the Earth-Moon Lagrange points.
  'guides': {
    query: `?focus=earth&${DATE}`,
    settle: 15000, // the Earth's maps loaded before filming
    async play(p) {
      await p.zoomTo(32000, 400);
      await p.button('Surface gravity');
      await p.button('Spin axes');
      await p.wait(500);
      await p.drag([620, 420], [440, 380], 2600);
      await p.wait(400);
      await p.button('Surface gravity');
      await p.button('Gravity field');
      await p.selectOption('.flow-opts select', 'Rotating');
      await p.button('Lagrange');
      await p.zoomTo(1.3e6, 2200);
      await p.wait(2200);
    },
  },
  // The ROCKET tab: Saturn V from Apollo 11's figures, its ascent, and a
  // launch from LC-39B followed from above.
  'rocket-launch': {
    query: `?${DATE}`,
    settle: 6000,
    async setup(p) {
      await p.button('Console');
      await p.button('Rocket');
      await p.selectOption('.tab-panel select', 'Saturn V');
      await p.wait(400);
    },
    async play(p) {
      await p.wait(500);
      await p.button('Fly the ascent');
      await p.wait(1800);
      await p.button('Launch from the pad');
      await p.wait(1500);
      await p.zoomTo(800, 800);
      await p.drag([510, 300], [510, 450], 900);
      await p.wait(4000);
    },
  },
  // The plotting table: a journey to Mars, a burn node clicked onto its
  // arc, a radial pull that makes it miss, and AIM NODE to bring it back.
  'plotting-table': {
    query: `?plan=mars&${DATE}`,
    settle: 7000,
    async setup(p) {
      await p.button('Add waypoint');
      await p.wait(4000);
    },
    async play(p) {
      await p.wait(600);
      const [x, y] = await p.arcLeft();
      await p.click([x + 2, y]);
      await p.wait(1200);
      await p.drag([x + 59, y + 5], [x + 105, y + 10], 700, 30, 1300);
      await p.wait(1500);
      await p.button('Aim node');
      await p.wait(2500);
    },
  },
  // Every active satellite CelesTrak lists, moved by SGP4: a minute a
  // second, then an hour a second, as the camera turns.
  'satellites': {
    quality: 60, // 17,000 moving points: the WebP is kept near 2 MB
    query: `?focus=earth&${DATE}`,
    settle: 15000, // the Earth's maps loaded before filming
    async setup(p) {
      await p.button('All active');
      await p.wait(2500);
      await p.zoomTo(90000, 0);
      await p.wait(1500);
    },
    async play(p) {
      await p.setRate(60);
      await p.drag([600, 300], [520, 330], 3000);
      await p.setRate(3600);
      await p.drag([520, 330], [430, 360], 4000);
      await p.wait(500);
    },
  },
  // The Earth's magnetic field (IGRF-14) as field lines, and its auroral
  // ovals, as the camera goes round from the day side to the night side.
  'magnetic-field': {
    query: `?focus=earth&${DATE}`,
    settle: 15000, // the Earth's maps loaded before filming
    async setup(p) {
      await p.zoomTo(60000, 0);
      await p.wait(1000);
    },
    async play(p) {
      await p.wait(400);
      await p.button('Magnetic fields');
      await p.button('Auroras');
      await p.wait(900);
      await p.drag([660, 360], [380, 300], 5000);
      await p.wait(1500);
    },
  },
  // Jupiter's irregular moons at a month a second: far out, tilted, most of
  // them going round backwards.
  'irregular-moons': {
    query: `?focus=jupiter&${DATE}`,
    settle: 8000,
    async setup(p) {
      await p.click('.body-row', /^\d+ moons/);
      await p.wait(2000);
      await p.zoomTo(5e7, 0);
      await p.wait(1500);
    },
    async play(p) {
      await p.wait(400);
      await p.setRate(30 * DAY);
      await p.wait(7000);
    },
  },
  // Artemis II from ten minutes before its translunar injection to its
  // return, straight to a day a second, against NASA's reconstructed
  // trajectory.
  'artemis2': {
    query: '?mission=artemis2',
    settle: 9000,
    async setup(p) {
      await p.click('.body-marker', 'Earth');
      await p.wait(4500);
      await p.zoomTo(1.2e6, 0);
      await p.wait(800);
    },
    async play(p) {
      await p.wait(400);
      await p.setRate(DAY);
      await p.wait(8400);
    },
  },
};

// ---- The page -------------------------------------------------------------
// scripts/lib/chromium.mjs's page, and one helper of the plotting table's.

function clipPage(cdp) {
  const p = pageApi(cdp);
  // The plotting scope's transfer arc at its leftmost, found in the
  // canvas's pixels on the row through the Sun (the scope's centre).
  p.arcLeft = () => p.eval(`(() => {
    const c = document.querySelector('.scope-canvas'), b = c.getBoundingClientRect();
    const k = c.width / b.width, row = Math.round(c.height * 0.5);
    const d = c.getContext('2d').getImageData(0, row, c.width, 1).data;
    for (let x = 2; x < c.width / 2; x++) {
      const [r, g, bl] = [d[4 * x], d[4 * x + 1], d[4 * x + 2]];
      if (r > 200 && g > 120 && g < 200 && bl < 90) return [b.left + x / k, b.top + row / k];
    }
    throw new Error('no arc on the scope');
  })()`);
  return p;
}

// ---- Recording and encoding -----------------------------------------------

async function record(cdp, dir, play) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  let writing = Promise.resolve();
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    frames.push({ file, t: metadata.timestamp });
    writing = writing.then(() => writeFileSync(file, Buffer.from(data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  await play();
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame');
  await writing;
  return { frames: frames.filter((f) => f.t >= t0 - 0.05), t0, t1 };
}

// A concat list that holds each frame for as long as it was on screen.
function concatList({ frames, t1 }, file) {
  const lines = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : t1;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${frames.at(-1).file}'`);
  writeFileSync(file, lines.join('\n') + '\n');
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

// An animated WebP the docs show (full colour, under 2 MB a clip), and for
// the clips marked gif (or all, with --gif) a GIF of the same frames for
// viewers without WebP: smaller, at a lower rate and with one 128-colour
// palette for the whole clip. A GIF is four or five times the WebP's size,
// so the others go without.
function encode(rec, dir, name, clip, gif) {
  const list = join(dir, 'frames.txt');
  concatList(rec, list);
  const input = ['-f', 'concat', '-safe', '0', '-i', list];
  ffmpeg([...input, '-vf', `fps=${FPS},scale=${WIDTH}:-2:flags=lanczos`, '-c:v', 'libwebp_anim', '-lossless', '0',
    '-quality', String(clip.quality ?? 70), '-compression_level', '6', '-loop', '0', join(OUT, `${name}.webp`)]);
  if (!gif) return;
  ffmpeg([...input, '-vf',
    `fps=${GIF_FPS},scale=${GIF_WIDTH}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0', join(OUT, `${name}.gif`)]);
}

// ---- Main -----------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i < 0 ? null : argv.splice(i, 2)[1]; };
  const flag = (k) => { const i = argv.indexOf(k); return i < 0 ? false : (argv.splice(i, 1), true); };
  const url = opt('--url');
  const shot = opt('--shot');
  const keep = flag('--keep');
  const allGifs = flag('--gif');
  const names = argv.length ? argv : Object.keys(CLIPS);
  for (const n of names) if (!CLIPS[n] && !shot) throw new Error(`No clip "${n}": ${Object.keys(CLIPS).join(', ')}`);
  mkdirSync(OUT, { recursive: true });

  const work = join(tmpdir(), `docs-clips-${process.pid}`);
  let server = null, browser = null;
  const lock = await gpuLock();
  try {
    server = url ? null : await serve('dist');
    const base = (url ?? server.url).replace(/\/$/, '');
    browser = await launch({ gpu: process.env.DOCS_CLIPS_GPU, ...VIEW });
    const { cdp } = browser;
    const p = clipPage(cdp);
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    if (shot) { // probe: one still of a query, for writing a clip's script
      await cdp.send('Page.navigate', { url: `${base}/${shot}` });
      await p.waitFor(`!!document.querySelector('canvas')`);
      await p.wait(Number(opt('--settle') ?? 6000));
      await p.shot(argv[0] ?? join(work, 'shot.png'));
      console.log(`still: ${argv[0] ?? join(work, 'shot.png')}`);
      return;
    }
    for (const name of names) {
      const clip = CLIPS[name];
      const dir = join(work, name);
      // ?debug exposes window.orrery (for zoomTo); scale=fixed keeps the
      // render scale from dropping while frames are taken.
      await p.open(`${base}/${clip.query}`);
      await p.wait(clip.settle ?? 5000);
      if (clip.setup) await clip.setup(p);
      const rec = await record(cdp, dir, () => clip.play(p));
      if (rec.frames.length < 10) throw new Error(`${name}: only ${rec.frames.length} frames`);
      const gif = allGifs || !!clip.gif;
      encode(rec, dir, name, clip, gif);
      const kb = (f) => `${(statSync(join(OUT, f)).size / 1024).toFixed(0)} kB`;
      const fps = rec.frames.length / (rec.t1 - rec.t0);
      console.log(`${name}: ${rec.frames.length} frames over ${(rec.t1 - rec.t0).toFixed(1)} s (${fps.toFixed(0)} a second drawn); webp ${kb(`${name}.webp`)}${gif ? `, gif ${kb(`${name}.gif`)}` : ''}`);
    }
  } finally {
    await browser?.close();
    await server?.stop();
    await lock.release();
    if (!keep) rmSync(work, { recursive: true, force: true });
    else console.log(`frames kept in ${work}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
