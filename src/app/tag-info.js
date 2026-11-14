// src/app/tag-info.js
//
// What each source tag's value is, the equation that gives it and where
// that comes from: the detail a tag opens (source-tag.tsx). The equations
// are the physics docs' own (docs/physics/*.md), written in the subset
// tex.js reads, and each was checked against the code that computes the
// value (named in the comment above it). A tag with nothing to compute
// (a value read from a table or a file) has no equation.
//
// Each entry:
//   what    the value, in a sentence
//   tex     the equations, one per line (may be empty)
//   where   what the symbols are, when the equation alone doesn't say
//   source  the book, paper or dataset, and the doc that explains it
//
// tex.test.mjs checks every equation parses.

const TWO_BODY = 'Curtis, Orbital Mechanics for Engineering Students, 4th ed., Algorithm 4.2 · docs/physics/two-body.md';
const KERNEL = 'docs/physics/nbody-kernel.md';
const ROCKET_EQ = 'Curtis, 4th ed., §13.3–13.4 · docs/physics/burns-and-launch.md';
const ASCENT = 'Curtis, 4th ed., §13.2 (gravity turn), eq. 13.27 (losses) · docs/physics/rocket.md';
const EPHEMERIS = 'Earth and the Moon: JPL DE442, a Chebyshev fit for 2000–2050; the other planets, and outside those years: astronomy-engine (MIT), within 10⁻⁴ of DE442 · docs/physics/ephemerides-and-gm.md';
const VIS_VIVA = 'a = \\left(\\frac{2}{r} - \\frac{v^2}{\\mu}\\right)^{-1}';

/** @satisfies {Record<string, { what: string, tex: string[], where?: string, source: string }>} */
export const TAG_INFO = {
  // ---------------- the data plate (panels.tsx) ----------------
  frame: {
    what: 'The origin of every position in the app: the centre of the Sun.',
    tex: ['\\mathbf r_\\odot = \\mathbf 0'],
    where: 'positions are heliocentric: J2000 ecliptic axes here, J2000 equatorial in the kernel',
    source: 'docs/physics/frames-and-time.md',
  },
  ephemeris: {
    what: 'Planets and the Moon follow their ephemeris exactly, on rails; only spacecraft are integrated.',
    tex: [],
    source: EPHEMERIS,
  },
  // panels.tsx: norm(st.r), st from helioStateEcl
  'sun-distance': {
    what: 'Distance from the centre of the Sun.',
    tex: ['r = |\\mathbf r| = \\sqrt{x^2 + y^2 + z^2}'],
    where: '𝐫: the body\'s heliocentric position',
    source: EPHEMERIS,
  },
  // panels.tsx: norm(st.v)
  'sun-speed': {
    what: 'Speed relative to the Sun.',
    tex: ['v = |\\mathbf v|'],
    where: '𝐯: the body\'s heliocentric velocity',
    source: EPHEMERIS,
  },
  // panels.tsx: norm(st.r - earth.r)
  'earth-distance': {
    what: 'Distance from the centre of the Earth.',
    tex: ['d = |\\mathbf r - \\mathbf r_\\oplus|'],
    source: EPHEMERIS,
  },
  // panels.tsx: fromEarth / C_KM_S
  'light-time': {
    what: 'How long light, or a radio signal, takes to cross that distance.',
    tex: ['t = \\frac{d}{c}', 'c = 299\\,792.458\\ \\text{km/s}'],
    where: 'd: the distance from the Earth; c is exact, by the SI definition of the metre',
    source: 'BIPM, the SI Brochure, 9th ed. (2019)',
  },
  'mean-radius': {
    what: 'The radius of a sphere of the same volume as the body.',
    tex: [],
    source: 'IAU WGCCRE, as NAIF\'s planetary constants kernel pck00011 gives it',
  },
  // catalogue.ts: gm from bodies.js (DE442)
  gm: {
    what: 'G times the mass. Orbits depend on this product, which tracking measures far better than G or the mass alone.',
    tex: ['\\mu = GM'],
    where: 'for a planet with moons, the whole system\'s, as at its barycentre',
    source: 'JPL DE442 technical comments, converted in gm_de442.tpc · docs/physics/ephemerides-and-gm.md',
  },
  'gm-planet': {
    what: 'G times the mass of the planet alone, without its moons.',
    tex: [],
    source: 'NAIF satellite kernels, fitted with the moons\' orbits · docs/physics/ephemerides-and-gm.md',
  },
  // panels.tsx: ownGm / R^2 * 1000
  'surface-gravity': {
    what: 'The pull at the surface of a sphere that does not spin.',
    tex: ['g = \\frac{GM}{R^2}'],
    where: 'R: the mean radius; the planet\'s own GM, not its system\'s',
    source: 'from the GM and the mean radius above',
  },
  albedo: {
    what: 'How bright the full disc is, against a white disc of the same size.',
    tex: [],
    source: 'NASA NSSDCA planetary fact sheets',
  },
  // The barycentres (barycentres.js) and the SSB frame
  'bary-what': {
    what: 'A centre of mass: the point the bodies it holds all orbit together. The ephemeris gives each planet system as its barycentre; the solar system\'s is where the whole system balances.',
    tex: ['\\mathbf r_\\text{B} = \\frac{\\sum_i \\mu_i\\,\\mathbf r_i}{\\sum_i \\mu_i}'],
    where: '𝐫ᵢ: heliocentric positions, μᵢ: GMs (DE442). Mars to Pluto: astronomy-engine\'s planet positions, which are these barycentres; Earth and the Moon: DE442; the SSB: the Sun, every planet system, Earth, the Moon and Pluto, within 150 km of JPL Horizons',
    source: 'DE442 GMs; astronomy-engine; JPL Horizons for the checks · docs/frontend/barycentres.md',
  },
  'bary-gm': {
    what: 'G times the mass of everything this barycentre is the centre of.',
    tex: ['\\mu = \\sum_i \\mu_i'],
    source: 'JPL DE442 GMs (gm_de442.tpc) · docs/physics/ephemerides-and-gm.md',
  },
  'bary-offset': {
    what: 'How far the body\'s centre is from the barycentre: its moons pull it round this point.',
    tex: ['\\mathbf r_\\text{planet} - \\mathbf r_\\text{B} = -\\sum_i \\frac{\\mu_i}{\\mu_\\text{system}}\\,\\mathbf r_i'],
    where: '𝐫ᵢ: each moon about the planet\'s centre; for Earth, the Moon from DE442',
    source: 'moons.js and DE442 · docs/frontend/moons.md',
  },
  'ssb-offset': {
    what: 'How far the Sun\'s centre is from the solar system barycentre. The Sun wanders round it, mostly with Jupiter and Saturn, often by more than its own radius.',
    tex: ['\\mathbf r_\\text{SSB} = \\frac{\\sum_i \\mu_i\\,\\mathbf r_i}{\\mu_\\odot + \\sum_i \\mu_i}'],
    where: '𝐫ᵢ: heliocentric positions of every planet system, Earth, the Moon and Pluto; within 150 km of JPL Horizons over 2000–2050',
    source: 'DE442 GMs; astronomy-engine and DE442 positions · docs/frontend/barycentres.md',
  },
  'ssb-distance': {
    what: 'Distance from the solar system barycentre, the centre of mass of the Sun and everything that orbits it.',
    tex: ['d = |\\mathbf r - \\mathbf r_\\text{SSB}|'],
    source: 'barycentres.js · docs/frontend/barycentres.md',
  },
  'ssb-speed': {
    what: 'Speed relative to the solar system barycentre.',
    tex: ['v = |\\mathbf v - \\mathbf v_\\text{SSB}|'],
    source: 'barycentres.js · docs/frontend/barycentres.md',
  },
  // The planets' major moons (moons.js, moons.data.js)
  'moon-orbit': {
    what: 'Where the moon is about its planet: astronomy-engine\'s theory for Jupiter\'s four large moons; for the others, a precessing ellipse from JPL\'s mean elements, with corrections fitted to JPL Horizons.',
    tex: ['M = M_0 + \\frac{360°\\,t}{P} + \\delta M + \\delta n\\,t', '\\omega = \\omega_0 + \\delta\\omega + \\frac{360°\\,t}{P_\\omega}', '\\Omega = \\Omega_0 + \\delta\\Omega \\mp \\frac{360°\\,t}{P_\\Omega}'],
    where: 't: days from J2000; the ellipse lies in the moon\'s Laplace plane (Mars, Saturn) or its planet\'s equator; the planet is drawn at its centre, offset from its system barycentre by its moons\' pull',
    source: 'JPL SSD planetary satellite mean elements; JPL Horizons; Lieske\'s E5 theory via astronomy-engine · docs/frontend/moons.md',
  },
  'moon-radius': {
    what: 'The radius of a sphere of the same volume as the moon.',
    tex: [],
    source: 'the moon\'s JPL Horizons object page',
  },
  'moon-gm': {
    what: 'G times the moon\'s mass. Orbits depend on this product, which tracking measures far better than G or the mass alone.',
    tex: ['\\mu = GM'],
    source: 'the moon\'s JPL Horizons object page (G times the mass where it gives no GM)',
  },
  'moon-albedo': {
    what: 'How bright the full disc is, against a white disc of the same size.',
    tex: [],
    source: 'the moon\'s JPL Horizons object page',
  },
  'moon-rotation': {
    what: 'Time for one turn against the stars. Tides have locked the moon: it turns once each orbit, keeping one face to its planet.',
    tex: ['P_\\text{rot} = P_\\text{orbit}'],
    source: 'JPL SSD planetary satellite mean elements (the period) · docs/frontend/moons.md',
  },
  // panels.tsx: a = 1 / (2/rr - vv^2/mu), T = 2 pi sqrt(a^3/mu)
  'orbital-period': {
    what: 'Time for one orbit, from the osculating orbit at this instant: the conic the body would follow if only its primary pulled.',
    tex: [VIS_VIVA, 'T = 2\\pi\\sqrt{\\frac{a^3}{\\mu}}'],
    where: 'r, v: distance and speed from the primary; μ: the primary\'s GM plus the body\'s',
    source: 'the vis-viva equation; Curtis, 4th ed., ch. 2 · docs/physics/two-body.md',
  },

  // bodyfacts.js density, escapeSpeed
  density: {
    what: 'The mass over the volume of the mean sphere.',
    tex: ['\\bar\\rho = \\frac{GM/G}{\\frac{4}{3}\\pi R^3}'],
    where: 'G = 6.67430 × 10⁻²⁰ km³ kg⁻¹ s⁻² (CODATA 2018); the body\'s own GM, without its moons; R: the mean radius',
    source: 'from the GM and mean radius above; NASA NSSDCA fact sheets give the same to their rounding',
  },
  'escape-speed': {
    what: 'The speed that, at the mean surface and with no air and no further push, carries a thing away for good.',
    tex: ['v_\\text{esc} = \\sqrt{\\frac{2GM}{R}}'],
    where: 'the body\'s own GM; R: the mean radius; not counting its spin. NASA\'s fact sheet takes the giants\' at their equator (Jupiter 59.5 km/s)',
    source: 'energy: ½v² = GM/R · docs/physics/two-body.md',
  },
  // bodyfacts.js siderealDays: 360 / |Ẇ|, Ẇ over 1,000 days
  rotation: {
    what: 'Time for one turn about its axis, against the stars (sidereal).',
    tex: ['W = W_0 + \\dot W d', 'P = \\frac{360°}{|\\dot W|}'],
    where: 'W: the prime meridian\'s angle, d: days from J2000; Ẇ is the mean rate, so librations average out. Ẇ < 0 for a planet turning backwards',
    source: 'IAU WGCCRE 2015 report (Archinal et al. 2018, Celest. Mech. Dyn. Astr. 130:22), via astronomy-engine · docs/physics/orientation.md',
  },
  'rotation-sun': {
    what: 'Time for one turn of the Sun against the stars, at the IAU\'s rate: Carrington\'s, from sunspots at middle latitudes.',
    tex: ['W = 84.176° + 14.1844° d', 'P = \\frac{360°}{14.1844°\\ \\text{/day}}'],
    source: 'IAU WGCCRE 2015 report (Archinal et al. 2018) · docs/physics/orientation.md',
  },
  // bodyfacts.js sunRotationDays
  'sun-differential': {
    what: 'The Sun is gas, and turns faster at its equator than near its poles.',
    tex: ['\\omega(\\varphi) = A + B\\sin^2\\varphi + C\\sin^4\\varphi', 'P = \\frac{2\\pi}{\\omega}'],
    where: 'φ: latitude; A = 2.894, B = −0.428, C = −0.370 µrad/s, sidereal, fitted to small magnetic features. Few features are seen near the poles, so the polar figure is the fit carried there',
    source: 'Howard, Harvey & Forgach 1990, Solar Physics 130, 295 (the default model in SunPy)',
  },
  // bodyfacts.js solarDays
  'solar-day': {
    what: 'Time from one noon to the next: a turn against the Sun, whose direction moves round as the body goes round its orbit.',
    tex: ['P_\\odot = \\frac{360°}{|\\omega - n|}'],
    where: 'ω = ±360°/P, negative when the body turns backwards; n = 360°/T, the mean motion about the Sun (the osculating year)',
    source: 'from the rotation above and the orbit; Venus\'s and Mercury\'s match NASA NSSDCA\'s 2,802 h and 4,222.6 h to 0.03 %',
  },
  // bodyfacts.js obliquity
  obliquity: {
    what: 'The tilt of the spin axis to the orbit\'s axis (obliquity). Over 90°, the body turns backwards.',
    tex: ['\\cos\\varepsilon = \\hat{\\mathbf s}\\cdot\\hat{\\mathbf h}', '\\mathbf h = \\mathbf r\\times\\mathbf v'],
    where: 'ŝ: the spin axis, the IAU pole (flipped where Ẇ < 0); 𝐡: the osculating orbit\'s angular momentum at this instant',
    source: 'IAU WGCCRE 2015 poles (Archinal et al. 2018), via astronomy-engine · docs/physics/orientation.md',
  },
  'sun-tilt': {
    what: 'The tilt of the Sun\'s equator to the ecliptic, the plane of the Earth\'s orbit.',
    tex: ['\\cos\\varepsilon = \\hat{\\mathbf s}\\cdot\\hat{\\mathbf z}_\\text{ecl}'],
    where: 'ŝ: the IAU pole of the Sun, α₀ = 286.13°, δ₀ = 63.87°',
    source: 'IAU WGCCRE 2015 report (Archinal et al. 2018)',
  },
  // bodyfacts.js sunFromBarycentreKm
  barycentre: {
    what: 'How far the solar system\'s centre of mass is from the Sun\'s centre. The Sun wanders round it, mostly with Jupiter and Saturn, often by more than its own radius.',
    tex: ['\\mathbf r_\\text{SSB} = \\frac{\\sum_i \\mu_i\\,\\mathbf r_i}{\\sum_i \\mu_i}'],
    where: '𝐫ᵢ: heliocentric positions; astronomy-engine counts the Sun and the four giant planets',
    source: 'astronomy-engine (MIT), its CalcSolarSystemBarycenter',
  },
  // bodyfacts.js galacticYears
  'galactic-orbit': {
    what: 'Time for the Sun to go once round the centre of the Milky Way, at its present angular rate.',
    tex: ['\\Omega_\\odot = 4.74047\\,\\mu_\\text{Sgr A*}', 'T = \\frac{2\\pi}{\\Omega_\\odot}'],
    where: 'µ = 6.379 mas/yr: Sgr A*, at the centre, drifts along the Galactic plane as the Sun goes round; Ω in km/s per kpc. No distance to the centre is needed. The often quoted 225–250 million years comes from older, rounder values (8.5 kpc, 220 km/s)',
    source: 'Reid & Brunthaler 2004, ApJ 616, 872 (VLBA astrometry of Sgr A*)',
  },

  // ---------------- the MISSION tab (mission-panel.tsx) ----------------
  // nbody.js force model, environment.js drag and sunlight
  'kernel-motion': {
    what: 'The craft is stepped under the gravity of the Sun, planets and Moon (n-body), with the drag of the air and the push of sunlight.',
    tex: [
      '\\ddot{\\mathbf r} = -\\mu_\\odot\\frac{\\mathbf r}{r^3} + \\sum_j \\mathbf a_j + \\mathbf a_{J_2} + \\mathbf a_\\text{env}',
      '\\mathbf a_j = \\mu_j\\left[\\frac{\\mathbf r_j - \\mathbf r}{|\\mathbf r_j - \\mathbf r|^3} - \\frac{\\mathbf r_j}{r_j^3}\\right]',
      '\\mathbf a_\\text{drag} = -\\frac{1}{2}\\rho\\,|\\mathbf v_r|\\,\\mathbf v_r\\,\\frac{C_D A}{m}',
      '\\mathbf a_\\text{sun} = \\nu\\,C_r\\,P\\left(\\frac{1\\ \\text{AU}}{d}\\right)^2\\frac{A}{m}\\,\\hat{\\mathbf s}',
    ],
    where: '𝐚ⱼ: body j\'s pull (position 𝐫ⱼ, GM μⱼ), less the Sun\'s own pull toward it. 𝐚_J₂: the bulge of the Earth, Moon and planets. 𝐚_env: the Earth\'s and Moon\'s fields, tides, relativity, and the two below. 𝐯ᵣ: velocity through the turning air; ρ: US Standard Atmosphere 1976 to 86 km, NASA MET-1999 above; P = 1361 W/m² ÷ c; ν: the share of the Sun\'s disc in view',
    source: 'Yoshida 1990 integrator, Encke near a planet; Montenbruck & Gill, Satellite Orbits, §3.2, §3.4 · ' + KERNEL + ', environment.md',
  },
  // nbody-kernel.md, Events
  soi: {
    what: 'The body whose sphere of influence holds the craft: the innermost one it is inside.',
    tex: ['r_\\text{SOI} = d\\left(\\frac{\\mu}{\\mu_\\text{primary}}\\right)^{2/5}'],
    where: 'd: the body\'s distance from its own primary (the Sun; the Earth, for the Moon)',
    source: 'Laplace\'s sphere of influence; Curtis, 4th ed., §8.4 · ' + KERNEL,
  },
  // mission-panel.tsx: rel.r - altitudeRadius(...)
  altitude: {
    what: 'Height above the body, from the kernel\'s state carried to the clock.',
    tex: ['h = |\\mathbf r - \\mathbf r_P| - R'],
    where: 'R: the Earth\'s equatorial radius, 6,378.137 km (WGS-84); every other body\'s mean radius; about the Sun, 0',
    source: KERNEL,
  },
  // mission-panel.tsx: rel.v
  'craft-speed': {
    what: 'Speed relative to the body the craft is about.',
    tex: ['v = |\\mathbf v - \\mathbf v_P|'],
    source: KERNEL,
  },
  // entry.js liftDirection: c u + s (u x v̂)
  bank: {
    what: 'The bank angle the entry guidance flies: the lift\'s roll about the velocity through the air. Its size sets the range, its sign steers.',
    tex: [
      '\\mathbf L = \\frac{L}{D}\\,D\\,\\left(\\cos\\sigma\\,\\hat{\\mathbf u} + \\sin\\sigma\\,\\hat{\\mathbf u}\\times\\hat{\\mathbf v}_r\\right)',
      'D = \\frac{1}{2}\\rho\\,v_r^2\\,C_D A',
    ],
    where: 'σ: the bank, positive to the left; û: up, square to the air-relative velocity 𝐯ᵣ; L/D and C_D from Orion\'s tables by Mach number',
    source: 'Lu 2014, JGCD 37(3) (FNPEG); Bibb et al. 2011 (Orion aerodynamics) · docs/physics/entry.md',
  },
  // entry.js: 0.5 rho v^2 chuteArea / m
  chutes: {
    what: 'Which parachutes are open, by height above the WGS-84 ellipsoid; their drag adds to the capsule\'s.',
    tex: ['\\mathbf a = -\\frac{\\rho\\,|\\mathbf v_r|\\,\\mathbf v_r}{2m}\\left(C_D A + (C_D A)_\\text{chutes}\\right)'],
    where: 'drogues 2 × 23.2 m², mains 3 × 1,013 m² of drag area',
    source: 'Ray 2017 (CPAS drag areas and reefing) · docs/physics/entry.md',
  },
  impact: {
    what: 'When the craft passed below the surface, at the end of a kernel step.',
    tex: ['\\frac{x^2 + y^2}{a^2} + \\frac{z^2}{b^2} < 1'],
    where: 'the Earth: the WGS-84 ellipsoid about its pole of date, a = 6,378.137 km, b = 6,356.752 km; every other body: the sphere of its mean radius',
    source: KERNEL,
  },
  // mission-panel.tsx: atan2(z, hypot(x, y)), atan2(y, x)
  'lat-lon': {
    what: 'Where it came down: geocentric latitude and longitude in the body\'s own turning frame.',
    tex: ['\\varphi = \\arctan\\frac{z}{\\sqrt{x^2 + y^2}}', '\\lambda = \\mathrm{atan2}(y, x)'],
    where: 'x, y, z: the site in the body-fixed frame (IAU rotation model)',
    source: 'docs/physics/orientation.md',
  },
  // mission-panel.tsx: el.a * (1 - el.e) - R
  periapsis: {
    what: 'The lowest point of the osculating orbit: the conic the craft would follow if only its primary pulled.',
    tex: [VIS_VIVA, 'h_p = a(1 - e) - R'],
    where: 'r, v: distance and speed from the primary; R as for the altitude',
    source: TWO_BODY,
  },
  apoapsis: {
    what: 'The highest point of the osculating orbit.',
    tex: [VIS_VIVA, 'h_a = a(1 + e) - R'],
    where: 'r, v: distance and speed from the primary; R as for the altitude',
    source: TWO_BODY,
  },
  period: {
    what: 'Time for one revolution of the osculating orbit.',
    tex: ['T = 2\\pi\\sqrt{\\frac{a^3}{\\mu}}'],
    where: 'μ: the primary\'s GM',
    source: TWO_BODY,
  },
  // mission-panel.tsx: sqrt(-mu / a)
  'excess-speed': {
    what: 'The speed left at infinity on the osculating hyperbola (v-infinity).',
    tex: ['v_\\infty = \\sqrt{-\\frac{\\mu}{a}}'],
    where: 'a < 0 for a hyperbola',
    source: TWO_BODY,
  },
  eccentricity: {
    what: 'The shape of the osculating orbit: 0 a circle, below 1 an ellipse, above 1 a hyperbola.',
    tex: ['\\mathbf e = \\frac{1}{\\mu}\\left[\\left(v^2 - \\frac{\\mu}{r}\\right)\\mathbf r - (\\mathbf r\\cdot\\mathbf v)\\,\\mathbf v\\right]'],
    where: '𝐫, 𝐯: the state relative to the primary',
    source: TWO_BODY,
  },
  inclination: {
    what: 'The tilt of the osculating orbit\'s plane: about the Sun to the ecliptic, about a planet to the J2000 equator.',
    tex: ['\\mathbf h = \\mathbf r\\times\\mathbf v', 'i = \\arccos\\frac{h_z}{h}'],
    source: TWO_BODY,
  },
  // craft.js: mdot = thrust / ve
  propellant: {
    what: 'Propellant left in the model craft\'s one tank, drawn at the engine\'s flow while it burns.',
    tex: ['\\dot m = \\frac{F}{I_{sp}\\,g_0}'],
    where: 'F: thrust; g₀ = 9.80665 m/s²',
    source: ROCKET_EQ,
  },
  // mission-panel.tsx: c.ve * ln(c.mass / (c.mass - c.fuel))
  'dv-left': {
    what: 'The speed change the propellant left can still give, against the mass now.',
    tex: ['\\Delta v = v_e\\ln\\frac{m}{m - m_\\text{fuel}}', 'v_e = I_{sp}\\,g_0'],
    where: 'm: the craft\'s mass now; g₀ = 9.80665 m/s²',
    source: 'Tsiolkovsky\'s rocket equation; ' + ROCKET_EQ,
  },
  // mission.ts distanceFromFlown
  'flown-path': {
    what: 'How far the craft is from where the real one was at this time.',
    tex: ['d = |\\mathbf r(t) - \\mathbf r_\\text{BET}(t)|'],
    where: '𝐫_BET: JSC\'s reconstructed trajectory, interpolated between its points',
    source: 'NASA JSC Best Estimated Trajectory (BET revF) · docs/validation.md',
  },
  'next-burn': {
    what: 'The real mission\'s next burn, as it was flown.',
    tex: ['1\\ \\text{ft/s} = 0.3048\\ \\text{m/s}'],
    source: 'NASA JSC Best Estimated Trajectory (BET revF); NASA\'s mission blogs for the burns\' names',
  },
  closest: {
    what: 'The closest the craft has come to its planned target so far.',
    tex: ['d_\\text{min} = \\min_t\\,|\\mathbf r(t) - \\mathbf r_\\text{target}(t)|'],
    source: KERNEL,
  },
  'ascent-climb': {
    what: 'The ascent flown in the ROCKET tab, replayed: a gravity turn in the launch plane, joining the kernel at engine cutoff.',
    tex: ['\\ddot{\\mathbf r} = -\\frac{\\mu}{r^2}\\hat{\\mathbf r} + \\frac{T - D}{m}\\,\\hat{\\mathbf v}_\\text{air}'],
    source: ASCENT,
  },

  // ---------------- the PLANNER tab (planner-panel.tsx) ----------------
  grid: {
    what: 'The porkchop cell you picked: a departure date and a time of flight.',
    tex: [],
    source: 'docs/physics/burns-and-launch.md',
  },
  // orbital.js lambert
  lambert: {
    what: 'The conic that joins the two planets\' positions in the time of flight (Lambert\'s problem), solved for its end velocities.',
    tex: [
      '\\sqrt{\\mu}\\,\\Delta t = \\left(\\frac{y}{C}\\right)^{3/2} S + A\\sqrt{y}',
      '\\mathbf v_1 = \\frac{\\mathbf r_2 - f\\,\\mathbf r_1}{g}',
    ],
    where: 'y(z), A: from the transfer angle; C, S: Stumpff functions; f = 1 − y/r₁, g = A√(y/μ)',
    source: 'Curtis, 4th ed., Algorithm 5.2 · docs/physics/lambert.md',
  },
  // porkchop.js transferBetween
  c3: {
    what: 'Launch energy: the square of the excess speed the departure needs.',
    tex: ['\\mathbf v_\\infty = \\mathbf v_1 - \\mathbf v_\\text{Earth}', 'C_3 = |\\mathbf v_\\infty|^2'],
    where: '𝐯₁: the Lambert arc\'s velocity at departure',
    source: 'Curtis, 4th ed., §8.11 · docs/physics/burns-and-launch.md',
  },
  'vinf-arrival': {
    what: 'The excess speed on arrival, relative to the destination.',
    tex: ['v_\\infty = |\\mathbf v_2 - \\mathbf v_\\text{planet}|'],
    where: '𝐯₂: the Lambert arc\'s velocity at arrival',
    source: 'Curtis, 4th ed., §8.11 · docs/physics/burns-and-launch.md',
  },
  // porkchop.js hyperbolicBurn, dvDep + dvArr
  'dv-total': {
    what: 'The departure burn from a 200 km parking orbit, plus the capture burn into a 400 km circular orbit.',
    tex: ['\\Delta v = \\sqrt{v_\\infty^2 + \\frac{2\\mu}{r}} - \\sqrt{\\frac{\\mu}{r}}'],
    where: 'once at each end, with that planet\'s μ and orbit radius r',
    source: 'patched conics; Curtis, 4th ed., §8.5–8.6 · docs/physics/burns-and-launch.md',
  },

  // ---------------- the ROCKET tab (rocket-panel.tsx) ----------------
  // rocket.js stackPerformance
  'stage-dv': {
    what: 'The speed change this stage gives, burning all its propellant, with its vacuum Isp.',
    tex: ['\\Delta v = I_{sp}\\,g_0\\ln\\frac{m_0}{m_f}', 't_b = \\frac{m_p}{\\dot m},\\quad \\dot m = \\frac{T}{I_{sp}\\,g_0}'],
    where: 'm₀: everything at ignition; m_f: less this stage\'s propellant m_p; g₀ = 9.80665 m/s²',
    source: 'Tsiolkovsky\'s rocket equation; Curtis, 4th ed., §13.3–13.4 · docs/physics/rocket.md',
  },
  'stack-dv': {
    what: 'The stages\' speed changes added up, before gravity and drag take their share.',
    tex: ['\\Delta v = \\sum_i I_{sp,i}\\,g_0\\ln\\frac{m_{0,i}}{m_{f,i}}'],
    where: 'each spent stage drops away before the next lights',
    source: 'Curtis, 4th ed., ch. 13 · docs/physics/rocket.md',
  },
  // rocket.js deltaVToOrbit, rotationBonus, launchAzimuth
  'to-orbit': {
    what: 'The speed change to reach a circular orbit: its speed, less the Earth\'s turn along the launch azimuth, plus the ascent\'s losses.',
    tex: [
      '\\Delta v = \\sqrt{\\frac{\\mu}{R + h}} - \\omega R\\cos\\varphi\\sin A + \\Delta v_\\text{loss}',
      '\\sin A = \\frac{\\cos i}{\\cos\\varphi}',
    ],
    where: 'φ: the pad\'s latitude; A: the azimuth for inclination i; ω = 7.292115 × 10⁻⁵ rad/s; R = 6,378.137 km; losses 1.5 km/s until an ascent is flown',
    source: 'Curtis, 4th ed., ch. 13 · docs/physics/rocket.md',
  },
  // rocket.js deltaVToApoapsis
  hohmann: {
    what: 'The first burn of a Hohmann transfer, from the 200 km parking orbit up to 35,786 km.',
    tex: ['\\Delta v = \\sqrt{\\frac{\\mu}{r_1}}\\left(\\sqrt{\\frac{2r_2}{r_1 + r_2}} - 1\\right)'],
    source: 'Curtis, 4th ed., ch. 6 · docs/physics/rocket.md',
  },
  // rocket.js deltaVDeparture
  departure: {
    what: 'The burn from the 200 km parking orbit onto the departure hyperbola (or, for the Moon, the long ellipse) of this launch energy.',
    tex: ['\\Delta v = \\sqrt{C_3 + \\frac{2\\mu}{r}} - \\sqrt{\\frac{\\mu}{r}}'],
    where: 'r: the parking orbit\'s radius; C₃ < 0 is an ellipse, about −2 km²/s² to the Moon',
    source: 'NASA Trajectory Browser\'s convention; Curtis, 4th ed., §8.5 · docs/physics/rocket.md',
  },
  // rocket.js ascent deriv
  ascent: {
    what: 'A gravity turn, integrated in the launch plane: straight up, a small kick, then thrust along the velocity through the turning air.',
    tex: [
      '\\ddot{\\mathbf r} = -\\frac{\\mu}{r^2}\\hat{\\mathbf r} + \\frac{T - D}{m}\\,\\hat{\\mathbf v}_\\text{air}',
      'D = \\frac{1}{2}\\rho\\,v_\\text{air}^2\\,C_D A',
      'I_{sp} = I_{sp,\\text{vac}} + (I_{sp,\\text{SL}} - I_{sp,\\text{vac}})\\frac{p}{p_0}',
    ],
    where: 'ρ, p: US Standard Atmosphere 1976 to 86 km, NASA MET-1999 above; RK4',
    source: ASCENT,
  },
  // rocket-panel.tsx: rvToElements of the burnout state
  'burnout-orbit': {
    what: 'The orbit the burnout state is on, if nothing but the Earth\'s point mass pulled.',
    tex: [VIS_VIVA, 'h_{p,a} = a(1 \\mp e) - R'],
    where: 'R = 6,378.137 km, the equatorial radius the ascent flies over',
    source: TWO_BODY,
  },
  // rocket.js losses
  losses: {
    what: 'What gravity and drag took from the stack\'s ideal speed change on the way up.',
    tex: [
      '\\Delta v_g = \\int g\\sin\\gamma\\,dt,\\quad \\Delta v_D = \\int\\frac{D}{m}\\,dt',
      'q = \\frac{1}{2}\\rho\\,v^2',
    ],
    where: 'γ: the flight-path angle; q: the dynamic pressure (max q)',
    source: ASCENT,
  },
  // ork.js vehicleFromOrk
  'ork-stage': {
    what: 'Each stage\'s total impulse, worked out from the thrust OpenRocket saved, joined by straight lines.',
    tex: ['I = \\int F\\,dt'],
    source: 'OpenRocket\'s saved simulation (.ork) · docs/physics/rocket.md',
  },
  'ork-rocket': {
    what: 'The masses as the saved flight carried them, and the reference area, recovered from the saved drag.',
    tex: ['A = \\frac{D}{q\\,C_D}'],
    where: 'OpenRocket saves the area to three decimals; this undoes that rounding',
    source: 'OpenRocket\'s saved simulation (.ork) · docs/physics/rocket.md',
  },
  'ork-launch': {
    what: 'The simulation\'s launch conditions, as the file holds them.',
    tex: [],
    source: 'OpenRocket\'s saved simulation (.ork)',
  },
  // rocket.js ascent with thrustCurve, cdAt, wind
  'ork-ascent': {
    what: 'This app\'s own flight of the design: a point mass up the rod, then along its velocity through the wind, to apogee.',
    tex: [
      '\\ddot{\\mathbf r} = \\mathbf g + \\frac{F(t)}{m}\\,\\hat{\\mathbf u} - \\frac{\\rho\\,|\\mathbf v_\\text{air}|\\,\\mathbf v_\\text{air}\\,C_D(M)\\,A}{2m}',
    ],
    where: 'û: the axis, turning into the wind with a 0.1 s lag; C_D by Mach number M from the record',
    source: 'checked against OpenRocket and RocketPy · docs/physics/rocket.md',
  },
};
