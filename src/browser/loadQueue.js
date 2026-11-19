// @ts-check
// src/browser/loadQueue.js
//
// One queue for the large downloads, so what is looked at arrives first
// (docs/frontend/textures.md#loading). On a slow link every open download
// shares the bandwidth: on a first visit over fast 4G the sky's 0.6 MB
// preview came about 6 s after the page's first frame, because it came down
// beside the full sky (15 MB) and the faint belt (17 MB).
//
// - 'first' jobs (a map's preview, the sky's preview) start at once.
// - 'bulk' jobs (full-size maps, the full sky, the faint belt, the clouds)
//   wait until nothing else in the queue is open, then go one at a time,
//   the most wanted first (Rank), then by `order` (a body's day map before
//   its relief), then in the order asked.
// A job keeps its place until its bytes are in (done()), not until it is
// decoded, so one decodes while the next downloads. A bulk job already
// downloading is not stopped: a preview asked for meanwhile shares the
// link with that one download, not with all of them. Files fetched
// outside the queue (the app's code, the ephemerides, small tables) go as
// they always did.
//
// What is loading, with the bytes so far where known, is published for
// the console's load lamp (LoadLamp in panels.tsx).

/** @typedef {'first' | 'bulk'} Lane */

/**
 * Bulk order: the focused body's maps, the sky, maps of bodies seen, then
 * what only adds detail (the faint belt, the day's clouds).
 */
export const Rank = /** @type {const} */ ({ focus: 0, sky: 1, seen: 2, extra: 3 });

/**
 * @typedef {object} LoadJob
 * @property {string} label     what is loading, as the lamp says it ("Mars surface")
 * @property {Lane} lane
 * @property {number} rank
 * @property {string} [tag]     the body it is for: its rank follows the focus
 * @property {number} order     within a rank, lower first (0 by default)
 * @property {number} got       bytes so far
 * @property {number} total     bytes in all, 0 if not known
 */

/**
 * @typedef {object} JobHandle
 * @property {(got: number, total?: number) => void} progress
 * @property {() => void} done   its bytes are in: the next job may start
 */

/** @typedef {{ job: LoadJob, start: () => void, released: boolean }} Entry */

/** @type {Entry[]} */ const open = [];
/** @type {Entry[]} */ const waiting = [];
/** @type {Set<() => void>} */ const listeners = new Set();
/** @type {string | null} */ let focusTag = null;
let notifyQueued = false;
let bulkSoon = false;

function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => { notifyQueued = false; for (const f of listeners) f(); });
}

function pump() {
  for (let i = 0; i < waiting.length;) {
    if (waiting[i].job.lane === 'first') begin(waiting.splice(i, 1)[0]);
    else i++;
  }
  // A bulk job only when nothing else is open, and a task later: a job
  // that just gave up its place may be about to ask for its next part
  // (a map's remainder, after its preview), which should be in the running.
  if (open.length || bulkSoon || !waiting.length) return;
  bulkSoon = true;
  setTimeout(() => {
    bulkSoon = false;
    if (open.length) return;
    let best = -1;
    const before = (/** @type {LoadJob} */ a, /** @type {LoadJob} */ b) => a.rank < b.rank || (a.rank === b.rank && a.order < b.order);
    for (let i = 0; i < waiting.length; i++) if (best < 0 || before(waiting[i].job, waiting[best].job)) best = i;
    if (best >= 0) begin(waiting.splice(best, 1)[0]);
  }, 0);
}

/** @param {Entry} e */
function begin(e) {
  open.push(e);
  queueMicrotask(e.start);
}

/** @param {Entry} e */
function release(e) {
  if (e.released) return;
  e.released = true;
  const i = open.indexOf(e);
  if (i >= 0) open.splice(i, 1);
  pump();
  notify();
}

/**
 * Run `fn` when its lane allows. The promise is fn's; the job's place is
 * given up when fn calls done() or settles, whichever is first.
 * @template T
 * @param {{ label: string, lane: Lane, rank?: number, tag?: string, order?: number }} opts
 * @param {(h: JobHandle) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function queued(opts, fn) {
  /** @type {LoadJob} */
  const job = { label: opts.label, lane: opts.lane, rank: opts.rank ?? Rank.seen, tag: opts.tag, order: opts.order ?? 0, got: 0, total: 0 };
  if (job.tag && job.tag === focusTag && job.lane === 'bulk') job.rank = Rank.focus;
  return new Promise((resolve, reject) => {
    /** @type {Entry} */
    const e = {
      job, released: false,
      start: () => {
        /** @type {JobHandle} */
        const h = {
          progress: (got, total) => { job.got = got; if (total) job.total = total; notify(); },
          done: () => release(e),
        };
        /** @type {Promise<T>} */
        let p;
        try { p = fn(h); } catch (err) { p = Promise.reject(err); }
        p.then(resolve, reject).finally(() => release(e));
      },
    };
    waiting.push(e);
    pump();
    notify();
  });
}

/**
 * The body now focused (or flown to): its waiting bulk jobs go first, and
 * the last focus's go back among the bodies seen.
 * @param {string | null} tag
 */
export function focusLoads(tag) {
  if (tag === focusTag) return;
  focusTag = tag;
  for (const e of waiting) {
    if (e.job.lane !== 'bulk' || !e.job.tag) continue;
    if (e.job.tag === tag) e.job.rank = Rank.focus;
    else if (e.job.rank === Rank.focus) e.job.rank = Rank.seen;
  }
  notify();
}

/**
 * What is loading now and what waits, for the lamp.
 * @returns {{ open: LoadJob[], waiting: LoadJob[] }}
 */
export function loadState() {
  return { open: open.map((e) => e.job), waiting: waiting.map((e) => e.job) };
}

/** @param {() => void} f @returns {() => void} */
export function onLoadChange(f) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/**
 * A response's body read in full, its bytes counted as they arrive.
 * @param {Response} r @param {JobHandle} h @param {number} [total]
 * @returns {Promise<Uint8Array>}
 */
export async function readCounting(r, h, total = Number(r.headers.get('content-length')) || 0) {
  if (!r.body) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    h.progress(got, total);
  }
  if (parts.length === 1 && parts[0].byteOffset === 0 && parts[0].byteLength === parts[0].buffer.byteLength) return parts[0];
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
