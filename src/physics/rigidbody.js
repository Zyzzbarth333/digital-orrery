// src/physics/rigidbody.js
//
// Rigid-body attitude: a unit quaternion and the body's angular velocity,
// driven by Euler's equations. Pure ES module, no dependencies.
//
// Conventions
//   q = [w, x, y, z], scalar first, rotating body-frame vectors into the
//   inertial frame: v_I = q (x) [0, v_B] (x) q*. So q's matrix (quatToMatrix)
//   has the body axes, written in inertial coordinates, as its columns.
//   omega: the body's angular velocity relative to the inertial frame,
//   in body axes, rad/s.
//   inertia: the 3x3 inertia tensor about the centre of mass, body axes,
//   kg m^2 (products of inertia with the sign of the tensor: I_xy = -sum m x y).
//
// Equations
//   q'     = 1/2 q (x) [0, omega]
//   I w'   = tau - omega x (I omega)          (tau: torque, body axes, N m)

export function quatMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export const quatConj = (q) => [q[0], -q[1], -q[2], -q[3]];

export function quatNormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) * (q[0] < 0 ? -1 : 1);   // scalar kept positive
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

// Body to inertial rotation matrix (rows of the result times a body vector
// give the inertial vector).
export function quatToMatrix(q) {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

// The quaternion of a body-to-inertial rotation matrix (Shepperd's method,
// stable for any rotation).
export function matrixToQuat(m) {
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (tr > Math.max(m[0][0], m[1][1], m[2][2])) {
    const s = 2 * Math.sqrt(1 + tr);
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] >= m[1][1] && m[0][0] >= m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] >= m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]);
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]);
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4];
  }
  return quatNormalize(q);
}

export const matVec = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
export const matTVec = (m, v) => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];
export const matMul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
export const transpose = (m) => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);

// The inverse of a symmetric 3x3 matrix (the inertia tensor).
export function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, k]] = m;
  const A = e * k - f * h, B = -(d * k - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * k - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * k - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

// The rates of the attitude state: q' and omega'. torque in body axes, N m.
export function attitudeRates(q, omega, inertia, inertiaInv, torque) {
  const Iw = matVec(inertia, omega);
  const gyro = [omega[1] * Iw[2] - omega[2] * Iw[1], omega[2] * Iw[0] - omega[0] * Iw[2], omega[0] * Iw[1] - omega[1] * Iw[0]];
  const wDot = matVec(inertiaInv, [torque[0] - gyro[0], torque[1] - gyro[1], torque[2] - gyro[2]]);
  const qDot = quatMul(q, [0, omega[0], omega[1], omega[2]]).map((c) => c / 2);
  return { qDot, wDot };
}

// Rotational kinetic energy and angular momentum (inertial axes): the
// invariants of torque-free motion, for checks.
export function rotationalInvariants(q, omega, inertia) {
  const Iw = matVec(inertia, omega);
  return { energy: (omega[0] * Iw[0] + omega[1] * Iw[1] + omega[2] * Iw[2]) / 2, momentum: matVec(quatToMatrix(q), Iw) };
}
