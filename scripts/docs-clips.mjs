// Rebuilds the docs' animated clips (docs/clips/*.webp, *.gif) from the app.
//
//   npm run build && npm run docs:clips              (all clips)
//   npm run docs:clips -- overview-to-earth time-warp (some of them)
//   npm run docs:clips -- --url http://localhost:5173 (an app already up)
//   npm run docs:clips -- --keep                      (keep the frames)
//   npm run docs:clips -- --gif                       (a GIF for every clip)
//
// It drives headless Chromium over the DevTools protocol (no extra npm
// packages): Playwright's Chromium by default, or CHROME=/path/to/chrome.
// The page renders on the real GPU through ANGLE, and on an NVIDIA laptop
// GPU when DOCS_CLIPS_GPU=nvidia (PRIME offload); a software renderer
// draws the same frames, only slowly. Each clip records the page's
// screencast, frames timed as they were drawn, then ffmpeg resamples them
// to a steady rate and writes an animated WebP and a GIF fallback.
// Without --url it serves ./dist with `vite preview` on port 4179.
//
// Needs Node 22 (or Node 20 with --experimental-websocket) and ffmpeg.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
  // The rail's guides: the Earth's EGM2008 gravity field and spin axis,
  // then its sphere of influence and the Earth-Moon Lagrange points.
  'guides': {
    query: `?focus=earth&${DATE}`,
    settle: 7000,
    async play(p) {
      await p.zoomTo(32000, 400);
      await p.button('Gravity field');
      await p.button('Spin axes');
      await p.wait(500);
      await p.drag([620, 420], [440, 380], 2600);
      await p.wait(400);
      await p.button('SOI and Hill');
      await p.button('Lagrange');
      await p.zoomTo(2.6e6, 2200);
      await p.wait(1800);
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
  // Artemis II from ten minutes before its translunar injection to its
  // return, a day a second, against NASA's reconstructed trajectory.
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
      await p.setRate(3600); // through the injection burn, then a day a second
      await p.wait(1500);
      await p.setRate(DAY);
      await p.wait(7400);
    },
  },
};

// ---- Browser --------------------------------------------------------------

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const c = join(root, d, 'chrome-linux64/chrome');
    if (existsSync(c)) return c;
  }
  throw new Error('No Chromium found: set CHROME, or run `npx playwright install chromium`');
}

async function launch(profile) {
  const env = { ...process.env };
  if (process.env.DOCS_CLIPS_GPU === 'nvidia') {
    env.__NV_PRIME_RENDER_OFFLOAD = '1';
    env.__EGL_VENDOR_LIBRARY_FILENAMES = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
    env.__GLX_VENDOR_LIBRARY_NAME = 'nvidia';
  }
  const proc = spawn(findChrome(), [
    '--headless=new', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--hide-scrollbars', '--mute-audio', `--window-size=${VIEW.width},${VIEW.height}`,
    'about:blank',
  ], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((ok, fail) => {
    let buf = '';
    const t = setTimeout(() => fail(new Error('Chromium did not start')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\S+)/);
      if (m) { clearTimeout(t); ok(m[1]); }
    });
    proc.on('exit', (c) => fail(new Error(`Chromium exited (${c})`)));
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('chrome'));
  return { proc, cdp: await connect(page.webSocketDebuggerUrl) };
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method) (listeners.get(msg.method) ?? []).forEach((f) => f(msg.params));
  };
  return {
    send: (method, params = {}) => new Promise((ok, fail) => { pending.set(++id, { ok, fail }); ws.send(JSON.stringify({ id, method, params })); }),
    on: (method, f) => listeners.set(method, [...(listeners.get(method) ?? []), f]),
    off: (method) => listeners.delete(method),
    close: () => ws.close(),
  };
}

// The page, as the clips' scripts see it.
function pageApi(cdp) {
  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const p = {
    eval: evaluate,
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    async waitFor(expr, ms = 30000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await evaluate(expr)) return; await p.wait(100); }
      throw new Error(`Timed out waiting for ${expr}`);
    },
    // The centre of the first element matching the selector (and holding the text).
    async centre(sel, text) {
      const r = await evaluate(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
        const el = ${text ? `els.find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))` : 'els[0]'};
        if (!el) return null;
        el.scrollIntoView({ block: 'nearest' });
        const b = el.getBoundingClientRect();
        return [b.x + b.width / 2, b.y + b.height / 2];
      })()`);
      if (!r) throw new Error(`No element ${sel}${text ? ` "${text}"` : ''}`);
      return r;
    },
    // A click on an element (by selector and leading text) or at a point.
    async click(sel, text) {
      const [x, y] = Array.isArray(sel) ? sel : await p.centre(sel, text);
      await mouse('mouseMoved', x, y, { buttons: 0 });
      await mouse('mousePressed', x, y);
      await mouse('mouseReleased', x, y);
    },
    button: (text) => p.click('button', text),
    // A drag in steps over ms, as a hand would, held for hold ms at the end.
    async drag([x0, y0], [x1, y1], ms = 1500, steps = 40, hold = 0) {
      await mouse('mouseMoved', x0, y0, { buttons: 0 });
      await mouse('mousePressed', x0, y0);
      for (let i = 1; i <= steps; i++) {
        const f = (1 - Math.cos(Math.PI * i / steps)) / 2;
        await mouse('mouseMoved', x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
        await p.wait(ms / steps);
      }
      if (hold) await p.wait(hold);
      await mouse('mouseReleased', x1, y1);
    },
    // The sky's wheel zoom to a camera distance (km), in steps over ms.
    // It reads the distance through ?debug's window.orrery (the camera rig's
    // goal), and zooms as OrreryScene.onWheel does: a factor exp(0.0015 dy).
    async zoomTo(km, ms = 0) {
      await p.waitFor('!orrery.flying');
      const now = await evaluate('orrery.rig.goalDistance');
      const total = Math.log(km / now) / 0.0015;
      const steps = Math.max(1, Math.round(ms / 50));
      const [x, y] = await p.centre('canvas');
      for (let i = 0; i < steps; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: total / steps });
        if (steps > 1) await p.wait(ms / steps);
      }
    },
    // A <select>'s option by its leading text, as a choice would set it.
    selectOption: (sel, text) => evaluate(`(() => {
      const s = document.querySelector(${JSON.stringify(sel)});
      const o = [...s.options].find((o) => o.text.startsWith(${JSON.stringify(text)}));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value);
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return o.text;
    })()`),
    // The plotting scope's transfer arc at its leftmost, found in the
    // canvas's pixels on the row through the Sun (the scope's centre).
    arcLeft: () => evaluate(`(() => {
      const c = document.querySelector('.scope-canvas'), b = c.getBoundingClientRect();
      const k = c.width / b.width, row = Math.round(c.height * 0.5);
      const d = c.getContext('2d').getImageData(0, row, c.width, 1).data;
      for (let x = 2; x < c.width / 2; x++) {
        const [r, g, bl] = [d[4 * x], d[4 * x + 1], d[4 * x + 2]];
        if (r > 200 && g > 120 && g < 200 && bl < 90) return [b.left + x / k, b.top + row / k];
      }
      throw new Error('no arc on the scope');
    })()`),
    async key(key, code = key) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key === ' ' ? 32 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
    },
    // The header's rate (sim seconds per second) and RUN/HOLD keys.
    setRate: (rate) => evaluate(`(() => {
      const s = document.querySelector('#rate');
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      set.call(s, String(${rate}));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return s.value;
    })()`),
    run: (on) => p.click(on ? '.key.run' : '.key.hold'),
    async shot(file) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },
  };
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

async function serve() {
  if (!existsSync('dist/index.html')) throw new Error('No ./dist: run `npm run build` first, or pass --url');
  // Its own process group, so stopping it stops vite as well as npx.
  const proc = spawn('npx', ['vite', 'preview', '--port', '4179', '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
  proc.stop = () => { try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* gone */ } };
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:4179/')).ok) return proc; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.stop();
  throw new Error('vite preview did not start on port 4179');
}

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

  const server = url ? null : await serve();
  const base = (url ?? 'http://127.0.0.1:4179').replace(/\/$/, '');
  const work = join(tmpdir(), `docs-clips-${process.pid}`);
  const { proc, cdp } = await launch(join(work, 'profile'));
  const p = pageApi(cdp);
  try {
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
      const go = async (q) => {
        await cdp.send('Page.navigate', { url: `${base}/${q}&debug&scale=fixed` });
        await p.waitFor(`!!document.querySelector('canvas') && !!window.orrery`);
      };
      await go(clip.query);
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
    cdp.close();
    proc.kill();
    server?.stop();
    if (!keep) rmSync(work, { recursive: true, force: true });
    else console.log(`frames kept in ${work}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
