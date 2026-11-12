// src/physics/kernel.worker.js
//
// Runs the spacecraft kernel off the render thread. All the logic is in
// kernelHost.js; this file only moves messages. Created by KernelClient as a
// module worker, which Vite bundles on its own.

import { createKernelHost } from './kernelHost.js';

const host = createKernelHost();

self.onmessage = (e) => {
  let reply;
  try {
    reply = host.handle(e.data);
  } catch (err) {
    reply = { type: 'error', error: String(err && err.stack || err) };
  }
  self.postMessage(reply);
};
