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
//
// Each request to the Worker carries a time budget (budgetMs, kernelHost.js):
// the kernel stops when it runs out and the craft's next request carries on
// from where it stopped. A long request (Artemis II's entry under guidance,
// 3-4 s at a day a second) is so flown in pieces, the Worker answers every
// fraction of a second, and the reply timeout is left for a Worker that has
// died. On this thread (no Worker, or after a fallback) a request still runs
// to its end in one go, as Node's checks expect.

import { createKernelHost } from './kernelHost.js';

export class KernelClient {
  // budgetMs: the Worker's time per request. replyTimeoutMs: how long a
  // Worker may stay silent with a request (and no aim) in flight before it
  // is taken for dead; its first reply also waits for the DE442 table to
  // load (kernel.worker.js). createWorker: makes the Worker (a stand-in in
  // Node's checks); Vite bundles kernel.worker.js only from the literal
  // new Worker(new URL(...)) below.
  constructor({ useWorker = true, budgetMs = 200, replyTimeoutMs = 15000, createWorker = null } = {}) {
    this.busy = false;
    this.sentAt = 0;
    this.budgetMs = budgetMs;
    this.replyTimeoutMs = replyTimeoutMs;
    this.inflight = new Map();
    this.aiming = new Map();     // id -> resolve, for aim requests
    this.aimId = 0;
    this.lastMs = 0;            // kernel time for the last batch
    this.mode = 'main-thread';
    this.host = null;
    this.worker = null;
    if (useWorker && (createWorker || typeof Worker !== 'undefined')) {
      try {
        this.worker = createWorker ? createWorker() : new Worker(new URL('./kernel.worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => (e.data && e.data.type === 'aimed' ? this.onAimed(e.data) : this.onReply(e.data));
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
    // take back the thrust those requests carried. Aims in flight answer
    // null (the craft asks again).
    for (const craft of this.inflight.values()) craft.dropped?.();
    for (const resolve of this.aiming.values()) resolve(null);
    this.aiming.clear();
    this.busy = false;
    this.inflight.clear();
  }

  // crafts: objects with id, buildRequest(), applyResult(res) and dropped()
  // (src/physics/craft.js).
  tick(crafts) {
    if (this.busy) {
      // A Worker that never answers would otherwise freeze every craft. A
      // live one answers within its budget, so this is for a dead one (an
      // aim ahead of the step in its queue may take a while, so not then).
      if (this.worker && !this.aiming.size && performance.now() - this.sentAt > this.replyTimeoutMs) {
        this.fallBack(`no reply in ${this.replyTimeoutMs} ms, the worker looks stuck`);
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
    const msg = { type: 'step', crafts: reqs, ...(this.worker ? { budgetMs: this.budgetMs } : {}) };
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

  // An aim (kernelHost.aimTo) worked out in the worker, off this thread:
  // resolves with its answer, or null if it failed. In the worker's queue
  // with the steps; without a worker, worked out here at once.
  aim(req) {
    const id = ++this.aimId, msg = { type: 'aim', id, ...req };
    if (!this.worker) {
      const reply = this.host.handle(msg);
      return Promise.resolve(reply.result ?? null);
    }
    return new Promise((resolve) => { this.aiming.set(id, resolve); this.worker.postMessage(msg); });
  }
  onAimed(reply) {
    const resolve = this.aiming.get(reply.id);
    this.aiming.delete(reply.id);
    if (reply.error) console.warn(`KernelClient: aim failed: ${reply.error}`);
    resolve?.(reply.result ?? null);
  }

  dispose() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }
}
