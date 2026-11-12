// src/simulation/spacecraft/KernelClient.js
//
// Main-thread side of the spacecraft kernel. Runs kernelHost in a Web Worker
// so the n-body sub-stepping never blocks rendering, and falls back to running
// it on this thread when a Worker cannot be created or fails.
//
// One request is in flight at a time. Each frame tick() asks every craft for
// a request (its state at its physics time, the sim clock as the target, and
// the thrust averaged over the frames since its last request). If the Worker
// is still busy, nothing is sent and the next request simply covers a longer
// span, so a slow step makes physics late, never wrong. Results go back to the
// crafts, which drop any computed from a state they have changed since.

import { createKernelHost } from '../../physics/kernelHost.js';

export class KernelClient {
  constructor({ useWorker = true } = {}) {
    this.busy = false;
    this.inflight = new Map();
    this.lastMs = 0;            // kernel time for the last batch
    this.mode = 'main-thread';
    this.host = null;
    this.worker = null;
    if (useWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../../physics/kernel.worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => this.onReply(e.data);
        this.worker.onerror = (e) => this.fallBack(`worker error: ${e.message || e}`);
        this.mode = 'worker';
      } catch (err) {
        this.fallBack(`worker unavailable: ${err.message || err}`);
      }
    }
    if (!this.worker) this.host = createKernelHost();
  }

  fallBack(reason) {
    console.warn(`KernelClient: ${reason}; running the kernel on the main thread`);
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.host = this.host || createKernelHost();
    this.mode = 'main-thread';
    // Anything in flight is lost; the crafts resend from their own state.
    this.busy = false;
    this.inflight.clear();
  }

  // crafts: objects with kernelId, buildKernelRequest(date), applyKernelResult(res).
  tick(crafts, date) {
    if (this.busy) return false;
    const reqs = [];
    this.inflight.clear();
    for (const craft of crafts) {
      const req = craft.buildKernelRequest(date);
      if (req) { reqs.push(req); this.inflight.set(req.id, craft); }
    }
    if (reqs.length === 0) return false;
    this.busy = true;
    const msg = { type: 'step', crafts: reqs };
    if (this.worker) this.worker.postMessage(msg);
    else this.onReply(this.host.handle(msg));
    return true;
  }

  onReply(reply) {
    this.busy = false;
    if (!reply || reply.type !== 'stepped') {
      this.fallBack(`bad reply: ${reply && (reply.error || reply.type)}`);
      return;
    }
    this.lastMs = reply.ms;
    for (const res of reply.crafts) {
      const craft = this.inflight.get(res.id);
      if (craft) craft.applyKernelResult(res);
    }
    this.inflight.clear();
  }

  dispose() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }
}
