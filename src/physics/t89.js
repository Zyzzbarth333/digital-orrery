// src/physics/t89.js
//
// The Earth's magnetosphere: Tsyganenko's T89 model (version T89c) of the
// field of the currents beyond the Earth (docs/physics/magnetic-fields.md#the-earths-magnetosphere):
// the ring current, the tail current sheet (warped, thickening toward the
// day side), its closure currents, and the Chapman-Ferraro and Birkeland
// currents at the magnetopause, in seven sets of 30 parameters by Kp.
// Added to IGRF it squeezes the day side's field lines and draws the
// night side's out into a tail.
//
//   t89(iopt, tilt, x, y, z) -> [bx, by, bz]   GSM, R_E (6371.2 km), nT
//   iopt for Kp: 1 for 0, 0+; 2 for 1-, 1, 1+; ... 6 for 5-, 5, 5+; 7 for 6- and above
//   kpToIopt(kp) -> iopt
//   gsmFrame(dipoleNorth, sun) -> { X, Y, Z, tilt }   GSM axes in the Earth's frame
//   withT89(model, sun, kp) -> the Earth's model (magnetic.js) with T89 added
//
// N. A. Tsyganenko, "A magnetospheric magnetic field model with a warped
// tail current sheet", Planet. Space Sci. 37, 5-20 (1989), with the 1992
// tilt terms (T89c). Translated from the Python port in geopack
// (https://github.com/tsssss/geopack), which carries this notice:
//
//   MIT License. Copyright (c) 2018 Sheng Tian.
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the
//   "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to
//   permit persons to whom the Software is furnished to do so, subject to
//   the following conditions: The above copyright notice and this
//   permission notice shall be included in all copies or substantial
//   portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT
//   WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
//
// Only the field is kept here, not the fitting derivatives.

// The 7 x 30 parameters, by Kp level, in the order the Fortran lists them.
const PARAM = [
  -116.53, -10719., 42.375, 59.753, -11363., 1.7844, 30.268, -0.35372e-01, -0.66832e-01, 0.16456e-01, -1.3024, 0.16529e-02, 0.20293e-02, 20.289, -0.25203e-01, 224.91, -9234.8, 22.788, 7.8813, 1.8362, -0.27228, 8.8184, 2.8714, 14.468, 32.177, 0.01, 0.0, 7.0459, 4.0, 20.0,
  -55.553, -13198., 60.647, 61.072, -16064., 2.2534, 34.407, -0.38887e-01, -0.94571e-01, 0.27154e-01, -1.3901, 0.13460e-02, 0.13238e-02, 23.005, -0.30565e-01, 55.047, -3875.7, 20.178, 7.9693, 1.4575, 0.89471, 9.4039, 3.5215, 14.474, 36.555, 0.01, 0.0, 7.0787, 4.0, 20.0,
  -101.34, -13480., 111.35, 12.386, -24699., 2.6459, 38.948, -0.34080e-01, -0.12404, 0.29702e-01, -1.4052, 0.12103e-02, 0.16381e-02, 24.49, -0.37705e-01, -298.32, 4400.9, 18.692, 7.9064, 1.3047, 2.4541, 9.7012, 7.1624, 14.288, 33.822, 0.01, 0.0, 6.7442, 4.0, 20.0,
  -181.69, -12320., 173.79, -96.664, -39051., 3.2633, 44.968, -0.46377e-01, -0.16686, 0.048298, -1.5473, 0.10277e-02, 0.31632e-02, 27.341, -0.50655e-01, -514.10, 12482., 16.257, 8.5834, 1.0194, 3.6148, 8.6042, 5.5057, 13.778, 32.373, 0.01, 0.0, 7.3195, 4.0, 20.0,
  -436.54, -9001.0, 323.66, -410.08, -50340., 3.9932, 58.524, -0.38519e-01, -0.26822, 0.74528e-01, -1.4268, -0.10985e-02, 0.96613e-02, 27.557, -0.56522e-01, -867.03, 20652., 14.101, 8.3501, 0.72996, 3.8149, 9.2908, 6.4674, 13.729, 28.353, 0.01, 0.0, 7.4237, 4.0, 20.0,
  -707.77, -4471.9, 432.81, -435.51, -60400., 4.6229, 68.178, -0.88245e-01, -0.21002, 0.11846, -2.6711, 0.22305e-02, 0.10910e-01, 27.547, -0.54080e-01, -424.23, 1100.2, 13.954, 7.5337, 0.89714, 3.7813, 8.2945, 5.174, 14.213, 25.237, 0.01, 0.0, 7.0037, 4.0, 20.0,
  -1190.4, 2749.9, 742.56, -1110.3, -77193., 7.6727, 102.05, -0.96015e-01, -0.74507, 0.11214, -1.3614, 0.15157e-02, 0.22283e-01, 23.164, -0.74146e-01, -2219.1, 48253., 12.714, 7.6777, 0.57138, 2.9633, 9.3909, 9.7263, 11.123, 21.558, 0.01, 0.0, 4.4518, 4.0, 20.0,
];

// Kp in thirds (2- is 5/3): 0 and 0+ give 1, 1- to 1+ give 2, ... 6- and above 7.
export const kpToIopt = (kp) => Math.min(7, Math.max(1, Math.floor(kp + 1 / 3 + 1e-9) + 1));

export function t89(iopt, tilt, x, y, z) {
  const a = PARAM.slice(30 * (iopt - 1), 30 * iopt);
  const a02 = 25, xlw2 = 170, rt = 30, xd = 0, xld2 = 40, sxc = 4, xlwc2 = 50;
  const dyc = a[29], rdyc2 = 1 / (dyc * dyc), dx = a[17];
  const hlwc2m = -0.5 * xlwc2, drdyc2 = -2 * rdyc2, hxlw2m = -0.5 * xlw2;
  const adr = a[18], d0 = a[19], dd = a[20], rc = a[21], g = a[22], at = a[23], p = a[24], delt = a[25], q = a[26], sx = a[27], gam = a[28];
  const ha02 = 0.5 * a02, hxld2m = -0.5 * xld2;
  const w1 = -0.5 / dx, w2 = w1 * 2, w4 = -1 / 3, w3 = w4 / dx, w5 = -0.5, w6 = -3;
  const [ak1, ak2, ak3, ak4, ak5, ak6, ak7, ak8, ak9, ak10, ak11, ak12, ak13, ak14, ak15, ak16, ak17] = a;
  const ak610 = ak6 * w1 + ak10 * w5, ak711 = ak7 * w2 - ak11, ak812 = ak8 * w2 + ak12 * w6, ak913 = ak9 * w3 + ak13 * w4;
  const tlt2 = tilt * tilt, sps = Math.sin(tilt), cps = Math.cos(tilt);
  const x2 = x * x, y2 = y * y, z2 = z * z, tps = sps / cps, htp = tps * 0.5;
  const xsm = x * cps - z * sps, zsm = x * sps + z * cps;

  // The tail current sheet's shape zs and its derivatives.
  const xrc = xsm + rc, sxrc = Math.sqrt(xrc * xrc + 16), y4 = y2 * y2, y410 = y4 + 1e4, sy4 = sps / y410, gsy4 = g * sy4;
  const zs1 = htp * (xrc - sxrc), dzsx = -zs1 / sxrc, zs = zs1 - gsy4 * y4;
  const d2zsgy = (-sy4 / y410) * 4e4 * y2 * y, dzsy = g * d2zsgy;

  // The ring current.
  const xsm2 = xsm * xsm, dsqt = Math.sqrt(xsm2 + a02), fa0 = 0.5 * (1 + xsm / dsqt), ddr = d0 + dd * fa0, dfa0 = ha02 / dsqt ** 3;
  const zr = zsm - zs, tr = Math.sqrt(zr * zr + ddr * ddr), rtr = 1 / tr, ro2 = xsm2 + y2, adrt = adr + tr, adrt2 = adrt * adrt;
  const fk = 1 / (adrt2 + ro2), dsfc = Math.sqrt(fk), fc = fk * fk * dsfc, facxy = 3 * adrt * fc * rtr;
  const xzr = xsm * zr, yzr = y * zr, dbxdp = facxy * xzr, rcY = facxy * yzr;
  const xzyz = xsm * dzsx + y * dzsy, faq = zr * xzyz - ddr * dd * dfa0 * xsm, dbzdp = fc * (2 * adrt2 - ro2) + facxy * faq;
  const rcX = dbxdp * cps + dbzdp * sps, rcZ = dbzdp * cps - dbxdp * sps;

  // The tail current sheet.
  let d = d0 + delt * y2, adsl = 0;
  if (Math.abs(gam) >= 1e-6) {
    const xxd = xsm - xd, rqd = 1 / (xxd * xxd + xld2), rqds = Math.sqrt(rqd), h = 0.5 * (1 + xxd * rqds), hs = -hxld2m * rqd * rqds;
    d += gam * h;
    adsl = -d * (xsm * gam * hs);
  }
  const t = Math.sqrt(zr * zr + d * d), xsmx = xsm - sx, rdsq2 = 1 / (xsmx * xsmx + xlw2), rdsq = Math.sqrt(rdsq2);
  const v = 0.5 * (1 - xsmx * rdsq), dvx = hxlw2m * rdsq * rdsq2;
  const om = Math.sqrt(Math.sqrt(xsm2 + 16) - xsm), oms = (-om / (om * om + xsm)) * 0.5, rdy = 1 / (p + q * om), omsv = oms * v;
  const rdy2 = rdy * rdy, fy = 1 / (1 + y2 * rdy2), w = v * fy, yfy1 = 2 * fy * y2 * rdy2, fypr = yfy1 * rdy, fydy = fypr * fy;
  const dwx = dvx * fy + fydy * q * omsv, ydwy = -v * yfy1 * fy, ddy = 2 * delt * y;
  const att = at + t, s1 = Math.sqrt(att * att + ro2), f5 = 1 / s1, f7 = 1 / (s1 + att), f1 = f5 * f7, f3 = f5 ** 3, f9 = att * f3;
  const fs = zr * xzyz - d * y * ddy + adsl, xdwx = xsm * dwx + ydwy, wt = w / t;
  const brrz1 = wt * f1, brrz2 = wt * f3, dbxc1 = brrz1 * xzr, dbxc2 = brrz2 * xzr;
  const wtfs = wt * fs, dbzc1 = w * f5 + xdwx * f7 + wtfs * f1, dbzc2 = w * f9 + xdwx * f1 + wtfs * f3;
  const t1 = [dbxc1 * cps + dbzc1 * sps, brrz1 * yzr, dbzc1 * cps - dbxc1 * sps];
  const t2 = [dbxc2 * cps + dbzc2 * sps, brrz2 * yzr, dbzc2 * cps - dbxc2 * sps];

  // The closure currents.
  const zpl = z + rt, zmn = z - rt, rogsm2 = x2 + y2, spl = Math.sqrt(zpl * zpl + rogsm2), smn = Math.sqrt(zmn * zmn + rogsm2);
  const xsxc = x - sxc, rqc2 = 1 / (xsxc * xsxc + xlwc2), rqc = Math.sqrt(rqc2), fyc = 1 / (1 + y2 * rdyc2);
  const wc = 0.5 * (1 - xsxc * rqc) * fyc, dwcx = hlwc2m * rqc2 * rqc * fyc, dwcy = drdyc2 * wc * fyc * y;
  const szrp = 1 / (spl + zpl), szrm = 1 / (smn - zmn), xywc = x * dwcx + y * dwcy, wcsp = wc / spl, wcsm = wc / smn;
  const fxyp = wcsp * szrp, fxym = wcsm * szrm, fxpl = x * fxyp, fxmn = -x * fxym, fypl = y * fxyp, fymn = -y * fxym, fzpl = wcsp + xywc * szrp, fzmn = wcsm + xywc * szrm;
  const c2 = [fxpl + fxmn, fypl + fymn, fzpl + fzmn], c3 = [(fxpl - fxmn) * sps, (fypl - fymn) * sps, (fzpl - fzmn) * sps];

  // Chapman-Ferraro and the rest.
  const ex = Math.exp(x / dx), ec = ex * cps, es = ex * sps, ecz = ec * z, esz = es * z, eszy2 = esz * y2, eszz2 = esz * z2, ecz2 = ecz * z, esy = es * y;
  const sx1 = ak6 * ecz + ak7 * es + ak8 * esy * y + ak9 * esz * z;
  const sy1 = ak10 * ecz * y + ak11 * esy + ak12 * esy * y2 + ak13 * esy * z2;
  const sz1 = ak14 * ec + ak15 * ec * y2 + ak610 * ecz2 + ak711 * esz + ak812 * eszy2 + ak913 * eszz2;

  const out = [0, 0, 0], cf = [sx1, sy1, sz1], rcv = [rcX, rcY, rcZ];
  for (let i = 0; i < 3; i++) {
    const tail = ak1 * t1[i] + ak2 * t2[i] + ak3 * c2[i] + ak4 * c3[i] + ak16 * t1[i] * tlt2 + ak17 * t2[i] * tlt2;
    out[i] = tail + ak5 * rcv[i] + cf[i];
  }
  return out;
}

// ---- GSM, and the Earth's field with T89 added ----
//
// Geocentric solar magnetospheric axes in the Earth's own frame: X toward
// the Sun, Z the centred dipole's northern axis made square to X, Y = Z x X.
// The dipole tilt psi is the angle between that axis and Z, positive when
// the north magnetic pole leans toward the Sun: sin psi = north . X.
export function gsmFrame(dipoleNorth, sun) {
  const n = Math.hypot(...sun), X = sun.map((v) => v / n);
  const d = dipoleNorth.map((v) => v / Math.hypot(...dipoleNorth));
  const s = d[0] * X[0] + d[1] * X[1] + d[2] * X[2];
  let Z = [d[0] - s * X[0], d[1] - s * X[1], d[2] - s * X[2]];
  const zn = Math.hypot(...Z); Z = Z.map((v) => v / zn);
  const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  return { X, Y, Z, tilt: Math.asin(s) };
}

// The Earth's model (IGRF, in its own frame, units of R_E) with T89 for a
// Kp, for the Sun in direction sun (the Earth's frame).
export function withT89(model, sun, kp) {
  const m = model.dipole.m, F = gsmFrame([-m[0], -m[1], -m[2]], sun), iopt = kpToIopt(kp), f = model.field;
  const { X, Y, Z, tilt } = F;
  return { ...model, rMax: 40, gsm: F, iopt, source: `${model.source}, with Tsyganenko's T89 magnetosphere for Kp level ${iopt}`,
    field(x, y, z, out) {
      f(x, y, z, out);
      const gx = X[0] * x + X[1] * y + X[2] * z, gy = Y[0] * x + Y[1] * y + Y[2] * z, gz = Z[0] * x + Z[1] * y + Z[2] * z;
      const b = t89(iopt, tilt, gx, gy, gz);
      out[0] += X[0] * b[0] + Y[0] * b[1] + Z[0] * b[2];
      out[1] += X[1] * b[0] + Y[1] * b[1] + Z[1] * b[2];
      out[2] += X[2] * b[0] + Y[2] * b[1] + Z[2] * b[2];
      return out;
    } };
}
