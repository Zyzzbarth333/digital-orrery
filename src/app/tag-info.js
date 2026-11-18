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
const EPHEMERIS = 'JPL DE442 for every planet, Pluto and the Moon, a Chebyshev fit for 2000–2050 within a metre of it; outside those years astronomy-engine (MIT), within 10⁻⁴ of DE442 · docs/physics/ephemerides-and-gm.md';
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
  triaxial: {
    what: 'The body\'s reference ellipsoid: its semi-axes along the prime meridian, 90° east of it, and the pole. Spinning giants bulge at the equator; small moons are stretched toward their planet. The scene draws this shape.',
    tex: ['\\frac{x^2}{a^2} + \\frac{y^2}{b^2} + \\frac{z^2}{c^2} = 1', 'f = \\frac{a - c}{a}'],
    where: 'x, y, z: body-fixed, x through 0° longitude, z through the north pole',
    source: 'IAU WGCCRE, as NAIF\'s planetary constants kernel pck00011 gives it',
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
    where: 'the spacecraft kernel pulls with it near the planet, where the moons pull with their own',
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
    where: '𝐫ᵢ: heliocentric positions, μᵢ: GMs (DE442). Mars to Pluto: DE442\'s system barycentres, which are the planets\' positions; the EMB from DE442\'s Earth and Moon; the SSB: DE442\'s own for 2000–2050, else from the Sun, every planet system, Earth, the Moon and Pluto (within 150 km of JPL Horizons)',
    source: 'JPL DE442; astronomy-engine outside 2000–2050; JPL Horizons for the checks · docs/frontend/barycentres.md',
  },
  'bary-gm': {
    what: 'G times the mass of everything this barycentre is the centre of.',
    tex: ['\\mu = \\sum_i \\mu_i'],
    source: 'JPL DE442 GMs (gm_de442.tpc) · docs/physics/ephemerides-and-gm.md',
  },
  'bary-offset': {
    what: 'How far the body\'s centre is from the barycentre: its moons pull it round this point.',
    tex: ['\\mathbf r_\\text{planet} - \\mathbf r_\\text{B} = -\\sum_i \\frac{\\mu_i}{\\mu_\\text{system}}\\,\\mathbf r_i'],
    where: '𝐫ᵢ: each moon about the planet\'s centre; for Earth, the Moon from DE442. From 2000 to 2049 the offset is the satellite ephemeris\'s own planet centre, which sums every moon',
    source: 'moons.js (JPL satellite ephemerides) and DE442 · docs/frontend/moons.md',
  },
  'ssb-offset': {
    what: 'How far the Sun\'s centre is from the solar system barycentre. The Sun wanders round it, mostly with Jupiter and Saturn, often by more than its own radius.',
    tex: ['\\mathbf r_\\text{SSB} = \\frac{\\sum_i \\mu_i\\,\\mathbf r_i}{\\mu_\\odot + \\sum_i \\mu_i}'],
    where: 'For 2000–2050, DE442\'s own SSB, which counts every body JPL integrates; outside it, 𝐫ᵢ: heliocentric positions of every planet system, Earth, the Moon and Pluto, within 150 km of JPL Horizons',
    source: 'JPL DE442; DE442 GMs and astronomy-engine outside 2000–2050 · docs/frontend/barycentres.md',
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
    what: 'Where the moon is about its planet. From 2000 to 2049, JPL\'s satellite ephemerides, as Chebyshev series within 1 km of them, loaded a system and a year at a time. Outside that, or until the year has loaded: astronomy-engine\'s theory for Jupiter\'s four large moons, and for the others a precessing ellipse from JPL\'s mean elements with corrections fitted to JPL Horizons.',
    tex: ['M = M_0 + \\frac{360°\\,t}{P} + \\delta M + \\delta n\\,t', '\\omega = \\omega_0 + \\delta\\omega + \\frac{360°\\,t}{P_\\omega}', '\\Omega = \\Omega_0 + \\delta\\Omega \\mp \\frac{360°\\,t}{P_\\Omega}'],
    where: 'The ellipse (the fallback): t days from its epoch, in the moon\'s Laplace plane (Mars, Jupiter\'s inner moons, Saturn), its planet\'s equator, or the ecliptic (Uranus\'s irregular moons); the planet is drawn at its centre, offset from its system barycentre by its moons\' pull',
    source: 'JPL satellite ephemerides mar099s, jup365, sat441, sat415, ura184, nep098, plu060 (NAIF); JPL SSD planetary satellite mean elements; JPL Horizons; Lieske\'s E5 theory via astronomy-engine · docs/frontend/moons.md',
  },
  'moon-radius': {
    what: 'The radius of a sphere of the same volume as the moon.',
    tex: [],
    source: 'the moon\'s JPL Horizons object page',
  },
  'moon-gm': {
    what: 'G times the moon\'s mass. Orbits depend on this product, which tracking measures far better than G or the mass alone.',
    tex: ['\\mu = GM'],
    where: 'the spacecraft kernel pulls with it within 1.25 times its planet\'s sphere of influence',
    source: 'the moon\'s JPL Horizons object page (G times the mass where it gives no GM)',
  },
  'moon-albedo': {
    what: 'How bright the full disc is, against a white disc of the same size.',
    tex: [],
    source: 'the moon\'s JPL Horizons object page',
  },
  // The irregular moons (irregularMoons.js, irregular-moon-plate.tsx)
  'irr-position-table': {
    what: 'Where the moon is about its planet\'s centre in JPL\'s own integration of its orbit, with the Sun\'s and the planets\' pull: as its point is drawn.',
    tex: ['\\mathbf r = \\mathbf r_\\text{moon} - \\mathbf r_\\text{planet}'],
    where: 'both about the system barycentre, from Chebyshev series within 0.5 km of the satellite ephemeris (1000 km for S/2023 S 38, whose e = 0.909 orbit dives to 1.1 million km), 2000 to 2049, loaded a system and a year at a time while the layer is shown',
    source: 'JPL satellite ephemerides jup347, jup348, jup349, sat455, sat456, sat457, sat459, nep104 (NAIF) · docs/frontend/moons.md',
  },
  'irr-position-elements': {
    what: 'Where the moon is about its planet, on a precessing ellipse in the ecliptic from JPL\'s mean elements, with corrections fitted to JPL Horizons. The Sun pulls an irregular moon about far more than this allows: a rough place only.',
    tex: ['M = M_0 + \\frac{360°\\,t}{P} + \\delta M + \\delta n\\,t', '\\omega = \\omega_0 + \\delta\\omega + \\frac{360°\\,t}{P_\\omega}', '\\Omega = \\Omega_0 + \\delta\\Omega \\mp \\frac{360°\\,t}{P_\\Omega}'],
    where: 't days from the epoch; its fitted residual over 2000–2050 is in the plate\'s note',
    source: 'JPL SSD planetary satellite mean elements; JPL Horizons · docs/frontend/moons.md',
  },
  'irr-elements': {
    what: 'The moon\'s mean orbit about its planet, referred to the J2000 ecliptic: an average over the Sun\'s pull, which swings the real orbit about it.',
    tex: [],
    source: 'JPL SSD planetary satellite mean elements (ssd.jpl.nasa.gov/sats/elem) · docs/frontend/moons.md',
  },
  'irr-sense': {
    what: 'Which way the moon goes round: prograde with its planet\'s orbit (inclination under 90° to the ecliptic) or retrograde, against it. Most irregular moons are retrograde, a sign that they were captured.',
    tex: ['\\text{retrograde:}\\; i > 90°'],
    source: 'JPL SSD planetary satellite mean elements · docs/frontend/moons.md',
  },
  'irr-radius': {
    what: 'The moon\'s mean radius where it has been measured, or estimated from its brightness; most of the small ones have only been seen as points of light, and are drawn at a nominal size.',
    tex: [],
    source: 'the moon\'s JPL Horizons object page',
  },
  'irr-gm': {
    what: 'G times the moon\'s mass, where it has been measured (Himalia\'s from its pull on other moons and on spacecraft). The irregular moons do not pull on spacecraft in the app: the largest, Himalia, has a twenty-thousandth of Europa\'s GM.',
    tex: ['\\mu = GM'],
    source: 'the moon\'s JPL Horizons object page',
  },
  'irr-discovery': {
    what: 'When the moon was found, and by whom.',
    tex: [],
    source: 'JPL SSD Planetary Satellite Discovery Circumstances (ssd.jpl.nasa.gov/sats/discovery.html)',
  },
  'moon-rotation': {
    what: 'Time for one turn against the stars. Tides have locked the moon: it turns once each orbit, keeping one face to its planet, rocking a little about it (its libration).',
    tex: ['P_\\text{rot} = \\frac{360°}{|W_1|}', 'W = W_0 + W_1 d + \\sum_j w_j \\sin\\theta_j'],
    where: 'W: the prime meridian\'s angle from the node of the moon\'s equator; d: days from J2000; θ_j: the system\'s nutation-precession angles',
    source: 'IAU WGCCRE 2015 report, as NAIF\'s pck00011 gives it · docs/physics/orientation.md',
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

  // ---------------- a small body's plate (small-body-plate.tsx) ----------------
  'sb-class': {
    what: 'The body\'s orbit class in JPL\'s Small-Body Database, which sorts asteroids and comets by where their orbits go.',
    tex: [],
    source: 'JPL SBDB orbit classes, ssd-api.jpl.nasa.gov/doc/sbdb_filter.html · docs/frontend/small-bodies.md',
  },
  // smallBodies.js positionAu
  'sb-position': {
    what: 'Where the body is, carried along a fixed ellipse about the Sun from its elements: as its point and marker are drawn.',
    tex: ['M = M_0 + n(t - t_0),\\quad n = \\frac{k}{a^{3/2}}', 'E - e\\sin E = M'],
    where: 'k = 0.01720209895, the Gaussian constant (rad/day, a in au); t₀ = 2026-01-01 TT. The planets\' pull moves the real body off this ellipse slowly: Ceres by 75,000 km in a year',
    source: 'elements from JPL Horizons at t₀ · docs/frontend/small-bodies.md',
  },
  // smallBodies.js positionAu, sbTable.js
  'sb-position-exact': {
    what: 'Where the body is in JPL\'s own integration of it, with the planets\' and the largest asteroids\' pull: as its point and marker are drawn.',
    tex: [],
    where: 'a Chebyshev fit to JPL\'s SB441 ephemeris, within 1 km of it from 2000 to 2050; outside those years, a fixed ellipse from the nearer end',
    source: 'JPL SB441 (sb441-n373s.bsp; Farnocchia 2021, JPL IOM 392R-21-005) · docs/frontend/small-bodies.md',
  },
  'sb-elements-exact': {
    what: 'The osculating orbital elements now: the ellipse the body is on at this moment, from its position and velocity in JPL\'s integration.',
    tex: [VIS_VIVA],
    where: 'a: semi-major axis; e: eccentricity; i: inclination to the ecliptic; μ⊙ = k² au³/day²',
    source: 'JPL SB441, through the Chebyshev fit · docs/frontend/small-bodies.md',
  },
  // smallBodies.js smallBodyFacts
  'sb-speed': {
    what: 'Speed relative to the Sun, on its ellipse.',
    tex: ['v = \\sqrt{\\mu_\\odot\\left(\\frac{2}{r} - \\frac{1}{a}\\right)}'],
    where: 'μ⊙ = k² au³/day²',
    source: 'the vis-viva equation; Curtis, 4th ed., ch. 2',
  },
  'sb-elements': {
    what: 'The osculating orbital elements at 2026-01-01 TT: the ellipse the body was on then.',
    tex: [],
    where: 'a: semi-major axis; e: eccentricity; i: inclination to the ecliptic',
    source: 'JPL Horizons, osculating elements at the epoch, for the 36 named bodies; JPL\'s Small-Body Database for the rest, packed to 0.0055° in angle (the drawn point\'s own)',
  },
  'sb-apsides': {
    what: 'The nearest and farthest the body comes to the Sun on that ellipse.',
    tex: ['q = a(1 - e),\\quad Q = a(1 + e)'],
    source: 'from the elements above',
  },
  'sb-period': {
    what: 'Time for one orbit of the Sun, by Kepler\'s third law.',
    tex: ['T = 2\\pi\\sqrt{\\frac{a^3}{\\mu_\\odot}} = \\frac{2\\pi}{n}'],
    source: 'from the semi-major axis, with the Gaussian constant the drawing uses',
  },
  'sb-diameter': {
    what: 'The body\'s diameter as measured: by spacecraft, radar, occultations or its heat (infrared).',
    tex: [],
    source: 'JPL Small-Body Database',
  },
  // smallBodies.js diameterFromH, smallBodies.ts sizeOf
  'sb-size-assumed': {
    what: 'JPL\'s database gives no diameter, so the sphere drawn is a guess, and says so.',
    tex: ['D = \\frac{1329\\ \\text{km}}{\\sqrt{p}}\\,10^{-H/5}'],
    where: 'p: geometric albedo, taken as 0.15; a comet\'s H is its coma\'s, so a comet is drawn as a 5 km nucleus',
    source: 'JPL CNEOS, asteroid size estimator (cneos.jpl.nasa.gov/tools/ast_size_est.html); Fowler & Chillemi, in The IRAS Minor Planet Survey (1992, PL-TR-92-2049)',
  },
  'sb-h': {
    what: 'Absolute magnitude: how bright the body would be 1 au from both the Sun and the observer, fully lit.',
    tex: ['m = H + 5\\log_{10}(r\\Delta) - 2.5\\log_{10}\\Phi(\\alpha)'],
    where: 'r, Δ: distances from the Sun and the observer (au); Φ(α): the H-G phase function, G = 0.15',
    source: 'JPL Small-Body Database; Bowell et al. 1989 (the H-G system) · docs/frontend/small-bodies.md',
  },
  'sb-m1': {
    what: 'A comet\'s total magnitude, its coma and all, at 1 au from the Sun and the observer.',
    tex: ['m = M_1 + 5\\log_{10}\\Delta + K_1\\log_{10} r'],
    where: 'K₁: how fast it brightens toward the Sun',
    source: 'JPL Small-Body Database · docs/frontend/small-bodies.md',
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
  // attitude.js controlTorque, slewTime; craftAttitude.js
  attitude: {
    what: 'The craft\'s attitude: a quaternion turned by its thrusters toward the chosen direction, the thrust along its body x axis. Held there, it is the reference itself.',
    tex: [
      '\\dot{\\mathbf q} = \\tfrac{1}{2}\\,\\mathbf q \\otimes (0, \\boldsymbol\\omega)',
      '\\boldsymbol\\omega_\\text{cmd} = \\hat{\\mathbf e}\\,\\min\\left(\\omega_\\text{max}, \\sqrt{2\\alpha_b\\theta + c^2} - c\\right) + \\boldsymbol\\omega_\\text{ref}',
    ],
    where: 'θ, ê: the angle and axis from the body to the reference; α_b: 80 % of the turning acceleration the torque limit allows; c = α_b T_p, T_p = 0.4 s',
    source: 'eigenaxis rotation; docs/physics/sixdof.md',
  },
  'attitude-rate': {
    what: 'How fast the craft is turning, in its own axes: the body rates of Euler\'s equations.',
    tex: ['\\mathbf I\\,\\dot{\\boldsymbol\\omega} = \\boldsymbol\\tau - \\boldsymbol\\omega \\times \\mathbf I\\boldsymbol\\omega'],
    where: 'I: the inertia tensor; τ: the thrusters\' torque, the gravity gradient and the air\'s',
    source: 'sixdof.js, checked against NASA\'s 6-DOF check cases · docs/physics/sixdof.md',
  },
  'attitude-turn': {
    what: 'The time the controller takes for the turn still to go, from rest, by its torque limit.',
    tex: ['t_\\text{min} = \\frac{\\theta}{\\omega_\\text{max}} + \\frac{\\omega_\\text{max}}{\\alpha}'],
    where: 'the bang-coast-bang least time, when the rate limit is reached; the controller brakes at 80 % of α, so it takes a few per cent longer',
    source: 'docs/physics/sixdof.md',
  },
  'attitude-torque': {
    what: 'The torques on the craft beyond its thrusters: the gravity gradient, and drag acting behind the centre of mass low in the air.',
    tex: [
      '\\boldsymbol\\tau_\\text{gg} = \\frac{3\\mu}{r^3}\\,\\hat{\\mathbf r}_b \\times \\mathbf I\\,\\hat{\\mathbf r}_b',
      '\\boldsymbol\\tau_\\text{aero} = \\mathbf r_\\text{cp} \\times \\left(-\\tfrac{1}{2}\\rho\\,|\\mathbf v_b|\\,\\mathbf v_b\\,C_D A\\right)',
    ],
    where: 'r̂_b: toward the craft from the primary, in body axes; r_cp: the centre of pressure, 0.3 m behind the centre of mass; v_b: the air\'s velocity in body axes',
    source: 'docs/physics/sixdof.md',
  },
  // craftAttitude.js drawPropellant; attitude.js rcsThrust
  'attitude-rcs': {
    what: 'The propellant the attitude thrusters have burned: pairs fired as couples, so a torque takes its size over the arm in thrust, drawn from the engine\'s tank at their specific impulse.',
    tex: ['m = \\frac{1}{I_{sp}\\,g_0}\\int \\sum_i \\frac{|\\tau_i|}{L_i}\\,dt'],
    where: 'τ_i: the torque about body axis i (held against the disturbance while locked); L_i: the thrusters\' arm about it; I_sp = 290 s; g₀ = 9.80665 m/s²',
    source: 'Curtis, 4th ed., §13.3; ArianeGroup 10 N bipropellant thruster (292 s) · docs/physics/sixdof.md',
  },
  // craftAttitude.js propellantInertia, inertiaFor
  'attitude-inertia': {
    what: 'The craft\'s moments of inertia now: the dry craft\'s, and the propellant\'s in two spherical tanks fore and aft of the centre of mass, so it turns faster as the tank empties.',
    tex: ['I_{xx} = I^\\text{dry}_{xx} + \\tfrac{2}{5} m R^2', 'I_{yy} = I_{zz} = I^\\text{dry}_{yy} + \\tfrac{2}{5} m R^2 + m d^2'],
    where: 'm: the propellant on board; R = 0.37 m: each tank\'s radius; d = 0.6 m: the tanks\' distance from the centre of mass (parallel-axis theorem)',
    source: 'Curtis, 4th ed., ch. 9 · docs/physics/sixdof.md',
  },
  // craftAttitude.js turnPlan
  'attitude-auto': {
    what: 'When the craft will start turning to the next manoeuvre node by itself: early enough to settle before it fires. After the burn it goes back to the mode it had.',
    tex: ['t_\\text{turn} = t_\\text{node} - (1.1\\,t_\\text{slew} + 5\\ \\text{s})'],
    where: 't_slew: the controller\'s own time for the turn, measured where the craft and the node\'s direction will be then',
    source: 'docs/physics/sixdof.md',
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

  // ---------------- the journey planner (journey-panel.tsx) ----------------
  // journey.js solveLeg, departCost, arriveCost
  'journey-leg': {
    what: 'One leg of the journey by patched conics: the Lambert arc between the two stops about the body they share, and the burns at each end onto and off it.',
    tex: ['\\Delta v_\\text{dep} = \\sqrt{v_\\infty^2 + \\frac{2\\mu}{r_p}} - \\sqrt{\\frac{\\mu}{r_p}}', '\\Delta v_\\text{cap} = \\sqrt{v_\\infty^2 + \\frac{2\\mu}{r_p}} - \\sqrt{\\frac{\\mu(1+e)}{r_p}}'],
    where: 'v∞: the arc\'s velocity less the body\'s; r_p: the parking or capture orbit\'s radius; e = 0 (circular)',
    source: 'Curtis, 4th ed., §8.6–8.8, eqs. 8.40 and 8.58 · docs/physics/journey.md',
  },
  // transfers.js poweredFlyby, bPlane
  flyby: {
    what: 'The flyby that turns the excess velocity arriving onto the one the next leg leaves with: the periapsis whose two half-hyperbolas make the turn, and a burn at periapsis for any change of speed.',
    tex: ['\\delta = \\sin^{-1}\\frac{1}{e_\\text{in}} + \\sin^{-1}\\frac{1}{e_\\text{out}},\\quad e = 1 + \\frac{r_p v_\\infty^2}{\\mu}', 'B = r_p\\sqrt{1 + \\frac{2\\mu}{r_p v_\\infty^2}}'],
    where: 'B: the aiming radius, the size of the B vector in the B-plane (B·T in the ecliptic, B·R across it)',
    source: 'Curtis, 4th ed., §8.9, eqs. 8.71 and 8.75 (Example 8.6) · docs/physics/journey.md',
  },
  'journey-shaped': {
    what: 'The leg flown free by two-body motion from its departure (or from a flyby aimed by hand), each burn node adding its prograde, normal and radial delta-v; how far from the waypoint it ends at the arrival date.',
    tex: ['\\Delta\\mathbf v = \\Delta v_P\\,\\hat{\\mathbf T} + \\Delta v_N\\,\\hat{\\mathbf N} + \\Delta v_R\\,\\hat{\\mathbf R}', '\\hat{\\mathbf T} = \\frac{\\mathbf v}{v},\\quad \\hat{\\mathbf N} = \\frac{\\mathbf r \\times \\mathbf v}{|\\mathbf r \\times \\mathbf v|},\\quad \\hat{\\mathbf R} = \\hat{\\mathbf T} \\times \\hat{\\mathbf N}'],
    where: 'about the leg\'s central body, at the node\'s place; the miss counts as reached inside the target\'s sphere of influence',
    source: 'journey.js shapeLeg · docs/physics/journey.md#shaping-it-by-hand',
  },
  'journey-total': {
    what: 'Every burn of the journey added up, and from its first departure to its last arrival.',
    tex: ['\\Delta v = \\sum \\Delta v_\\text{burn}'],
    source: 'docs/physics/journey.md',
  },
  'kernel-check': {
    what: 'The journey flown by the n-body kernel: aimed corrections to each waypoint\'s B-plane on the way, the periapsis trimmed inside its sphere of influence, and the closest approach measured.',
    tex: ['\\Delta r = |r_\\text{closest}| - r_{p,\\text{planned}}'],
    source: 'journeyFlight.js · docs/physics/journey.md#flying-it',
  },
  // staging.js sizeLauncher (rocket.js optimalStaging)
  'journey-stack': {
    what: 'The lightest stack of stages for the journey\'s delta-v and the climb to orbit, each stage sized by optimal staging.',
    tex: ['\\sum_i c_i \\ln\\frac{c_i\\eta - 1}{c_i\\varepsilon_i\\eta} = \\Delta v', 'n_i = \\frac{c_i\\eta - 1}{c_i\\varepsilon_i\\eta},\\quad m_i = \\frac{n_i - 1}{1 - n_i\\varepsilon_i}\,m_\\text{above}'],
    where: 'c_i = I_sp g₀; ε_i: structural ratio; η: the Lagrange multiplier',
    source: 'Curtis, 4th ed., §13.6, eqs. 13.83–13.86 (Example 13.7) · docs/physics/journey.md#the-rocket-it-needs',
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
  // satellites.js stateEqj (SGP4 via satellite.js, then temeToEqj)
  'sat-position': {
    what: 'Where the satellite is now: SGP4 run from its element set, the theory the elements were fitted with, then turned from SGP4\'s TEME frame into J2000.',
    tex: ['\\mathbf r_\\text{J2000} = P^\\text{T} N^\\text{T} R_3(-E_q)\\,\\mathbf r_\\text{TEME}', 'E_q = \\Delta\\psi\\cos\\varepsilon'],
    where: 'P: IAU 1976 precession; N: IAU 1980 nutation; E_q: the equation of the equinoxes without its 1994 terms. An element set is good to about a kilometre at its epoch, and drifts by a few kilometres a day from it (more in low orbit, with the drag)',
    source: 'Hoots and Roehrich, Spacetrack Report No. 3 (1980); Vallado et al., AIAA 2006-6753, eq. C-3; satellite.js (MIT) · docs/frontend/satellites.md',
  },
  'sat-elements': {
    what: 'The satellite\'s general perturbations (GP) element set, as the US Space Force publishes it: SGP4 mean elements at the epoch, not the osculating ellipse.',
    tex: [],
    where: 'mean motion in revolutions a day; B*: SGP4\'s drag term, per Earth radius',
    source: 'CelesTrak GP data (celestrak.org), from the US Space Force via Space-Track.org',
  },
  // satellites.js meanOrbit
  'sat-orbit': {
    what: 'The orbit\'s size from SGP4\'s mean elements: its semi-major axis from the mean motion, and the heights of perigee and apogee above the Earth\'s equatorial radius.',
    tex: ['a = \\left(\\frac{\\mu}{n^2}\\right)^{1/3},\\quad h_p = a(1 - e) - R_\\oplus,\\quad h_a = a(1 + e) - R_\\oplus'],
    where: 'μ and R⊕ = 6,378.135 km from WGS-72, SGP4\'s own constants; n Brouwer\'s mean motion (SGP4\'s initialisation)',
    source: 'Hoots and Roehrich, Spacetrack Report No. 3 (1980)',
  },
  'sat-epoch': {
    what: 'When the element set is for, and how far the clock is from it. SGP4\'s error grows with the time from epoch: element sets are refitted every few hours to days.',
    tex: [],
    source: 'CelesTrak GP data, EPOCH (UTC)',
  },
  // satellites.js inShadow
  'sat-shadow': {
    what: 'Whether the Sun lights the satellite or the Earth hides it: behind the Earth and within the Earth\'s radius of the line through the Earth\'s centre from the Sun.',
    tex: ['\\mathbf r\\cdot\\hat{\\mathbf s} < 0,\\quad |\\mathbf r - (\\mathbf r\\cdot\\hat{\\mathbf s})\\,\\hat{\\mathbf s}| < R_\\oplus'],
    where: 'ŝ: the Sun\'s direction from the Earth (DE442). A cylinder: the umbra\'s cone narrows by 0.27° of its own, and the penumbra is left out (a few seconds in low orbit)',
    source: 'docs/frontend/satellites.md',
  },
  // satellite-plate.tsx height
  'sat-height': {
    what: 'Height above the WGS-84 ellipsoid, at the satellite\'s geocentric latitude.',
    tex: ['h = |\\mathbf r| - \\frac{ab}{\\sqrt{b^2\\cos^2\\phi + a^2\\sin^2\\phi}}'],
    where: 'a = 6,378.137 km, b = 6,356.752 km; φ: geocentric latitude, from the equator of J2000 (the pole of date is 0.3° from it: under a kilometre of height)',
    source: 'WGS-84 (NIMA TR8350.2)',
  },
  // spacecraft.js stateIn
  'probe-position': {
    what: 'Where the spacecraft is: JPL Horizons\' trajectory, held as states about a centre body and filled in between them.',
    tex: ['\\mathbf r(t) = (1 - w)\\,K(\\mathbf s_a, t - t_a) + w\\,K(\\mathbf s_b, t - t_b)', 'w = 3u^2 - 2u^3,\\quad u = \\frac{t - t_a}{t_b - t_a}'],
    where: 'K: each state carried along its own two-body orbit about the centre; or, where the path bends slowly, the cubic through both states. Within 2 km of every Horizons sample checked',
    source: 'JPL Horizons · docs/frontend/spacecraft.md',
  },
  'probe-legs': {
    what: 'Which of JPL\'s trajectories for this craft the clock is in: reconstructed from tracking after the fact, or predicted ahead by its flight team.',
    tex: [],
    where: 'the names and spans are Horizons\' own; a prediction leaves out manoeuvres planned since it was made',
    source: 'JPL Horizons (ssd.jpl.nasa.gov/horizons), the craft\'s trajectory notes',
  },
  'probe-packing': {
    what: 'How the app holds the trajectory: a state every few minutes for a low orbiter, up to one a day in cruise, the fewest that keep every Horizons sample within the tolerance.',
    tex: [],
    source: 'npm run fetch:spacecraft · docs/frontend/spacecraft.md',
  },
};
