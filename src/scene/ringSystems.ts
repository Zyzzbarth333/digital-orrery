// src/scene/ringSystems.ts
//
// Jupiter's, Uranus's and Neptune's rings (docs/frontend/rings.md): built
// from rings.js's tables and the Voyager PPS profiles, drawn by rings.ts,
// and placed every frame: each narrow ring's ellipse turns with its
// precessing periapse and node, and the Adams arcs move along their ring.

import * as THREE from 'three';
import {
  URANUS_NARROW, URANUS_BROAD, URANUS_DUST, NEPTUNE_NARROW, NEPTUNE_BROAD, ADAMS_ARC_DUST, ADAMS_WIGGLE,
  PARTICLE_ALBEDO, edgeAt, ringPlaneAt, ringAxes, fraterniteLongitude, galateaLongitude, arcsAt, URANUS_EPOCH_JD,
} from '../physics/rings.js';
import { MOON_DATA } from '../physics/moons.data.js';
import { makeFlatRings, makeDustRings, setMainShape, tauTexture, MAX_NARROW } from './rings';

type Vec3 = [number, number, number];
const D = Math.PI / 180;
const TAU = 2 * Math.PI;
const wrap = (x: number) => ((x % TAU) + TAU) % TAU;

export interface PpsFile { rings: Record<string, { equivalentDepthKm: number; shape: number[] | null }> }
export interface LorriFile { shells: { innerKm: number; outerKm: number; depth: number[] } }

export interface RingFrame {
  planetPos: THREE.Vector3;            // render units, camera-relative
  poleEqj: Vec3;                       // the planet's IAU north pole, J2000 equatorial
  toRender: (v: Vec3) => THREE.Vector3; // J2000 equatorial direction -> render frame
  sunPos: THREE.Vector3;
  sunRadius: number;
  irradiance: number;
  caster: { A: THREE.Matrix3; k: number };
  jd: number;                          // TDB
  pxAngle: number;                     // a pixel's angular size, rad
}

// A narrow ring as the flat shader takes it.
interface Narrow {
  ier: { a: number; e: number; varpi: number };
  oer: { a: number; e: number; varpi: number };
  i: number; node: number;             // deg
  modes: [number, number, number][];   // m, A km, phase (deg) at jd: r -= A cos(m lambda - phase)
  E: number;                           // equivalent depth, km
  dust: number;
  row: number;                         // profile row, -1 none
  arc: number;                         // arc offset (deg), -1 none
}

function setShadow(u: Record<string, THREE.IUniform>, f: RingFrame): void {
  u.irradiance.value = f.irradiance;
  (u.sunPos.value as THREE.Vector3).copy(f.sunPos);
  u.sunRadius.value = f.sunRadius;
  (u.planetPos.value as THREE.Vector3).copy(f.planetPos);
  (u.planetAxes.value as THREE.Matrix3).copy(f.caster.A);
  u.planetK.value = f.caster.k;
}

// A smooth top-hat profile from [name, centre, width, tau] rows, all dust.
function broadProfile(rows: (string | number)[][], innerKm: number, outerKm: number, stepKm: number) {
  const n = Math.ceil((outerKm - innerKm) / stepKm) + 1;
  const tau = new Array<number>(n).fill(0), dust = new Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) {
    const r = innerKm + i * stepKm;
    for (const [, c, w, t] of rows as [string, number, number, number][]) {
      const soft = Math.max(0.1 * w, stepKm);
      const x = Math.abs(r - c) - w / 2;
      tau[i] += t * (x <= -soft / 2 ? 1 : x >= soft / 2 ? 0 : 0.5 - x / soft);
    }
  }
  return { innerKm, stepKm, tau, dust };
}

function profileTexture(rows: number[][]): THREE.DataTexture {
  const h = Math.max(rows.length, 1);
  const data = new Uint16Array(32 * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < 32; x++) data[y * 32 + x] = THREE.DataUtils.toHalfFloat(rows[y]?.[x] ?? 1);
  const t = new THREE.DataTexture(data, 32, h, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// The Adams arcs over 360 deg of longitude from Fraternite's centre, as
// they were at a date (rings.js, arcsAt): r the optical depth as a multiple
// of the ring's own, g the dust fraction. Refilled as the date moves.
const ARC_TEXELS = 2048;
function arcTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(2 * ARC_TEXELS), ARC_TEXELS, 1, THREE.RGFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
function fillArcs(t: THREE.DataTexture, jd: number, baseTau: number, baseDust: number): void {
  const data = t.image.data as Uint16Array, ramp = 0.3, arcs = arcsAt(jd);
  for (let i = 0; i < ARC_TEXELS; i++) {
    const lon = ((i + 0.5) / ARC_TEXELS) * 360;
    let tau = baseTau, dust = baseDust;
    for (const a of arcs) {
      const d = Math.abs(((lon - a.offset + 540) % 360) - 180) - a.length / 2;
      const w = Math.min(1, Math.max(0, 0.5 - d / ramp));
      if (w > 0 && a.tau > baseTau) {
        tau = Math.max(tau, baseTau + w * (a.tau - baseTau));
        dust = baseDust + w * (ADAMS_ARC_DUST - baseDust);
      }
    }
    data[2 * i] = THREE.DataUtils.toHalfFloat(tau / baseTau);
    data[2 * i + 1] = THREE.DataUtils.toHalfFloat(dust);
  }
  t.needsUpdate = true;
}

class FlatSystem {
  readonly mesh: THREE.Mesh;
  private axes: { X: THREE.Vector3; Y: THREE.Vector3; n: THREE.Vector3 }[] = [];
  constructor(mesh: THREE.Mesh, private readonly narrow: (jd: number) => Narrow[], private readonly retrograde: boolean,
              private readonly unitKm: number, private readonly onDate: (jd: number) => void = () => {}) {
    this.mesh = mesh;
  }

  update(f: RingFrame): void {
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    // The ring system's angular momentum: Uranus spins (and its rings run)
    // retrograde, about the IAU south pole.
    const pole: Vec3 = this.retrograde ? [-f.poleEqj[0], -f.poleEqj[1], -f.poleEqj[2]] : f.poleEqj;
    const poleR = f.toRender(pole).normalize();
    this.mesh.position.copy(f.planetPos);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), poleR);
    (u.normal.value as THREE.Vector3).copy(poleR);
    setShadow(u, f);
    const U = this.unitKm;
    this.onDate(f.jd);
    const rings = this.narrow(f.jd);
    // The band the narrow rings lie in, with room for their tilt (ring 6 is
    // 45 km off the equator at most) and modes.
    let lo = Infinity, hi = 0;
    for (const r of rings) {
      const A = r.modes.reduce((s, m) => s + Math.abs(m[1]), 0);
      lo = Math.min(lo, r.ier.a * (1 - r.ier.e) - A - 60);
      hi = Math.max(hi, r.oer.a * (1 + r.oer.e) + A + 60);
    }
    (u.narrowBand.value as THREE.Vector2).set(lo / U, hi / U);
    const modes = u.modes.value as THREE.Vector4[];
    let next = 0;
    rings.forEach((r, k) => {
      const ax = ringAxes(pole, r.i, r.node);
      (u.ringX.value as THREE.Vector3[])[k].copy(f.toRender(ax.X as Vec3).normalize());
      (u.ringY.value as THREE.Vector3[])[k].copy(f.toRender(ax.Y as Vec3).normalize());
      (u.ringN.value as THREE.Vector3[])[k].copy(f.toRender(ax.n as Vec3).normalize());
      const node = r.node * D;
      (u.g0.value as THREE.Vector4[])[k].set(r.ier.a / U, r.ier.e, wrap(r.ier.varpi * D - node), next);
      (u.g1.value as THREE.Vector4[])[k].set(r.oer.a / U, r.oer.e, wrap(r.oer.varpi * D - node), r.modes.length);
      let sum = 0;
      for (const [m, A, phase] of r.modes) {
        // In the shader psi is measured from the ring's node: m lambda - phase = m psi - (phase - m node).
        modes[next++].set(m, A / U, wrap(phase * D - m * node), 0);
        sum += Math.abs(A);
      }
      (u.g2.value as THREE.Vector4[])[k].set(sum / U, 0, 0, 0);
      (u.g3.value as THREE.Vector4[])[k].set(r.E / U, r.dust, r.row, r.arc < 0 ? -1 : wrap(r.arc * D - node));
    });
  }
}

const circular = (a: number, width: number, E: number, dust: number, row = -1, arc = -1): Narrow => ({
  ier: { a: a - width / 2, e: 0, varpi: 0 }, oer: { a: a + width / 2, e: 0, varpi: 0 }, i: 0, node: 0, modes: [], E, dust, row, arc,
});

export function makeUranusRings(pps: PpsFile, unitKm: number): FlatSystem {
  const shaped = URANUS_NARROW.filter((r) => pps.rings[r.name]?.shape);
  const rowOf = new Map(shaped.map((r, i) => [r.name, i]));
  // The narrow dust bands beside the eta, delta and lambda rings.
  const bands = URANUS_BROAD.filter((b) => (b[2] as number) < 100) as [string, number, number, number][];
  const wide = URANUS_BROAD.filter((b) => (b[2] as number) >= 100);
  const count = URANUS_NARROW.length + bands.length;
  const modeCount = URANUS_NARROW.reduce((n, r) => n + (r.modes?.length ?? 0), 0);
  if (count > MAX_NARROW) throw new Error('too many narrow rings');
  const prof = broadProfile(wide, 26000, 107000, 20);
  const mesh = makeFlatRings({
    tau: tauTexture(prof), profileInnerKm: prof.innerKm, profileOuterKm: prof.innerKm + prof.stepKm * (prof.tau.length - 1),
    meshInnerKm: 26000, meshOuterKm: 107000, narrow: count, modes: modeCount,
    profileMap: profileTexture(shaped.map((r) => pps.rings[r.name].shape!)), profileRows: Math.max(shaped.length, 1),
    tint: new THREE.Color(1, 1, 1), A: PARTICLE_ALBEDO.uranus, lambert: true,
  }, unitKm);
  const narrow = (jd: number): Narrow[] => [
    ...URANUS_NARROW.map((r): Narrow => {
      const plane = r.cor[4] ? ringPlaneAt(r, jd) : { i: 0, node: 0 };
      const t = jd - URANUS_EPOCH_JD;
      // r -= A cos(m (lambda - delta - Omega_p t)); for m = 0, A cos(Omega_p t + delta).
      const modes = (r.modes ?? []).map(([m, A, delta, Op]): [number, number, number] =>
        [m, A, m === 0 ? -(Op * t + delta) : m * (delta + Op * t)]);
      return {
        ier: edgeAt(r.ier, jd), oer: edgeAt(r.oer, jd), i: plane.i, node: plane.node, modes,
        E: pps.rings[r.name]?.equivalentDepthKm ?? 0, dust: (URANUS_DUST as Record<string, number>)[r.name] ?? 0,
        row: rowOf.get(r.name) ?? -1, arc: -1,
      };
    }),
    ...bands.map(([, c, w, t]) => circular(c, w, t * w, 1)),
  ];
  return new FlatSystem(mesh, narrow, true, unitKm);
}

export function makeNeptuneRings(unitKm: number): FlatSystem {
  const prof = broadProfile(NEPTUNE_BROAD, 40000, 64500, 20);
  const adams = NEPTUNE_NARROW.find((r) => r.name === 'Adams')!;
  const arcs = arcTexture();
  let filled = NaN;
  const onDate = (jd: number) => {
    if (Math.abs(jd - filled) < 1) return;   // the arcs change over years: refill a day at a time
    fillArcs(arcs, jd, adams.tau, adams.dust);
    filled = jd;
  };
  const mesh = makeFlatRings({
    tau: tauTexture(prof), profileInnerKm: prof.innerKm, profileOuterKm: prof.innerKm + prof.stepKm * (prof.tau.length - 1),
    meshInnerKm: 40000, meshOuterKm: 64500, narrow: NEPTUNE_NARROW.length, modes: 1,
    arcMap: arcs,
    tint: new THREE.Color(1, 1, 1), A: PARTICLE_ALBEDO.neptune, lambert: true,
  }, unitKm);
  const narrow = (jd: number): Narrow[] => NEPTUNE_NARROW.map((r) => {
    if (r.name !== 'Adams') return circular(r.a, r.width, r.tau * r.width, r.dust);
    const ring = circular(r.a, r.width, r.tau * r.width, r.dust, -1, fraterniteLongitude(jd));
    // Galatea's 42 lobes, furthest out at its longitude: r += A cos(42 (lambda - lambda_G)).
    ring.modes = [[ADAMS_WIGGLE.m, -ADAMS_WIGGLE.amplitudeKm, ADAMS_WIGGLE.m * galateaLongitude(jd)]];
    return ring;
  });
  return new FlatSystem(mesh, narrow, false, unitKm, onDate);
}

export class JupiterRings {
  readonly mesh: THREE.Mesh;
  private readonly H: number;
  private readonly R: number;
  constructor(private readonly unitKm: number) {
    this.mesh = makeDustRings(unitKm, Math.sin(MOON_DATA.amalthea.i * D), Math.sin(MOON_DATA.thebe.i * D), PARTICLE_ALBEDO.jupiter);
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    this.H = u.slabH.value as number;
    this.R = u.outerR.value as number;
  }

  // The main ring's radial shape as New Horizons measured it (rings_lorri.json).
  setMeasuredShape(file: LorriFile): void {
    setMainShape(this.mesh, file.shells.depth);
  }

  update(f: RingFrame): void {
    const mat = this.mesh.material as THREE.ShaderMaterial;
    const u = mat.uniforms;
    const Z = f.toRender(f.poleEqj).normalize();
    const X = new THREE.Vector3(1, 0, 0);
    if (Math.abs(X.dot(Z)) > 0.9) X.set(0, 1, 0);
    X.sub(Z.clone().multiplyScalar(X.dot(Z))).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X);
    (u.toRing.value as THREE.Matrix3).set(X.x, X.y, X.z, Y.x, Y.y, Y.z, Z.x, Z.y, Z.z);
    this.mesh.position.copy(f.planetPos);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), Z);
    setShadow(u, f);
    u.pxAngle.value = f.pxAngle;
    // From inside the cylinder its far faces bound the view: draw those,
    // regardless of depth (the shader stops each ray at the planet).
    const cam = f.planetPos.clone().multiplyScalar(-this.unitKm);   // camera from the planet, km
    const z = cam.dot(Z), rr = Math.sqrt(Math.max(0, cam.lengthSq() - z * z));
    const inside = Math.abs(z) < this.H * 1.01 && rr < this.R * 1.01;
    mat.side = inside ? THREE.BackSide : THREE.FrontSide;
    mat.depthTest = !inside;
  }
}
