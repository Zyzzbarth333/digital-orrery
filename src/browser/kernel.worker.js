// @ts-check
// src/browser/kernel.worker.js
//
// Runs the spacecraft kernel off the render thread. All the logic is in
// kernelHost.js; this file only moves messages. Created by KernelClient as a
// module worker, which Vite bundles on its own.

import { createKernelHost } from '@digital-orrery/physics/kernelHost.js';
import { loadDeTable } from './deLoad.js';
import { installMoonLoader } from './moonLoad.js';

const host = createKernelHost();
// DE442's Earth and Moon before the first step (deTable.js). Its tables
// (3.2 MB) can take a while on a slow line, so the worker says when they
// are in: KernelClient's reply timeout counts from then.
const ready = loadDeTable();
ready.then(() => self.postMessage({ type: 'ready' }));
// The moons' tables for a system a craft comes near (moonLoad.js).
installMoonLoader({ onMiss: true });

self.onmessage = async (e) => {
  await ready;
  let reply;
  try {
    reply = host.handle(e.data);
  } catch (err) {
    reply = { type: 'error', error: String(err && /** @type {Error} */ (err).stack || err) };
  }
  self.postMessage(reply);
};
