// Headless Chromium on this machine's real GPU, driven over the DevTools
// protocol with no npm packages, for scripts/docs-clips.mjs and
// scripts/bench-frames.mjs.
//
// The browser is Playwright's Chromium (~/.cache/ms-playwright) or
// CHROME=/path/to/chrome. It renders through ANGLE's GL-EGL backend on the
// integrated GPU, or on an NVIDIA GPU with gpu 'nvidia' (PRIME offload).
// Each browser and server runs in its own process group with a fresh
// profile, and is stopped by its group id (never by a name pattern) when
// closed, on an error or on Ctrl-C; the profile is removed once the browser
// has exited.
//
// Needs Node 22 (or Node 20 with --experimental-websocket).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ---- Cleanup --------------------------------------------------------------
// Everything started here, stopped on close, on an error or on a signal.

const open = new Set(); // { stop: async () => void, kill: () => void }

const killGroup = (pid, sig) => { try { process.kill(-pid, sig); } catch { /* gone */ } };

// The process group's exit: SIGTERM, then SIGKILL after ms if the leader
// is still up, then SIGKILL for any helper left in the group.
function stopGroup(proc, ms = 5000) {
  return new Promise((done) => {
    const finish = () => { clearTimeout(t); killGroup(proc.pid, 'SIGKILL'); done(); };
    if (proc.exitCode !== null || proc.signalCode !== null) return finish();
    const t = setTimeout(() => killGroup(proc.pid, 'SIGKILL'), ms);
    proc.once('exit', finish);
    killGroup(proc.pid, 'SIGTERM');
  });
}

function track(entry) {
  open.add(entry);
  return () => open.delete(entry);
}

let stopping = false;
async function stopAll(code) {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([...open].map((e) => e.stop()));
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { console.error(`\n${sig}: stopping`); void stopAll(130); });
// A last resort if the process exits with something still running.
process.once('exit', () => { for (const e of open) e.kill(); });

// ---- Browser --------------------------------------------------------------

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const c = join(root, d, 'chrome-linux64/chrome');
    if (existsSync(c)) return c;
  }
  throw new Error('No Chromium found: set CHROME, or run `npx playwright install chromium`');
}

export const GPUS = ['intel', 'nvidia'];

// The environment that puts the browser on a GPU. 'intel' (or anything
// else) is the default EGL device, the integrated GPU on a hybrid laptop.
export function gpuEnv(gpu) {
  const env = { ...process.env };
  if (gpu === 'nvidia') {
    env.__NV_PRIME_RENDER_OFFLOAD = '1';
    env.__EGL_VENDOR_LIBRARY_FILENAMES = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
    env.__GLX_VENDOR_LIBRARY_NAME = 'nvidia';
  }
  return env;
}

// A headless browser on its first page: { proc, cdp, profile, close }.
// close() is safe to call twice and never throws.
export async function launch({ gpu = 'intel', width = 1200, height = 750 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'orrery-chromium-'));
  const proc = spawn(findChrome(), [
    '--headless=new', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', `--window-size=${width},${height}`,
    'about:blank',
  ], { env: gpuEnv(gpu), stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let cdp = null;
  let closed = null;
  const close = () => closed ??= (async () => {
    try { cdp?.close(); } catch { /* already */ }
    await stopGroup(proc);
    rmSync(profile, { recursive: true, force: true });
    untrack();
  })();
  const untrack = track({ stop: close, kill: () => killGroup(proc.pid, 'SIGKILL') });
  try {
    const wsUrl = await new Promise((ok, fail) => {
      let buf = '';
      const t = setTimeout(() => fail(new Error('Chromium did not start in 20 s')), 20000);
      proc.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\S+)/);
        if (m) { clearTimeout(t); ok(m[1]); }
      });
      proc.once('error', (e) => { clearTimeout(t); fail(e); });
      proc.once('exit', (c) => { clearTimeout(t); fail(new Error(`Chromium exited (${c})`)); });
    });
    proc.stderr.resume(); // keep draining it
    const port = new URL(wsUrl).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('chrome'));
    cdp = await connect(page.webSocketDebuggerUrl);
    return { proc, cdp, profile, close };
  } catch (e) {
    await close();
    throw e;
  }
}

// A DevTools session: send(method, params), on(event, f), off(event).
export async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error(`No DevTools socket at ${url}`)); });
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
  ws.onclose = () => { for (const { fail } of pending.values()) fail(new Error('DevTools socket closed')); pending.clear(); };
  return {
    send: (method, params = {}) => new Promise((ok, fail) => {
      if (ws.readyState !== WebSocket.OPEN) return fail(new Error('DevTools socket closed'));
      pending.set(++id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params }));
    }),
    on: (method, f) => listeners.set(method, [...(listeners.get(method) ?? []), f]),
    off: (method) => listeners.delete(method),
    close: () => ws.close(),
  };
}

// ---- The page -------------------------------------------------------------

// The page, as a script sees it: evaluation, waits, clicks, drags, the
// sky's zoom and the header's controls.
export function pageApi(cdp) {
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
    // The app at a URL with ?debug (window.orrery) and a fixed render
    // scale (the canvas keeps its full ratio while frames are taken or
    // timed), once its scene is up.
    async open(url) {
      const sep = url.includes('?') ? '&' : '?';
      const full = `${url}${sep}debug&scale=fixed`;
      const r = await cdp.send('Page.navigate', { url: full });
      if (r.errorText) throw new Error(`${full}: ${r.errorText}`);
      await p.waitFor(`!!document.querySelector('canvas') && !!window.orrery`);
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

// ---- Serving a build ------------------------------------------------------

// A free TCP port on the loopback interface.
export function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

// A production build (a directory holding index.html) served with
// `vite preview` on port, or a free port: { url, stop }.
export async function serve(dir = 'dist', port = 0) {
  const out = resolve(dir);
  if (!existsSync(join(out, 'index.html'))) throw new Error(`No build in ${dir}: run \`npm run build\` first, or pass a URL`);
  port ||= await freePort();
  const vite = resolve('node_modules/vite/bin/vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--outDir', out, '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { stdio: 'ignore', detached: true });
  let stopped = null;
  const stop = () => stopped ??= stopGroup(proc).then(() => untrack());
  const untrack = track({ stop, kill: () => killGroup(proc.pid, 'SIGKILL') });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100 && proc.exitCode === null; i++) {
    try { if ((await fetch(`${url}/`)).ok) return { url, stop }; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  await stop();
  throw new Error(`vite preview did not start on port ${port} for ${dir}`);
}
