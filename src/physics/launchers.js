// src/physics/launchers.js
//
// Real launch vehicles for the ROCKET tab's presets, from their makers'
// and NASA's published figures, each beside a real flight to check the
// ascent against (docs/physics/rocket.md#real-launchers). Units as the
// panel takes them: masses in tonnes, thrust in kN (vacuum), Isp in s.
//
// Each stage lists in `est` the figures its maker does not publish; those
// come from secondary sources or are worked out, and say so. A stage's dry
// mass carries whatever falls away with it (interstages, a jettisoned
// escape tower), as the model drops mass only at staging. An upper stage
// that never fires low gets its vacuum Isp at sea level too.
//
// The flown events are the real vehicle's: time after liftoff (s), height
// (km) and speed (km/s), inertial ("space-fixed") or relative to the
// Earth's surface as `frame` says.

const LB = 0.45359237e-3;              // t per lb
const LBF = 4.4482216152605e-3;        // kN per lbf
const FT = 0.3048e-3;                  // km per ft
const NMI = 1.852;                     // km per nautical mile

// Saturn V as flown on Apollo 11 (AS-506), from the actual weights at S-IC
// ignition in Orloff, Apollo by the Numbers (NASA SP-2000-4029), p. 284,
// whose rows sum to its 6,477,875 lb total here. The S-IC carries the S-IC/
// S-II interstage and the launch escape tower (both dropped about 30 s
// after it in fact); the S-II carries the S-II/S-IVB interstage; the S-IVB
// the instrument unit. The payload is the spacecraft less its escape tower
// (CSM, LM and adapter). Engines: five F-1s (1,522,000 lbf each at sea
// level, Isp 263 s there and 304 s in vacuum) and J-2s (230,000 lbf, 421 s
// in vacuum): the figures NASA's Saturn V news reference gives for the
// uprated engines from AS-504 on, quoted here from secondary copies.
const F1_SL = 1522000 * LBF, F1_ISP_SL = 263, F1_ISP = 304, J2 = 230000 * LBF, J2_ISP = 421;
const saturnV = {
  key: 'saturn-v',
  label: 'Saturn V (Apollo 11)',
  source: { text: 'NASA SP-2000-4029, Apollo by the Numbers: weights p. 284, Apollo 11 ascent p. 103', url: 'https://history.nasa.gov/SP-4029/Apollo_18-18_Ascent_Data.htm' },
  payload: Math.round((63507 + 33278 + 3951) * LB * 100) / 100,
  diameter: 10.1, cd: 0.5,
  stages: [
    { name: 'S-IC', dry: (287531 + 5442 + 11477 + 8910) * LB, prop: (1424889 + 3305786) * LB, isp: F1_ISP, ispSl: F1_ISP_SL, thrust: 5 * F1_SL * F1_ISP / F1_ISP_SL },
    { name: 'S-II', dry: (79714 + 1260 + 8076) * LB, prop: (819050 + 158116) * LB, isp: J2_ISP, ispSl: J2_ISP, thrust: 5 * J2 },
    { name: 'S-IVB', dry: (24852 + 1656 + 4275) * LB, prop: (43608 + 192497) * LB, isp: J2_ISP, ispSl: J2_ISP, thrust: J2 },
  ],
  est: { cd: true },
  job: { pad: 'ksc', inc: 32.5, alt: 185 },
  // Apollo 11's ascent, Apollo by the Numbers p. 103 (space-fixed).
  flown: {
    flight: 'Apollo 11, 16 July 1969', frame: 'inertial',
    source: 'Apollo 11 as flown: NASA SP-2000-4029, Apollo by the Numbers, p. 103 (space-fixed speed)',
    events: [
      { name: 'S-IC cutoff', t: 161.63, h: 35.701 * NMI, v: 9068.6 * FT },
      { name: 'S-II cutoff', t: 548.22, h: 101.142 * NMI, v: 22690.8 * FT },
      { name: 'S-IVB cutoff', t: 699.33, h: 103.202 * NMI, v: 25561.6 * FT },
    ],
    orbit: { apo: 100.4 * NMI, peri: 98.9 * NMI, inc: 32.521 },
  },
};

// Falcon 9 Block 5, from SpaceX's Falcon user's guide (2025-05-09), §2:
// 3.66 m across; first stage 7,686 kN at sea level from nine Merlin 1Ds;
// second stage 981 kN in vacuum from one Merlin Vacuum. SpaceX publishes
// neither masses nor Isp: the dry masses (22.2 t, 4.0 t), the propellant
// (the tanks' LOX and RP-1: 410.9 t, 107.5 t) and the Isps (Merlin 1D 282 s
// at sea level and 311 s in vacuum, Merlin Vacuum 348 s) are the commonly
// cited figures (Wikipedia, Falcon 9 Block 5). The first stage's vacuum
// thrust follows from its sea-level thrust and the Isps.
// 22.8 t to low orbit expended is SpaceX's figure, as cited there.
// The expendable rocket burns all of it. A recovered booster keeps
// propellant back to come home, which SpaceX does not publish either: the
// landing preset burns 355 t on the way up, the amount at which the
// model's first stage cuts off at Crew Dragon Demo-1's measured 1.881 km/s
// (2 March 2019; webcast telemetry, github.com/shahar603/Telemetry-Data,
// public domain, speed relative to the Earth's surface), and carries the
// other 55.9 t as dead weight. Demo-1 also throttled down through max q,
// which the model does not, so its cutoff comes some seconds earlier here.
const F9_STAGES = [
  { name: 'First stage', dry: 22.2, prop: 410.9, isp: 311, ispSl: 282, thrust: 7686 * 311 / 282, est: ['dry', 'prop', 'isp', 'ispSl'] },
  { name: 'Second stage', dry: 4.0, prop: 107.5, isp: 348, ispSl: 348, thrust: 981, est: ['dry', 'prop', 'isp'] },
];
export const F9_ASCENT_PROP = 355;     // t, fitted to Demo-1's first-stage cutoff
const F9_SOURCE = { text: 'SpaceX, Falcon User\'s Guide (2025), §2; masses and Isp as commonly cited', url: 'https://www.spacex.com/assets/media/falcon-users-guide-2025-05-09.pdf' };
const falcon9 = {
  key: 'falcon-9-landing',
  label: 'Falcon 9 Block 5 (booster landing)',
  source: F9_SOURCE,
  payload: 12.05,
  diameter: 3.66, cd: 0.3,
  stages: [
    { ...F9_STAGES[0], dry: 22.2 + 410.9 - F9_ASCENT_PROP, prop: F9_ASCENT_PROP },
    F9_STAGES[1],
  ],
  est: { cd: true, payload: true },
  job: { pad: 'ksc', inc: 51.6, alt: 200 },
  flown: {
    flight: 'Crew Dragon Demo-1, 2 March 2019', frame: 'surface',
    source: 'Crew Dragon Demo-1 webcast telemetry (github.com/shahar603/Telemetry-Data, public domain): speed relative to the Earth\'s surface',
    events: [
      { name: 'First stage cutoff', t: 158, h: 85.3, v: 1.881 },
      { name: 'T+5 min', t: 300, h: 210, v: 2.492 },
      { name: 'Second stage cutoff', t: 548.9, h: 198, v: 7.548 },
    ],
  },
};
const falcon9x = {
  key: 'falcon-9',
  label: 'Falcon 9 Block 5 (expendable)',
  source: F9_SOURCE,
  payload: 22.8,
  diameter: 3.66, cd: 0.3,
  stages: F9_STAGES,
  est: { cd: true },
  job: { pad: 'ksc', inc: 28.5, alt: 200 },
};

// Electron, from Rocket Lab's Payload User's Guide v7.0, pp. 12-13: 13,000
// kg at liftoff, 1.2 m across; nine Rutherfords of 5,600 lbf each at sea
// level, Isp 311 s; one Rutherford Vacuum of 5,800 lbf, Isp 343 s, with
// about 2,000 kg of propellant; 200 kg to a 500 km sun-synchronous orbit.
// Not published: the dry masses (0.95 t and 0.25 t here, estimates), the
// first stage's propellant (what is left of the 13 t), the first stage's
// vacuum Isp (311 s is taken as it; 290 s at sea level is an estimate),
// and the kick stage, carried here as part of a 0.3 t payload. No open
// telemetry of a flight was found.
const electron = {
  key: 'electron',
  label: 'Electron',
  source: { text: 'Rocket Lab, Electron Payload User\'s Guide v7.0, pp. 12-13', url: 'https://rocketlabusa.com/assets/Electron-Payload-User-Guide-7.0-v6.pdf' },
  payload: 0.3,
  diameter: 1.2, cd: 0.3,
  stages: [
    { name: 'First stage', dry: 0.95, prop: 13 - 0.95 - 0.25 - 2.0 - 0.3, isp: 311, ispSl: 290, thrust: 9 * 5600 * LBF * 311 / 290, est: ['dry', 'prop', 'ispSl', 'thrust'] },
    { name: 'Second stage', dry: 0.25, prop: 2.0, isp: 343, ispSl: 343, thrust: 5800 * LBF, est: ['dry'] },
  ],
  est: { cd: true, payload: true },
  job: { pad: 'mahia', inc: 97.4, alt: 500 },
};

export const LAUNCHERS = [saturnV, falcon9, falcon9x, electron];
