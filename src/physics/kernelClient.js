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
//
// The Worker loads its tables (deLoad.js, 3.2 MB) before its first answer,
// and says when they are in ({ type: 'ready' }). Until then the wait is a
// load, not a dead Worker, and has its own, longer timeout.

import { createKernelHost } from './kernelHost.js';

export class KernelClient {
  // budgetMs: the Worker's time per request. replyTimeoutMs: how long a
  // Worker that has loaded its tables may stay silent with a request in
  // flight before it is taken for dead, counted from its ready message at
  // the earliest. aimTimeoutMs: the same while an aim is in its queue, which
  // may take seconds (kernelHost.aimTo's rounds) before the step behind it
  // is answered. loadTimeoutMs: how long the loading may take
  // (a fetch that hangs), from the Worker's start. createWorker: makes the
  // Worker (a stand-in in Node's checks); Vite bundles kernel.worker.js only
  // from the literal new Worker(new URL(...)) below. lazy: the Worker
  // starts at start() or the first request, not here (App.tsx: React's
  // StrictMode builds a Mission it then throws away, whose Worker nothing
  // would stop).
  constructor({ useWorker = true, budgetMs = 200, replyTimeoutMs = 15000, aimTimeoutMs = 60000, loadTimeoutMs = 120000, createWorker = null, lazy = false } = {}) {
    this.useWorker = useWorker;
    this.createWorker = createWorker;
    this.started = false;
    this.disposed = false;
    this.busy = false;
    this.sentAt = 0;
    this.startedAt = performance.now();
    this.readyAt = null;         // when the Worker said its tables are in
    this.loadTimeoutMs = loadTimeoutMs;
    this.budgetMs = budgetMs;
    this.replyTimeoutMs = replyTimeoutMs;
    this.aimTimeoutMs = aimTimeoutMs;
    this.heardAt = 0;            // the Worker's last message, or the last aim sent
    this.inflight = new Map();
    this.aiming = new Map();     // id -> resolve, for aim requests
    this.aimId = 0;
    this.lastMs = 0;            // kernel time for the last batch
    this.mode = 'main-thread';
    this.host = null;
    this.worker = null;
    if (!lazy) this.start();
  }

  // Starts the Worker (once; a no-op after dispose()), which loads its
  // tables at once.
  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    this.startedAt = performance.now();
    const { useWorker, createWorker } = this;
    if (useWorker && (createWorker || typeof Worker !== 'undefined')) {
      try {
        this.worker = createWorker ? createWorker() : new Worker(new URL('./kernel.worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
          const type = e.data && e.data.type;
          this.heardAt = performance.now();
          if (type === 'ready') this.readyAt = performance.now();
          else if (type === 'aimed') this.onAimed(e.data);
          else this.onReply(e.data);
        };
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
    if (this.disposed) return false;
    this.start();
    if (this.busy) {
      // A Worker that never answers would otherwise freeze every craft. A
      // live one answers within its budget, so this is for a dead one. An
      // aim ahead of the step in its queue may take a while, so with one in
      // flight the wait is the longer aimTimeoutMs, not none at all: a
      // Worker that hangs on an aim must not freeze every craft for good.
      const now = performance.now();
      if (this.worker && this.readyAt === null) {
        if (now - this.startedAt > this.loadTimeoutMs) this.fallBack(`worker tables not loaded in ${this.loadTimeoutMs / 1000} s`);
        else return false;
      } else if (this.worker && now - Math.max(this.sentAt, this.readyAt, this.heardAt) > (this.aiming.size ? this.aimTimeoutMs : this.replyTimeoutMs)) {
        this.fallBack(`no reply in ${this.aiming.size ? this.aimTimeoutMs : this.replyTimeoutMs} ms, the worker looks stuck`);
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
  // with the steps; without a worker, worked out here at once, and a throw
  // there answers null as the worker's failure does (it runs inside the
  // frame loop, mission.ts).
  aim(req) {
    if (this.disposed) return Promise.resolve(null);
    this.start();
    const id = ++this.aimId, msg = { type: 'aim', id, ...req };
    if (!this.worker) {
      try {
        return Promise.resolve(this.host.handle(msg).result ?? null);
      } catch (err) {
        console.warn(`KernelClient: aim failed: ${err && err.message || err}`);
        return Promise.resolve(null);
      }
    }
    this.heardAt = performance.now();
    return new Promise((resolve) => { this.aiming.set(id, resolve); this.worker.postMessage(msg); });
  }
  onAimed(reply) {
    const resolve = this.aiming.get(reply.id);
    this.aiming.delete(reply.id);
    if (reply.error) console.warn(`KernelClient: aim failed: ${reply.error}`);
    resolve?.(reply.result ?? null);
  }

  // Aims still waiting answer null, so nothing waits on a client that is
  // gone.
  dispose() {
    this.disposed = true;
    if (this.worker) this.worker.terminate();
    this.worker = null;
    for (const resolve of this.aiming.values()) resolve(null);
    this.aiming.clear();
  }
}
