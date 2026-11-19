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
  // ---------------- the star plate (star-plate.tsx, docs/frontend/interactive-sky.md) ----------------
  'star-name': {
    what: 'The star\'s proper name as the IAU\'s Working Group on Star Names adopted it. Most stars have none: only about six hundred are named.',
    tex: [],
    source: 'IAU WGSN, IAU Catalog of Star Names (exopla.net), read 19 Nov 2026; the names are in the public domain · docs/frontend/interactive-sky.md',
  },
  'star-designation': {
    what: 'The star\'s names in the catalogues: Bayer\'s Greek letter and Flamsteed\'s number with the constellation, and its numbers in the Hipparcos (HIP), Henry Draper (HD) and Bright Star (HR) catalogues.',
    tex: [],
    where: 'HIP and HD from the Hipparcos catalogue; Bayer, Flamsteed and HR from the Bright Star Catalogue, matched by HD number',
    source: 'ESA, The Hipparcos and Tycho Catalogues, SP-1200 (1997); Hoffleit and Warren, The Bright Star Catalogue, 5th revised ed. (1991); both via NASA HEASARC',
  },
  'star-constellation': {
    what: 'The constellation the star\'s Bayer or Flamsteed designation names. Stars with neither are not yet placed: the IAU boundaries come in a later step.',
    tex: [],
    source: 'The Bright Star Catalogue, 5th revised ed. (1991), via NASA HEASARC; the names and genitives as the IAU gives them',
  },
  'star-mag': {
    what: 'How bright the star looks, in Johnson V: each magnitude is 2.512 times fainter, and the faintest a dark-adapted eye sees is about 6.5. Where Hipparcos found the star varying, the row says by how much: under 0.06, 0.06 to 0.6, or over 0.6 mag.',
    tex: ['\\frac{F_1}{F_2} = 10^{-0.4\\,(m_1 - m_2)}'],
    source: 'ESA, The Hipparcos and Tycho Catalogues, SP-1200 (1997), fields H5 and H6, via NASA HEASARC',
  },
  'star-colour': {
    what: 'The star\'s colour index B−V: how much fainter it is in blue light than in visual. Hot blue stars are near −0.3, the Sun 0.65, cool red stars over 1.5. The swatch is the colour the sky draws it, from the temperature this implies.',
    tex: ['T = 4600\\left(\\frac{1}{0.92\\,(B-V) + 1.7} + \\frac{1}{0.92\\,(B-V) + 0.62}\\right)\\ \\text{K}'],
    where: 'T: the effective temperature of a black body of that colour (Ballesteros 2012), a rough guide for giants and reddened stars',
    source: 'B−V: Hipparcos (1997), field H37; F. J. Ballesteros, EPL 97, 34008 (2012)',
  },
  'star-spectral': {
    what: 'The star\'s spectral type, as the catalogue gives it: the class (O B A F G K M, hot to cool), a number within it, and the luminosity class (I supergiant, III giant, V dwarf, like the Sun\'s G2V).',
    tex: [],
    source: 'ESA, The Hipparcos and Tycho Catalogues, SP-1200 (1997), field H76 (mostly from the Michigan Spectral Survey and the HD catalogue), via NASA HEASARC',
  },
  'star-parallax': {
    what: 'How far the star shifts against the distant sky as the Earth goes round the Sun: half the shift, in milliarcseconds, with its one-sigma error.',
    tex: [],
    source: 'ESA, The Hipparcos and Tycho Catalogues, SP-1200 (1997), fields H11 and H16, via NASA HEASARC',
  },
  'star-distance': {
    what: 'How far away the star is, from its parallax. Shown as a value only when the parallax is at least five times its error; otherwise as the range its one-sigma bounds give, or as a least distance when the lower bound reaches zero. One over a noisy parallax is biased and can be badly wrong, so it is never shown bare.',
    tex: ['d = \\frac{1000}{\\varpi}\\ \\text{pc}, \\quad \\sigma_d = \\frac{1000\\,\\sigma_\\varpi}{\\varpi^2}', '1\\ \\text{pc} = 3.26156\\ \\text{ly}'],
    where: 'ϖ: the parallax in milliarcseconds; σϖ its error',
    source: 'Hipparcos (1997); T. E. Lutz and D. H. Kelker, PASP 85, 573 (1973); C. A. L. Bailer-Jones, PASP 127, 994 (2015) · docs/frontend/interactive-sky.md',
  },
  'star-position': {
    what: 'Where the star is on the sky: right ascension and declination in the ICRS, at the catalogue\'s epoch, 1991.25. The sky draws it there: a star\'s own motion moves it at most a few arcminutes in a century.',
    tex: [],
    source: 'ESA, The Hipparcos and Tycho Catalogues, SP-1200 (1997), fields H8 and H9, via NASA HEASARC',
  },
  'star-pm': {
    what: 'The star\'s own motion across the sky, in right ascension (times the cosine of the declination) and declination, in milliarcseconds a year. The sky does not move the stars by it.',
    tex: [],
    source: 'ESA, The Hipparcos and Tycho Catalogues, SP-1200 (1997), fields H12 and H13, via NASA HEASARC',
  },
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
  clouds: {
    what: 'The Earth\'s day side as satellites saw it. Over the Americas and the Pacific, where GOES-East and GOES-West look down from geostationary orbit, the GeoColor frame at the sim\'s minute (one every 10 minutes, never newer than an hour before now, as GIBS is 40-60 minutes behind). Elsewhere one true-colour mosaic a day from polar orbiters, each place imaged once at about 13:30 local time (10:30 for Terra); within two days of now each place shows the newest of the last three days that has it.',
    tex: [],
    source: 'NASA GIBS / EOSDIS: GOES-East and GOES-West ABI GeoColor (NOAA, via NASA SPoRT); VIIRS corrected reflectance on NOAA-21, NOAA-20 and Suomi NPP; MODIS on Terra',
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
  // The landing sites (landingSites.js, landing-site-plate.tsx)
  'site-landed': {
    what: 'When the craft came down, struck or went in, in UTC, as precisely as the source gives it: to the second for most, to the day or the month where that is all it gives. For a rover, when its lander landed.',
    tex: [],
    source: 'NASA NSSDCA\'s spacecraft pages; the LROC team\'s posts; the missions\' own pages and papers · docs/frontend/landing-sites.md',
  },
  'site-crew': {
    what: 'The two astronauts who landed in the lunar module: the commander first, then the lunar module pilot. The third flew on in the command module, in orbit.',
    tex: [],
    source: 'NASA NSSDCA, the Apollo lunar modules\' spacecraft pages',
  },
  'site-coords': {
    what: 'Where the craft is: planetocentric latitude and longitude in the Moon\'s mean-Earth/polar-axis frame, the frame of the LRO maps it is drawn on. Measured by the LROC team from Narrow Angle Camera images of the hardware, with the spacecraft\'s position from LOLA-corrected orbits and the GLD100 shape model for its height.',
    tex: ['\\hat{\\mathbf n} = \\cos\\phi\\cos\\lambda\\,\\mathbf X + \\cos\\phi\\sin\\lambda\\,\\mathbf Y + \\sin\\phi\\,\\mathbf Z'],
    where: 'φ latitude, λ east longitude; X, Y, Z the Moon\'s body axes now (to 0° longitude, 90° east and the north pole); drawn at 1,737.4 km, within 85 m of SPICE\'s MOON_ME',
    source: 'Wagner et al., Icarus 283, 2017, and the LROC team\'s table of 28 July 2016; LROC\'s posts since · docs/frontend/landing-sites.md',
  },
  'site-coords-body': {
    what: 'Where the craft came down: latitude and east longitude in the body\'s IAU frame, the one it is drawn turned with, as the source gives them (a west longitude turned to east). Placed on the body\'s reference ellipsoid along that direction.',
    tex: ['\\mathbf p = r\\,\\hat{\\mathbf u},\\ \\ \\hat{\\mathbf u} = (\\cos\\phi\\cos\\lambda,\\ \\cos\\phi\\sin\\lambda,\\ \\sin\\phi)', 'r = \\left(\\frac{u_x^2}{a^2} + \\frac{u_y^2}{b^2} + \\frac{u_z^2}{c^2}\\right)^{-1/2}'],
    where: 'φ planetocentric latitude, λ east longitude; a, b, c the body\'s radii (NAIF pck00011). A planetographic latitude would differ on a flattened planet: by up to 0.3° on Mars, 3.6° on Jupiter',
    source: 'the sources on the plate; Archinal et al., Celest. Mech. Dyn. Astr. 130, 2018 (IAU WGCCRE 2015) · docs/frontend/landing-sites.md',
  },
  'site-small-body': {
    what: 'Where on the small body the craft touched or landed, in the shape model\'s own frame. The app draws the body as a sphere of its size with no rotation model, so the site is not marked on it: the camera goes to the body.',
    tex: [],
    source: 'the mission\'s papers and pages · docs/frontend/landing-sites.md',
  },
  'site-estimate': {
    what: 'Where the craft was thought to have come down at the time, from its tracking. It has not been found in orbital images, so this may be kilometres out, or more.',
    tex: [],
    source: 'NASA NSSDCA; the missions\' pages · docs/frontend/landing-sites.md',
  },
  'site-elevation': {
    what: 'The ground\'s height at the craft above the body\'s reference surface (for the Moon a sphere of 1,737.4 km, its mean radius; for Mars the MOLA areoid). The app draws the body as its reference sphere or ellipsoid, its relief as shading, so the site is drawn there, not at this height.',
    tex: ['h = r - r_\\text{ref}'],
    source: 'the LROC team (GLD100 and LOLA heights); the missions\' papers · docs/frontend/landing-sites.md',
  },
  'site-sun': {
    what: 'How high the Sun stands above the site\'s horizon now, from the body\'s centre: below zero, it is night there. A lunar day is 29.5 Earth days, a Martian one 24 h 40 min, a Venusian one 117 Earth days.',
    tex: ['h_\\odot = \\arcsin\\left(\\hat{\\mathbf n}\\cdot\\hat{\\mathbf s}\\right)'],
    where: 'n̂ the site\'s vertical (the ellipsoid\'s normal), ŝ the direction from the body to the Sun (DE442), both in J2000',
    source: 'JPL DE442; the body\'s orientation (orientation.js) · docs/frontend/landing-sites.md',
  },
  // Guides and orbit lines (guide-plate.tsx)
  'guide-axis': {
    what: 'The body\'s spin axis: its north pole (IAU: the pole on the north side of the solar system\'s invariable plane) in J2000 right ascension and declination now, how long it takes to turn once against the stars, and how far the axis leans from its orbit\'s pole.',
    tex: ['\\hat{\\mathbf z} = (\\cos\\delta_0\\cos\\alpha_0,\\ \\cos\\delta_0\\sin\\alpha_0,\\ \\sin\\delta_0)', 'P = 360° / |W_1|', '\\varepsilon = \\arccos\\left(\\hat{\\mathbf z}\\cdot\\hat{\\mathbf h}\\right)'],
    where: 'α0, δ0 the pole and W1 the prime meridian\'s rate (degrees a day) of the IAU model; ĥ the pole of the body\'s orbit about its parent now, r × v from DE442. A moon with no IAU model turns with its orbit',
    source: 'Archinal et al., Celest. Mech. Dyn. Astr. 130, 2018 (IAU WGCCRE 2015), as NAIF pck00011; JPL DE442 · docs/physics/gravity-guides.md',
  },
  'guide-soi': {
    what: 'The sphere of influence (Laplace\'s): inside it the body\'s pull, taken as the main one with its parent\'s as a disturbance, describes a craft\'s path better than the other way round. Patched-conic trajectories switch from one to the other there.',
    tex: ['r_\\text{SOI} = a\\left(\\frac{m}{M}\\right)^{2/5}'],
    where: 'a the semi-major axis of the body\'s osculating orbit about its parent now; m/M the ratio of their GMs (DE442)',
    source: 'H. D. Curtis, Orbital Mechanics for Engineering Students, "Sphere of influence"; JPL DE442 · docs/physics/gravity-guides.md',
  },
  'guide-hill': {
    what: 'The Hill sphere: the region where the body can hold a satellite against its parent\'s tide, to first order the distance to its L1 and L2. Taken at its closest to its parent, where it is smallest.',
    tex: ['r_\\text{H} = a(1-e)\\left(\\frac{m}{3M}\\right)^{1/3}'],
    where: 'a, e the body\'s osculating orbit about its parent now; m/M the ratio of their GMs (DE442)',
    source: 'D. P. Hamilton and J. A. Burns, Icarus 96, 1992; JPL DE442 · docs/physics/gravity-guides.md',
  },
  'guide-lagrange': {
    what: 'A Lagrange point of the pair: where a small body keeps its place with the two, in the circular restricted three-body problem, placed along their line and in their plane now. L1, L2 and L3 lie on the line and are unstable; L4 and L5 lead and trail the smaller by 60° and are stable when the mass ratio is under 0.0385.',
    tex: ['\\mu = \\frac{m_2}{m_1 + m_2}', 'x - \\frac{(1-\\mu)(x+\\mu)}{|x+\\mu|^3} - \\frac{\\mu(x-1+\\mu)}{|x-1+\\mu|^3} = 0'],
    where: 'x along the line from the barycentre, in units of the pair\'s separation, solved by Newton\'s method for L1 to L3; L4 and L5 at (1/2 - μ, ±√3/2)',
    source: 'V. Szebehely, Theory of Orbits, 1967, ch. 4; JPL DE442 · docs/physics/gravity-guides.md',
  },
  'guide-pull': {
    what: 'The pull of one body on another, as a point mass: its GM over the square of the distance between their centres, now.',
    tex: ['a = \\frac{GM}{d^2}'],
    where: 'GM from DE442 (NAIF); d from the ephemeris. The Sun\'s pull on the body is given for scale',
    source: 'JPL DE442 · docs/physics/gravity-guides.md',
  },
  'guide-field': {
    what: 'A tag of the magnetic-field layer: a magnetopause or bow shock\'s standoff toward the Sun, a dipole\'s tilt, or an auroral oval\'s model. Its title names the model it is drawn from.',
    tex: [],
    source: 'the models named on the tag · docs/physics/magnetic-fields.md',
  },
  'orbit-osculating': {
    what: 'The orbit the body would follow about its parent if nothing else pulled it: the ellipse through its position and velocity now (the osculating orbit), from the ephemeris state about its parent.',
    tex: ['a = \\left(\\frac{2}{r} - \\frac{v^2}{\\mu}\\right)^{-1}', 'e = \\left|\\frac{\\mathbf v\\times\\mathbf h}{\\mu} - \\hat{\\mathbf r}\\right|', 'P = 2\\pi\\sqrt{a^3/\\mu}'],
    where: 'r, v the body\'s state about its parent (JPL DE442, or the moons\' own ephemerides), h = r × v, μ the GM of the two together. The inclination is to the ecliptic of J2000',
    source: 'JPL DE442; H. D. Curtis, Orbital Mechanics for Engineering Students, ch. 4 · docs/physics/two-body.md',
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
  'irr-size': {
    what: 'The moon\'s diameter. Thirteen were measured from their heat in the infrared by NEOWISE; the rest are estimated from how bright they look, for an assumed dark albedo, uncertain by a quarter or more.',
    tex: ['D = \\frac{2\\ \\text{au}}{\\sqrt{p}}\\, 10^{-0.2\\,(H - M_\\odot)}'],
    where: 'H: the absolute magnitude; p: the albedo, 0.06 for Saturn\'s (as Denk takes it); M☉ = −26.71, the Sun\'s apparent V magnitude. Jupiter\'s and Neptune\'s estimates are Sheppard\'s own',
    source: 'Grav et al. 2015 (NEOWISE); T. Denk, outer Saturnian moons table; the Minor Planet Center\'s discovery circulars; S. S. Sheppard\'s moon tables · docs/frontend/moons.md',
  },
  'irr-shape': {
    what: 'The moon\'s shape where it is known at all: Himalia from Cassini\'s images, 22 of Saturn\'s from how their brightness swings as they turn, which gives the least the long axis can be over the short one. The app draws an ellipsoid of that ratio with the moon\'s volume; the others, as spheres.',
    tex: ['\\frac{a}{b} \\ge 10^{0.4\\,\\Delta m}'],
    where: 'Δm: the lightcurve\'s amplitude near zero phase; the third axis c is taken equal to b',
    source: 'Denk et al. 2018 (Table 3); Porco et al. 2003 · docs/frontend/moons.md',
  },
  'irr-rotation': {
    what: 'How long the moon takes to turn once, from the repeat of its lightcurve. No pole is known, so the app turns it about the pole of its orbit.',
    tex: [],
    source: 'Denk et al. 2018 (Table 3); Pilcher et al. 2012 for Himalia',
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
    where: 'r̂_b: toward the craft from the primary, in body axes; r_cp: the centre of pressure, a tenth of the craft\'s length behind the centre of mass (0.3 m on the MISSION craft); v_b: the air\'s velocity in body axes',
    source: 'docs/physics/sixdof.md',
  },
  // craftAttitude.js drawPropellant; attitude.js rcsThrust
  'attitude-rcs': {
    what: 'The propellant the attitude thrusters have burned: pairs fired as couples, so a torque takes its size over the arm in thrust, drawn from the engine\'s tank at their specific impulse.',
    tex: ['m = \\frac{1}{I_{sp}\\,g_0}\\int \\sum_i \\frac{|\\tau_i|}{L_i}\\,dt'],
    where: 'τ_i: the torque about body axis i (while locked, the hold\'s limit cycle instead); L_i: the thrusters\' arm about it; I_sp = 290 s; g₀ = 9.80665 m/s²',
    source: 'Curtis, 4th ed., §13.3; ArianeGroup 10 N bipropellant thruster (292 s) · docs/physics/sixdof.md',
  },
  // attitude.js limitCycle, holdThrust; craftAttitude.js hold
  'attitude-hold': {
    what: 'The propellant a held attitude costs. On-off thrusters keep it within a deadband by their smallest pulses, so it drifts across, a pulse turns it back, and so on: a limit cycle. A steady disturbance pushes it to one side, and then the pulses just cancel the disturbance.',
    tex: [
      '\\dot J_i = \\tfrac{2}{3}\\,\\frac{b^2 L_i}{\\theta_d I_i}\\quad \\text{for } \\varepsilon_i < \\tfrac{2}{9}',
      '\\dot J_i = 3\\,\\frac{|\\tau_i|}{L_i}\\quad \\text{to } \\tfrac{3}{4},\\qquad \\frac{|\\tau_i|}{L_i}\\quad \\text{beyond}',
      '\\varepsilon_i = \\frac{|\\tau_i|\\,\\theta_d I_i}{b^2 L_i^2},\\qquad \\dot m = \\frac{\\sum_i \\dot J_i}{I_{sp}\\,g_0}',
    ],
    where: 'b: the least pulse a thruster gives, 0.29 N s on the MISSION tab\'s craft (a pair fires, so the rate changes by 2bL/I); θ_d = 0.5°: the deadband; τ_i: the disturbance about axis i; L_i: the thrusters\' arm; I_i: the moment of inertia. With no disturbance, 2/3 of the centred cycle\'s b²L/(θ_d I)',
    source: 'Jackson, Gonzalez and Sims, AIAA GN&C 2007 (NTRS 20080000345), eqs. (1)–(3); AJ10-220 data sheet (0.898 N s at 62.3 N) · docs/physics/sixdof.md',
  },
  // craftAttitude.js propellantInertia, inertiaFor
  'attitude-inertia': {
    what: 'The craft\'s moments of inertia now: the dry craft\'s, and the propellant\'s, so it turns faster as the tank empties. The MISSION craft keeps its propellant in two spherical tanks fore and aft of the centre of mass; a stage launched from the ROCKET tab is a thin-walled cylinder of its diameter round one cylindrical tank.',
    tex: ['I_{xx} = I^\\text{dry}_{xx} + \\tfrac{2}{5} m R^2', 'I_{yy} = I_{zz} = I^\\text{dry}_{yy} + \\tfrac{2}{5} m R^2 + m d^2', '\\text{stage: } I_{xx} = m_\\text{dry} R^2 + \\tfrac12 m R^2,\\ I_{yy} = m_\\text{dry}\\left(\\tfrac{R^2}{2} + \\tfrac{L^2}{12}\\right) + m\\left(\\tfrac{R^2}{4} + \\tfrac{h^2}{12}\\right)'],
    where: 'm: the propellant on board; MISSION craft: R = 0.37 m each tank\'s radius, d = 0.6 m the tanks\' distance from the centre of mass (parallel-axis theorem); stage: R its radius, h its tank\'s length at the propellant\'s bulk density, L = h + 2R its length',
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
    tex: ['d = |\\mathbf r(t) - \\mathbf r_\\text{flown}(t)|'],
    where: '𝐫_flown: the mission\'s reconstructed trajectory, interpolated between its points',
    source: 'Artemis II: NASA JSC Best Estimated Trajectory (BET revF); Artemis I: NASA/JSC navigation\'s as-flown ephemeris, via JPL Horizons; Juno, DART, LRO and MESSENGER: their navigation\'s reconstructions, via JPL Horizons · docs/validation.md',
  },
  'next-burn': {
    what: 'The real mission\'s next burn, as it was flown.',
    tex: ['1\\ \\text{ft/s} = 0.3048\\ \\text{m/s}'],
    source: 'The mission\'s reconstructed trajectory (as for the flown path); NASA\'s mission blogs and releases for the burns\' names and figures',
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
  // journey.js planeAt, parkingPlane.js nodeRate, flownNodeRate, leaveCircularDv
  'journey-plane': {
    what: 'A stay in a planet\'s orbit turns the orbit\'s plane: the planet\'s J2 regresses its node about the pole, so after the stay the plane may no longer hold the way out, and the departure burns out of it. Up to 30 days the capture is aimed for it; beyond, the plane is priced on the day, and the best day near it suggested.',
    tex: ['\\dot\\Omega = -\\frac{3}{2}\\,\\frac{\\sqrt{\\mu}\\,J_2 R^2}{(1-e^2)^2\\,a^{7/2}}\\cos i'],
    where: 'i: the orbit\'s inclination to the planet\'s equator; the rate scaled by the orbit flown ten turns in the J2 field (0.15 to 0.6 % faster at 400 km over Mars); the burn the cheapest single one from the circular orbit onto the way out',
    source: 'Curtis, 4th ed., §4.7, eq. 4.52 (Example 4.8) · docs/physics/journey.md#the-parking-orbits-plane',
  },
  // journey.js planeAt at the Moon, lunarPlane.js moonPlaneTrack
  'journey-plane-moon': {
    what: 'About the Moon J2 alone does not turn a low orbit\'s plane: the Moon\'s lumpy field and the Earth\'s pull do too. So the circular orbit\'s plane is flown through the stay, averaged over each turn: the field\'s even degrees at the orbit\'s pole, and the tides of the Earth and the Sun. Up to 30 days the capture is aimed for it; beyond, the plane is priced on the day, and the best day near it suggested.',
    tex: ['\\frac{d\\hat{\\mathbf n}}{dt} = \\frac{1}{\\omega a^2}\\,\\hat{\\mathbf n}\\times\\nabla_{\\hat{\\mathbf n}}\\bar{U}', '\\bar{U}(\\hat{\\mathbf n}) = \\frac{\\mu}{a}\\sum_{n} P_n(0)\\left(\\frac{R}{a}\\right)^{n} \\sum_m \\bar{P}_{nm}(\\sin\\phi)\\,(C_{nm}\\cos m\\lambda + S_{nm}\\sin m\\lambda) - \\sum_{3} \\frac{\\mu_3 a^2}{4 d^3}\\left(3(\\hat{\\mathbf d}\\cdot\\hat{\\mathbf n})^2 - 1\\right)'],
    where: 'n even; n̂: the orbit\'s normal, at latitude φ and longitude λ in the Moon\'s principal axes; GRAIL GL0660B to degree 30; the third bodies the Earth and the Sun; within a degree of the kernel\'s plane over 90 days 200 km up',
    source: 'Tremaine, Touma & Namouni 2009, AJ 137, 3706, eq. 19 · Jackson, Classical Electrodynamics, 3rd ed., §3.6 · GRAIL GL0660B (Konopliv et al. 2013) · docs/physics/journey.md#the-plane-at-the-moon',
  },
  'journey-orbit-moon': {
    what: 'A low lunar orbit does not stay circular: the field\'s odd degrees, the mascons near the equator above all, raise its eccentricity until the periapsis reaches the ground. Earth-to-Moon journeys arrive near the Moon\'s equator, where 100 km up it falls within weeks. So the orbit\'s mean eccentricity is flown through the stay on the plane\'s track, averaged over each turn, and the stay is flagged where it falls or its periapsis comes within 20 km of the ground.',
    tex: ['\\frac{d\\mathbf e}{dt} = \\frac{1}{\\sqrt{\\mu a}}\\left(\\hat{\\mathbf n}\\times\\nabla_{\\mathbf e}\\bar{U} + \\mathbf e\\times\\nabla_{\\mathbf j}\\bar{U}\\right)', '\\nabla_{\\mathbf e}\\bar{U} = \\sum_{n} \\frac{(n-1)\\,P_n\'(0)}{n(n+1)}\\,\\nabla_S U_n(\\hat{\\mathbf n})'],
    where: 'e: the eccentricity vector, its gradient at e = 0; n̂: the orbit\'s normal; n odd, from 3; U_n: the field\'s degree n on the circle\'s radius, its gradient over the sphere at n̂; GRAIL GL0660B to degree 50, J2\'s turn of the periapsis and the Earth\'s and the Sun\'s tides; falls within a day of the kernel\'s flights 100 km up',
    source: 'Tremaine, Touma & Namouni 2009, AJ 137, 3706, eq. 16 · Jackson, Classical Electrodynamics, 3rd ed., §3.6 · GRAIL GL0660B (Konopliv et al. 2013) · docs/physics/journey.md#a-low-orbit-at-the-moon',
  },
  'flyby-credit': {
    what: 'What a flyby gives: the change in the craft\'s velocity, credited, not spent. The pull turns the excess velocity about the body flown by but leaves its size as it was, and the body\'s own velocity cancels, so the change is the excess velocity out less in; a burn giving the same change would cost that much. A planet\'s flyby changes the craft\'s orbit about the Sun (heliocentric); a moon\'s, its orbit about the planet, and the excess velocity it turns is the one about the moon, not the planet\'s. A powered flyby pays only for the difference in speed (at periapsis) and any turn the lowest pass cannot give.',
    tex: ['\\Delta \\mathbf v = \\mathbf v_{\\infty,\\text{out}} - \\mathbf v_{\\infty,\\text{in}},\\quad |\\Delta \\mathbf v| = 2 v_\\infty \\sin\\frac{\\delta}{2}\\ \\text{(unpowered)}', '\\text{credit} = |\\Delta \\mathbf v| - \\Delta v_\\text{burn}'],
    where: 'v∞: the excess velocity about the body flown by (about a moon reached via its planet, the moon\'s, three-level patched conics); δ: the turn; the credit is set beside the total, not taken off it',
    source: 'Curtis, 4th ed., §8.9 (Example 8.6) · docs/physics/journey.md#chaining-legs-and-the-gravity-assist',
  },
  landing: {
    what: 'How a landing is paid for. Airless (the Moon, Mercury, most moons): capture into the orbit before, then a powered descent of that orbit\'s circular speed, ideal. Through an atmosphere (Venus, Earth, Mars, Titan): entry and parachutes, no propulsive delta-v. Lifting off costs the orbit\'s circular speed again.',
    tex: ['\Delta v_\text{descent} = \sqrt{\mu / r_p}'],
    where: 'r_p: the radius of the orbit before (the waypoint\'s altitude); the flight\'s own descent costs more (gravity losses, about 15 % at the Moon)',
    source: 'Curtis, 4th ed., eq. 8.58 (Example 8.10) · docs/physics/journey.md',
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
  // satellites.ts cloudView
  'sat-cloud': {
    what: 'A debris cloud CelesTrak keeps as a group: the pieces of one breakup the US Space Force still tracks, each with its own element set. Every piece is catalogued under its parent\'s launch, so the cloud is the group\'s pieces with the parent\'s international designator.',
    tex: ['a = \\left(\\frac{\\mu}{n^2}\\right)^{1/3},\\quad h_p = a(1 - e) - R_\\oplus,\\quad h_a = a(1 + e) - R_\\oplus'],
    where: 'heights from each piece\'s mean motion n (Kozai, rev/day) and eccentricity e, with WGS-72\'s μ and R⊕; given as the 10th, 50th and 90th percentiles over the pieces',
    source: 'CelesTrak GP data, the debris groups · docs/frontend/satellites.md',
  },
  // satellites.js inShadow
  'sat-shadow': {
    what: 'How much of the Sun lights the satellite: the fraction of the Sun\'s disc that the Earth and the Moon leave in view, seen from it. Lit with all of it, a partial eclipse in a penumbra, in eclipse in an umbra.',
    tex: ['\\nu = 1 - \\frac{A_\\text{overlap}(a, b, c)}{\\pi a^2}'],
    where: 'a: the Sun\'s angular radius, b: the Earth\'s (or the Moon\'s), c: their separation, all seen from the satellite (DE442). The umbra and penumbra are true cones; the Earth\'s atmosphere is left out',
    source: 'Montenbruck and Gill, Satellite Orbits, 3.4.2; docs/frontend/lighting.md',
  },
  'craft-shadow': {
    what: 'How much of the Sun lights the craft: the fraction of the Sun\'s disc that the bodies near it leave in view. Lit with all of it, a partial eclipse in a penumbra, in eclipse in an umbra.',
    tex: ['\\nu = 1 - \\frac{A_\\text{overlap}(a, b, c)}{\\pi a^2}'],
    where: 'a: the Sun\'s angular radius, b: the body\'s, c: their separation, seen from the craft. The deepest body counts',
    source: 'Montenbruck and Gill, Satellite Orbits, 3.4.2; docs/frontend/lighting.md',
  },

  // passes.js findPasses, lookAngles
  'sat-pass': {
    what: 'Where the satellite is in the sky from the place: SGP4\'s position turned from TEME into the Earth\'s own frame, then seen from the place on the WGS-84 ellipsoid. Azimuth is clockwise from north, elevation above the horizon, without refraction.',
    tex: ['\\mathbf r_\\text{ITRF} = W\\,R_3(\\theta_\\text{GMST})\\,\\mathbf r_\\text{TEME}', '\\sin h = \\hat{\\mathbf u}\\cdot\\frac{\\mathbf r_\\text{ITRF} - \\mathbf r_\\text{site}}{|\\mathbf r_\\text{ITRF} - \\mathbf r_\\text{site}|}'],
    where: 'θ_GMST: IAU 1982, from UT1; W: polar motion; û: the ellipsoid\'s normal at the place. Rise and set at 0°, the peak by golden-section search, each to a millisecond. Within a second and their whole degree of Heavens-Above\'s 90 ISS passes for the same element set',
    source: 'Vallado et al., AIAA 2006-6753, eq. (1); Heavens-Above (check) · docs/frontend/satellites.md',
  },
  // passes.js visibleWindow
  'sat-visible': {
    what: 'When it can be seen: sunlit (out of the Earth\'s shadow) while the Sun is 6° or more below the place\'s horizon, civil twilight\'s end, the sky dark enough for a sunlit satellite to show.',
    tex: ['h_\\odot < -6°\\quad\\text{and}\\quad\\text{out of the shadow}'],
    where: 'h⊙: the Sun\'s geometric elevation (DE442); the shadow a cylinder of the Earth\'s radius. Judged from rise to set, as Heavens-Above does; how bright it is is left out',
    source: 'docs/frontend/satellites.md',
  },
  // satellite-plate.tsx height
  'sat-ground-speed': {
    what: 'The satellite\'s speed against the turning Earth, from SGP4\'s velocity in TEME (whose pole is the true pole of date, the axis the Earth turns about), and the speed of the point beneath it across the ground.',
    tex: ['\\mathbf v_\\text{g} = \\mathbf v_\\text{TEME} - \\boldsymbol\\omega_\\oplus \\times \\mathbf r_\\text{TEME}', 'v_\\text{track} = \\frac{R_\\oplus}{|\\mathbf r|}\\,\\left|\\mathbf v_\\text{g} - (\\mathbf v_\\text{g}\\cdot\\hat{\\mathbf r})\\,\\hat{\\mathbf r}\\right|'],
    where: 'ω⊕ = 7.292115 × 10⁻⁵ rad/s about TEME\'s z axis (WGS-84); R⊕ = 6,371.0 km, the mean radius. Polar motion is left out (under 0.1 m/s). The ISS moves at about 7.66 km/s inertially and about 7.3 km/s over the ground, its track about 6.9 km/s; a geostationary satellite hardly moves over the ground at all',
    source: 'WGS-84 (NIMA TR8350.2); Vallado et al., AIAA 2006-6753 · satellites.test.mjs checks it against the Earth-fixed frame differenced over a second · docs/frontend/satellites.md',
  },
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
