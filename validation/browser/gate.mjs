// validation/browser/gate.mjs: ADR-0001 phase C's Tier 2 in browser
// engines. Each flown-mission validation and the NESC check run in
// Chromium, Firefox and WebKit through Playwright, as Node runs them, and
// must pass at their own stated tolerances. The golden snapshot's API part
// runs too, and reports how far each engine's numbers are from Node's.
//
// A Vite server (the app's config, with node:fs and node:dns replaced by
// shims/) serves the repository; each run is a module worker (worker.mjs)
// on index.html. Nothing here is in package.json: Playwright is installed
// apart, with its browsers, and named by PLAYWRIGHT (a path to its
// package, or 'playwright' if it resolves from here):
//
//   npm install --prefix ~/pw --save-exact playwright@1.65.0
//   (cd ~/pw && npx playwright install chromium firefox webkit)
//   PLAYWRIGHT=~/pw/node_modules/playwright/index.mjs node validation/browser/gate.mjs
//
//   node validation/browser/gate.mjs [--browsers chromium,firefox] [--runs nesc,golden] [--out DIR]
//
// --out: each run's full output, as <browser>-<run>.txt. Run it in a
// memory-capped scope (a browser and a validation take about 2 GB).

import { createServer, mergeConfig } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import baseConfig from '../../vite.config.js';
import { MISSIONS } from '../missions.data.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const BROWSERS = opt('--browsers', 'chromium,firefox,webkit').split(',');
const OUT = opt('--out', null);

// As npm test runs them: each mission on its own.
const RUNS = [
  { id: 'artemis1', name: 'artemis1' },
  { id: 'artemis2', name: 'artemis2' },
  ...Object.keys(MISSIONS).map((m) => ({ id: m, name: 'missions', argv: [m] })),
  { id: 'nesc', name: 'nesc' },
  { id: 'golden', name: 'golden' },
].filter((r) => !opt('--runs') || opt('--runs').split(',').includes(r.id));

// How many checks each run passes under Node, from the golden snapshot's
// record of npm test: a browser must pass the same number, so no check is
// skipped there unnoticed.
const isPass = (l) => /\bPASS\b/.test(l), isFail = (l) => /\bFAIL\b/.test(l);
const NODE_PASSES = {};
for (const part of readFileSync(new URL('../golden/npm-test.txt', import.meta.url), 'utf8').split(/^>>> node /m).slice(1)) {
  const [head, ...lines] = part.split('\n');
  const m = head.match(/^validation\/(artemis[12])\.validate\.mjs$|^validation\/missions\.validate\.mjs (\w+)$|^src\/physics\/(nesc)\.test\.mjs$/);
  if (m) NODE_PASSES[m[1] ?? m[2] ?? m[3]] = lines.filter(isPass).length;
}

const pwPath = process.env.PLAYWRIGHT ?? 'playwright';
const pw = await import(pwPath.startsWith('/') ? pathToFileURL(pwPath).href : pwPath);
const shim = (f) => fileURLToPath(new URL(`./shims/${f}`, import.meta.url));

const server = await createServer(mergeConfig(baseConfig, {
  configFile: false,
  root: ROOT,
  appType: 'mpa',            // a missing file is a 404, not index.html
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 5199, strictPort: false, hmr: false },
  resolve: { alias: { 'node:fs': shim('fs.mjs'), 'node:dns': shim('dns.mjs') } },
}));
await server.listen();
const url = `${server.resolvedUrls.local[0]}validation/browser/index.html`;
if (OUT) mkdirSync(OUT, { recursive: true });

const results = [];
try {
  for (const b of BROWSERS) {
    const browser = await pw[b].launch();
    console.log(`\n${b} ${browser.version()}`);
    for (const run of RUNS) {
      // A fresh page per run, so no module state carries over (as a new
      // Node process).
      const page = await browser.newPage();
      await page.goto(url);
      await page.waitForFunction(() => window.gateReady === true);
      const r = await page.evaluate(({ name, argv }) => window.runValidation(name, argv), { name: run.name, argv: run.argv ?? [] });
      await page.close();
      const pass = r.lines.filter(isPass).length, fail = r.lines.filter(isFail).length, want = NODE_PASSES[run.id];
      // The golden run only reports (golden.mjs); the rest must pass every
      // check Node passes.
      const ok = !r.error && r.exitCode === 0 && fail === 0 && (run.id === 'golden' || (pass > 0 && pass === want));
      results.push({ browser: b, run: run.id, ok, pass, fail, seconds: r.seconds });
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${run.id.padEnd(10)} ${String(pass).padStart(3)} PASS${want === undefined ? '' : ` (Node ${want})`}, ${fail} FAIL, exit ${r.exitCode}, ${r.seconds.toFixed(1)} s${r.error ? `\n       ${r.error.split('\n').slice(0, 4).join('\n       ')}` : ''}`);
      if (!ok) for (const l of r.lines.filter((x) => /\bFAIL\b/.test(x)).slice(0, 8)) console.log(`       ${l}`);
      if (run.id === 'golden') for (const l of r.lines) console.log(`     ${l}`);
      if (OUT) writeFileSync(`${OUT}/${b}-${run.id}.txt`, `${r.lines.join('\n')}\n${r.error ? `\nERROR ${r.error}\n` : ''}exit ${r.exitCode}\n`);
    }
    await browser.close();
  }
} finally {
  await server.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} of ${results.length} runs passed${bad.length ? `; failed: ${bad.map((r) => `${r.browser} ${r.run}`).join(', ')}` : ''}`);
process.exit(bad.length ? 1 : 0);
