// src/physics/asteroids.js
//
// The sixteen most massive asteroids: the perturbers JPL's small-body
// integrations use with the DE440/DE441 planets (Horizons, and the SB441-N16
// file, "the most massive perturbers in the main asteroid belt" as its
// comments put it; Farnocchia 2021, JPL IOM 392R-21-005; Park et al. 2021,
// AJ 161, 105, for DE441). They are the ones the spacecraft kernel pulls
// toward (bodies.js), with positions from sbTable.js.
//
// GM (km^3/s^2): the DE441 masses of the SB441-N16 perturber file, as NAIF's
// gm_de440.tpc gives them (BODY2000001_GM etc.; its sources list "SB441-N16
// small-body integration perturber file (DE441 masses)"; python/data/
// kernels/pck/gm_de440.tpc, from Jon Giorgini, SSD/JPL, 2022).
//
// Radius (km): half the diameter in JPL's Small-Body Database (the
// diameter field, as smallbodies.fetch.mjs caches it), for impacts. These
// are mean radii: Vesta's 523 km diameter covers a body 572 x 557 x 446 km
// across.

export const MU_SUN_KM = 1.32712440041253311e11;   // DE442, km^3/s^2 (bodies.js GM.sun)

export const PERTURBERS = [
  { key: 'ceres', number: 1, name: 'Ceres', gm: 6.2628888644409933e1, diameter: 939.4 },
  { key: 'pallas', number: 2, name: 'Pallas', gm: 1.3665878145967422e1, diameter: 513 },
  { key: 'juno', number: 3, name: 'Juno', gm: 1.9205707002025889, diameter: 246.596 },
  { key: 'vesta', number: 4, name: 'Vesta', gm: 1.7288232879171513e1, diameter: 522.77 },
  { key: 'iris', number: 7, name: 'Iris', gm: 1.1398723232184107, diameter: 199.83 },
  { key: 'hygiea', number: 10, name: 'Hygiea', gm: 5.6251476453852289, diameter: 407.12 },
  { key: 'eunomia', number: 15, name: 'Eunomia', gm: 2.0230209871098284, diameter: 231.689 },
  { key: 'psyche', number: 16, name: 'Psyche', gm: 1.5896582441709424, diameter: 222 },
  { key: 'euphrosyne', number: 31, name: 'Euphrosyne', gm: 1.0793714577033560, diameter: 267.080 },
  // 52 Europa: keyed apart from Jupiter's moon.
  { key: 'europa52', number: 52, name: '52 Europa', gm: 2.6830359242821795, diameter: 303.918 },
  { key: 'cybele', number: 65, name: 'Cybele', gm: 9.3810575639151328e-1, diameter: 237.26 },
  { key: 'sylvia', number: 87, name: 'Sylvia', gm: 2.1682320736996910, diameter: 253.051 },
  { key: 'thisbe', number: 88, name: 'Thisbe', gm: 1.1898077088121908, diameter: 232 },
  { key: 'camilla', number: 107, name: 'Camilla', gm: 1.4437384031866001, diameter: 210.370 },
  { key: 'davida', number: 511, name: 'Davida', gm: 3.8944831481705644, diameter: 270.327 },
  { key: 'interamnia', number: 704, name: 'Interamnia', gm: 2.8304096393299849, diameter: 306.313 },
].map((a) => ({ ...a, id: 2000000 + a.number, radius: a.diameter / 2 }));

export const PERTURBER_KEYS = PERTURBERS.map((a) => a.key);
export const perturber = (key) => PERTURBERS.find((a) => a.key === key) ?? null;
