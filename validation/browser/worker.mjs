// validation/browser/worker.mjs: runs one validation in a module worker,
// as Node would run it (gate.mjs). The page sends { name, argv }; the
// worker answers { lines, exitCode, error, seconds }.
//
// As under Node: process.argv names the missions, there is no Worker (so
// KernelClient runs the kernel in this thread), and console's lines are
// collected in order.

const RUNS = {
  artemis1: () => import('../artemis1.validate.mjs'),
  artemis2: () => import('../artemis2.validate.mjs'),
  missions: () => import('../missions.validate.mjs'),
  nesc: () => import('@digital-orrery/physics/nesc.test.mjs'),
  golden: () => import('./golden.mjs'),
};

self.onmessage = async ({ data: { name, argv = [] } }) => {
  const lines = [];
  const say = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : String(x))).join(' '));
  console.log = say; console.info = say; console.warn = say; console.error = say;
  globalThis.process = { argv: ['node', name, ...argv], env: { HOME: '/browser-gate' }, exitCode: undefined, versions: {} };
  self.Worker = undefined;
  const t0 = performance.now();
  let error = null;
  try {
    await RUNS[name]();
  } catch (e) {
    error = `${e?.message ?? e}\n${e?.stack ?? ""}`;
  }
  self.postMessage({ lines, exitCode: globalThis.process.exitCode ?? 0, error, seconds: (performance.now() - t0) / 1000 });
};
