// @ts-check
// vec.js: the 3-vector helpers shared across the physics, scene and app
// code. Vectors are plain arrays (or any array-like of three numbers).
//
// norm is a vector's length; unit is the vector scaled to length one.
// orbital.js keeps a length of its own (a square root of the dot product,
// several times faster than Math.hypot) for the Lambert solver's loops.

/** @typedef {[number, number, number]} V3 */
/** @typedef {ArrayLike<number>} Vec */

/** @param {Vec} a @param {Vec} b */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** @param {Vec} a @param {Vec} b @returns {V3} */
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** @param {Vec} a */
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);

/** @param {Vec} a @returns {V3} */
export const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
