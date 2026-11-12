// src/physics/kernel.worker.js
//
// Runs the spacecraft kernel off the render thread. All the logic is in
// kernelHost.js; this file only moves messages. Created by KernelClient as a
// module worker, which Vite bundles on its own.

import { createKernelHost } from './kernelHost.js';
import { loadDeTable } from './deLoad.js';

const host = createKernelHost();
// DE442's Earth and Moon before the first step (deTable.js).
const ready = loadDeTable();

self.onmessage = async (e) => {
  await ready;
  let reply;
  try {
    reply = host.handle(e.data);
  } catch (err) {
    reply = { type: 'error', error: String(err && err.stack || err) };
  }
  self.postMessage(reply);
};
