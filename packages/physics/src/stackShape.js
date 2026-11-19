// packages/physics/src/stackShape.js
//
// The shapes the scene draws a launcher by (src/scene/craftModels.ts,
// docs/frontend/mission.md#close-up-models): each stage and the payload on
// top as cylinders and cones at their lengths and diameters, bottom first,
// in metres. Pure ES module.
//
// A part is { name, length, diameter, top? (the diameter at its upper end,
// for a cone or a taper), finish, stage? (the launcher stage it belongs to:
// it falls away when that stage separates), engine? (its bells, drawn in
// the bottom of its length: their length, exit diameter, count, and the
// ring the outer ones sit on as a share of the radius), skirt? (the
// interstage's finish, where it is not the stage's own), legs and
// gridFins (a booster's four stowed legs and four grid fins, drawn to
// fit) }. A stage's
// engines sit in the interstage above the stage below it while that is
// attached: the scene closes the gap with a skirt from the lower stage's
// diameter to its own. Each launcher says which sizes its maker or NASA
// publishes; the rest are worked out here and listed in `est`, so the
// plate can say so.
//
// Sources (IEEE numbers as in docs/frontend/mission.md):
// - Saturn V: the S-IC 138 ft by 33 ft, the S-IVB 58.4 ft by 21 ft 8 in,
//   the spacecraft-LM adapter 28 ft tapering from 22 ft to 12 ft 10 in
//   (NASA press kit, 1967 [5]); the S-II 24.8 m by 33 ft (NASA SP-4206
//   [6]); the instrument unit 3.0 ft by 21.7 ft (MSFC-MAN-503 [7]); the
//   whole stack 363 ft by 33 ft (NASM [8]). What the total leaves above
//   the adapter, 16.5 m, holds the service module, the command module and
//   the escape tower; their split is this file's.
// - Falcon 9: 70 m high with both stages, the interstage and the standard
//   fairing, 3.66 m across; the fairing 5.2 m by 13.2 m (SpaceX Falcon
//   User's Guide, 2025 [9]). SpaceX does not give each stage's length:
//   the 56.8 m below the fairing is split between the stages by their
//   propellant volumes (launchers.js masses).
// - Electron: 18 m long and 1.2 m across, the fairing 1.2 m by 2.5 m, the
//   kick stage 405 mm (Rocket Lab Payload User's Guide v7.0, pp. 12 and 17
//   [10]). The stages' lengths are split as Falcon 9's are.
// - A stack the app sizes (staging.js stackAsLauncher) has no published
//   shape: each stage's tanks hold its propellant at its class's density
//   (craftAttitude.js STAGE_DENSITY) in the stack's diameter, plus one
//   diameter for its domes and engine, and the payload sits in a fairing
//   one and a half diameters long.

import { STAGE_DENSITY, HYDROLOX_ISP } from './craftAttitude.js';
import { LAUNCHERS } from './launchers.js';

const FT = 0.3048, IN = 0.0254;

// The share of a stage's length the propellant volume sets (by the same
// density rule as stageAttitude): its tanks' volume in the stack's
// diameter, the rest of the length shared out in the same proportion.
const tankLength = (s, d) => (s.prop * 1000) / ((s.isp >= HYDROLOX_ISP ? STAGE_DENSITY.hydrolox : STAGE_DENSITY.dense) * Math.PI * (d / 2) ** 2);
function splitByVolume(stages, d, total) {
  const L = stages.map((s) => tankLength(s, d)), sum = L.reduce((a, b) => a + b, 0);
  return L.map((x) => (x / sum) * total);
}

// Saturn V as Apollo 11 flew it.
function saturnV() {
  const D = 33 * FT, D3 = (21 + 8 / 12) * FT, SC = (12 + 10 / 12) * FT;
  const total = 363 * FT, sic = 138 * FT, sii = 24.8, sivb = 58.4 * FT, iu = 3.0 * FT, sla = 28 * FT;
  const above = total - sic - sii - sivb - iu - sla;          // 16.5 m: SM, CM and tower
  const sm = 3.9, cm = 3.2, les = above - sm - cm;
  return {
    total, span: total,
    parts: [
      { name: 'S-IC', length: sic, diameter: D, finish: 'white', stage: 0, engine: { length: 5.8, exit: 3.7, count: 5, spread: 0.62 } },
      { name: 'S-II', length: sii, diameter: D, finish: 'white', stage: 1, engine: { length: 3.4, exit: 2.0, count: 5, spread: 0.62 } },
      { name: 'S-IVB', length: sivb, diameter: D3, finish: 'white', stage: 2, engine: { length: 3.4, exit: 2.0, count: 1 } },
      { name: 'Instrument unit', length: iu, diameter: D3, finish: 'white', stage: 2 },
      { name: 'Spacecraft-LM adapter', length: sla, diameter: 22 * FT, top: SC, finish: 'silver' },
      { name: 'Service module', length: sm, diameter: SC, finish: 'silver' },
      { name: 'Command module', length: cm, diameter: SC, top: 0.8, finish: 'white' },
      { name: 'Escape tower', length: les, diameter: 0.9, top: 0.25, finish: 'white' },
    ],
    est: ['the engines\' bells', 'the split of the 16.5 m above the adapter between the service module, the command module and the escape tower'],
  };
}

// Falcon 9 with its standard fairing: the two stages share the 56.8 m
// below it by propellant volume.
function falcon9(stages) {
  const d = 3.66, total = 70, fairing = 13.2, fd = 5.2;
  const [l1, l2] = splitByVolume(stages, d, total - fairing);
  return {
    total, span: total,
    parts: [
      { name: stages[0].name, length: l1, diameter: d, finish: 'white', stage: 0, engine: { length: 1.2, exit: 0.9, count: 9, spread: 0.68 }, legs: true, gridFins: true },
      { name: stages[1].name, length: l2, diameter: d, finish: 'white', stage: 1, engine: { length: 3.0, exit: 3.3, count: 1 }, skirt: 'carbon' },
      { name: 'Fairing', length: fairing * 0.45, diameter: fd, finish: 'white' },
      { name: 'Fairing nose', length: fairing * 0.55, diameter: fd, top: 0.6, finish: 'white' },
    ],
    est: ['the stages\' lengths (split by propellant volume)', 'the engines\' bells', 'the stowed legs and the grid fins'],
  };
}

function electron(stages) {
  const d = 1.2, total = 18, fairing = 2.5, kick = 0.405;
  const [l1, l2] = splitByVolume(stages, d, total - fairing - kick);
  return {
    total, span: total,
    parts: [
      { name: stages[0].name, length: l1, diameter: d, finish: 'carbon', stage: 0, engine: { length: 0.45, exit: 0.26, count: 9, spread: 0.7 } },
      { name: stages[1].name, length: l2, diameter: d, finish: 'carbon', stage: 1, engine: { length: 0.9, exit: 0.7, count: 1 } },
      { name: 'Kick stage', length: kick, diameter: d, finish: 'carbon' },
      { name: 'Fairing', length: fairing * 0.4, diameter: d, finish: 'carbon' },
      { name: 'Fairing nose', length: fairing * 0.6, diameter: d, top: 0.2, finish: 'carbon' },
    ],
    est: ['the stages\' lengths (split by propellant volume)', 'the engines\' bells'],
  };
}

// A stack with no published shape: tanks from the propellant, plus a
// diameter each, and a fairing.
function sized(stages, d) {
  const parts = stages.map((s, i) => ({
    name: s.name, length: tankLength(s, d) + d, diameter: d, finish: 'white', stage: i,
    engine: { length: 0.5 * d, exit: 0.6 * d, count: 1 },
  }));
  parts.push({ name: 'Fairing', length: 0.6 * d, diameter: d, finish: 'white' }, { name: 'Fairing nose', length: 0.9 * d, diameter: d, top: 0.15 * d, finish: 'white' });
  const total = parts.reduce((a, p) => a + p.length, 0);
  return { total, span: total, parts, est: ['every length: tanks holding each stage\'s propellant in the stack\'s diameter, a diameter more for domes and engine, a fairing 1.5 diameters long'] };
}

// The shape of a launcher (launchers.js entry, or the ROCKET tab's
// vehicle: { key?, stages, diameter }), and whether it is published. A
// launcher whose figures the user has changed is drawn as sized, from its
// own stages and diameter.
/** @param {{ key?: string, stages: { name: string, prop: number, isp: number }[], diameter: number }} L
 *  @param {{ custom?: boolean }} [opts] */
export function stackShape(L, { custom = false } = {}) {
  const key = custom ? null : L.key;
  if (key === 'saturn-v') return { key, published: true, ...saturnV() };
  // The landing preset burns less on the way up, but fills the same tanks:
  // both are drawn from the expendable one's loads.
  if (key === 'falcon-9' || key === 'falcon-9-landing') return { key, published: true, ...falcon9(LAUNCHERS.find((x) => x.key === 'falcon-9').stages.map((s, i) => ({ ...s, name: L.stages[i]?.name ?? s.name }))) };
  if (key === 'electron') return { key, published: true, ...electron(L.stages) };
  return { key: 'sized', published: false, ...sized(L.stages, L.diameter) };
}

// What is left of a shape once the stages below `from` have separated: its
// parts from there up.
export function partsFrom(shape, from) {
  return shape.parts.filter((p) => p.stage === undefined || p.stage >= from);
}

export const _test = { FT, IN, splitByVolume };
