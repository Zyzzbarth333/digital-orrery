// src/physics/kernelClient.js
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

import { createKernelHost } from './kernelHost.js';

export class KernelClient {
  constructor({ useWorker = true, replyTimeoutMs = 2000 } = {}) {
    this.busy = false;
    this.sentAt = 0;
    this.replyTimeoutMs = replyTimeoutMs;
    this.inflight = new Map();
    this.lastMs = 0;            // kernel time for the last batch
    this.mode = 'main-thread';
    this.host = null;
    this.worker = null;
    if (useWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./kernel.worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => this.onReply(e.data);
        this.worker.onerror = (e) => this.fallBack(`worker error: ${e.message || e}`);
        this.worker.onmessageerror = () => this.fallBack('worker reply could not be read');
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
    // Anything in flight is lost; the crafts resend from their own state and
    // take back the thrust those requests carried.
    for (const craft of this.inflight.values()) craft.dropped?.();
    this.busy = false;
    this.inflight.clear();
  }

  // crafts: objects with id, buildRequest(), applyResult(res) and dropped()
  // (src/physics/craft.js).
  tick(crafts) {
    if (this.busy) {
      // A Worker that never answers would otherwise freeze every craft.
      if (this.worker && performance.now() - this.sentAt > this.replyTimeoutMs) {
        this.fallBack(`no reply in ${this.replyTimeoutMs} ms`);
      } else {
        return false;
      }
    }
    const reqs = [];
    this.inflight.clear();
    for (const craft of crafts) {
      const req = craft.buildRequest();
      if (req) { reqs.push(req); this.inflight.set(req.id, craft); }
    }
    if (reqs.length === 0) return false;
    this.busy = true;
    this.sentAt = performance.now();
    const msg = { type: 'step', crafts: reqs };
    if (this.worker) {
      this.worker.postMessage(msg);
    } else {
      let reply;
      try {
        reply = this.host.handle(msg);
      } catch (err) {
        reply = { type: 'error', error: String(err && err.message || err) };
      }
      this.onReply(reply);
    }
    return true;
  }

  onReply(reply) {
    this.busy = false;
    if (!reply || reply.type !== 'stepped') {
      if (this.worker) {
        this.fallBack(`bad reply: ${reply && (reply.error || reply.type)}`);
      } else {
        console.warn(`KernelClient: kernel failed: ${reply && (reply.error || reply.type)}`);
        for (const craft of this.inflight.values()) craft.dropped?.();
        this.inflight.clear();
      }
      return;
    }
    this.lastMs = reply.ms;
    for (const res of reply.crafts) {
      const craft = this.inflight.get(res.id);
      if (craft) craft.applyResult(res);
    }
    this.inflight.clear();
  }

  dispose() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }
}
