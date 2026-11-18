// src/app/remember.js
//
// What the app keeps across a refresh (docs/frontend/camera.md#across-a-refresh):
// - the view, in sessionStorage, so a refresh in the same tab comes back to
//   it and a new tab starts at home: what the camera is on, where it is
//   (azimuth, elevation, distance, pan) and the clock (time, rate, running);
// - the rail's layer switches, in localStorage, so they hold for this
//   browser until changed.
// Storage can be off or full (a private window, a blocked site): every read
// and write is in try/catch, and a value that does not read back as what was
// written is dropped field by field rather than trusted. Pure but for the
// storage it is handed: no DOM.

export const VIEW_KEY = 'orrery.view.v1';
export const LAYERS_KEY = 'orrery.layers.v1';

/** The rail's switches as a first visit has them. */
export const DEFAULT_LAYERS = Object.freeze({
  small: { belt: true, neo: true, trojans: true, outer: true, comets: true, colours: false },
  irregular: false,
  sites: false,
  sats: { active: false, debris: false, 'rocket-bodies': false, analyst: false },
  probes: false,
  guides: { axes: false, field: false, spheres: false, lagrange: false, pulls: false, flow: false, magnetic: false, aurora: false, belts: false },
  flow: { frame: 'falling', plane: 'orbit' },
  frame: 'sun',
});
const FLOW_FRAMES = ['inertial', 'falling', 'others', 'rotating'];
const FLOW_PLANES = ['orbit', 'view'];

/** storage.getItem(key), or null when storage is off. */
export function readStore(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
/** storage.setItem(key, value), or nothing when storage is off or full. */
export function writeStore(storage, key, value) {
  try { storage?.setItem(key, value); } catch { /* not remembered */ }
}
/** storage.removeItem(key), quietly. */
export function clearStore(storage, key) {
  try { storage?.removeItem(key); } catch { /* nothing kept */ }
}

const parse = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// A record of booleans with the defaults' keys, each from the saved one when it is a boolean.
const bools = (def, saved) => Object.fromEntries(Object.entries(def).map(([k, v]) => [k, isObj(saved) && typeof saved[k] === 'boolean' ? saved[k] : v]));

/**
 * The rail's switches from saved text: the defaults, with each saved value
 * that is of the right kind in its place.
 */
export function parseLayers(text) {
  const saved = parse(text), s = isObj(saved) ? saved : {};
  const d = DEFAULT_LAYERS;
  return {
    small: bools(d.small, s.small),
    irregular: typeof s.irregular === 'boolean' ? s.irregular : d.irregular,
    sites: typeof s.sites === 'boolean' ? s.sites : d.sites,
    sats: bools(d.sats, s.sats),
    probes: typeof s.probes === 'boolean' ? s.probes : d.probes,
    guides: bools(d.guides, s.guides),
    flow: {
      frame: FLOW_FRAMES.includes(s.flow?.frame) ? s.flow.frame : d.flow.frame,
      plane: FLOW_PLANES.includes(s.flow?.plane) ? s.flow.plane : d.flow.plane,
    },
    frame: s.frame === 'ssb' ? 'ssb' : 'sun',
  };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A saved view from its text, or null if it is missing or malformed:
 * { focus, on, cam: { az, el, dist, pan }, clock: { timeMs, rate, playing }, savedAt }.
 * `focus` is the body (a key the caller checks); `on` is what the camera is
 * on when that is not the body itself ('irr:<key>', 'site:<key>', or a small
 * body's designation), or null.
 */
export function parseView(text) {
  const s = parse(text);
  if (!isObj(s) || typeof s.focus !== 'string') return null;
  const c = s.cam, k = s.clock;
  const cam = isObj(c) && finite(c.az) && finite(c.el) && finite(c.dist) && c.dist > 0
    && Array.isArray(c.pan) && c.pan.length === 3 && c.pan.every(finite)
    ? { az: c.az, el: c.el, dist: c.dist, pan: [c.pan[0], c.pan[1], c.pan[2]] } : null;
  const clock = isObj(k) && finite(k.timeMs) && finite(k.rate) && k.rate > 0 && typeof k.playing === 'boolean'
    ? { timeMs: k.timeMs, rate: k.rate, playing: k.playing } : null;
  return {
    focus: s.focus,
    on: typeof s.on === 'string' && s.on ? s.on : null,
    cam,
    clock,
    savedAt: finite(s.savedAt) ? s.savedAt : null,
  };
}

/**
 * Where the clock comes back to after a refresh. Held, it is where it was.
 * Running, it goes on by the real time the refresh took, capped at a second
 * as the clock caps a background tab's pause (clock.ts), so a refresh at a
 * year a second does not leap a decade. A clock that was live (within a
 * minute of now, at real time) comes back live.
 */
export function resumeTime(clock, savedAt, nowMs) {
  if (!clock.playing) return clock.timeMs;
  if (clock.rate === 1 && savedAt !== null && Math.abs(clock.timeMs - savedAt) < 60e3) return nowMs;
  const away = savedAt === null ? 0 : Math.max(0, Math.min(1, (nowMs - savedAt) / 1000));
  return clock.timeMs + away * clock.rate * 1000;
}
