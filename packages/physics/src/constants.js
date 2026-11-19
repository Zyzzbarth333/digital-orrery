// packages/physics/src/constants.js

/* ===================================
   PHYSICAL CONSTANTS
   =================================== */

// Fundamental Constants
export const G = 6.67430e-11;              // Gravitational constant (m³/kg·s²)
export const C = 299792458;                // Speed of light (m/s)

// Distance Conversions (SPICE precision)
export const AU_TO_METERS = 149597870700;  // 1 AU in meters
export const AU_TO_KM = 149597870.7;       // 1 AU in kilometers (SPICE)
export const EARTH_RADIUS_KM = 6371.0084;  // Earth's mean radius (SPICE)
export const SOLAR_RADIUS_KM = 695700;     // Sun's radius (SPICE)

// Time Conversions
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86400;
export const DAYS_PER_YEAR = 365.25;
export const SECONDS_PER_YEAR = 31557600;  // 365.25 * 86400

/* ===================================
   VISUALIZATION SETTINGS
   =================================== */

export const VISUAL_SETTINGS = {
  planetScale: 1,        // Planet size multiplier
  orbitScale: 1,         // Orbit size multiplier
  trailLength: 5000,     // Maximum trail points for spacecraft
  starCount: 10000,      // Background stars
  defaultFOV: 60,        // Camera field of view
};

/* ===================================
   SPACECRAFT PARAMETERS
   =================================== */

export const SPACECRAFT_DEFAULTS = {
  mass: 1000,            // kg
  fuelMass: 500,         // kg
  exhaustVelocity: 3000, // m/s (chemical rocket)
  thrustPower: 50000,    // N (50 kN)
};

// Common delta-v requirements (km/s)
export const DELTA_V = {
  earthOrbitToEscape: 3.2,
  earthToMars: 3.6,
  earthToVenus: 3.5,
  marsOrbitToEscape: 1.4,
  earthEscape: 11.2,
  solarEscape: 42.1,
};

/* ===================================
   CELESTIAL BODY DATA (SPICE PRECISION)
   =================================== */

export const PLANETS = {
  sun: {
    name: 'Sun',
    radius: 695700,                    // km (SPICE mean)
    equatorial_radius: 695700,         // km (SPICE)
    polar_radius: 695700,              // km (SPICE)
    flattening: 0,                     // Perfect sphere
    mass: 1.9884158067718924e30,       // kg (SPICE-derived from GM)
    gm: 132712440041.27939,            // km³/s² (SPICE)
    color: 0xffff00,
    emissive: true,
    temperature: 5778,                 // K (surface)
    rotationPeriod: 25.379994924,      // days (SPICE)
    axialTilt: 7.25,                   // degrees
  },
  
  mercury: {
    name: 'Mercury',
    radius: 2439.7,                    // km (SPICE mean)
    equatorial_radius: 2440.53,        // km (SPICE)
    polar_radius: 2438.26,             // km (SPICE)
    flattening: 0.0009301258333231,    // SPICE
    mass: 3.3010267343683095e23,       // kg (SPICE-derived)
    gm: 22031.868551400003,            // km³/s² (SPICE)
    color: 0x8c7853,
    orbitalPeriod: 87.97,              // days
    rotationPeriod: 58.646145902358,   // days (SPICE)
    semiMajorAxis: 0.38709927,              // AU
    eccentricity: 0.20563593,
    inclination: 7.00497902,                  // degrees
    axialTilt: 0.0346,                 // degrees (SPICE-derived)
    atmospherePressure: 0,             // Pa
  },
  
  venus: {
    name: 'Venus',
    radius: 6051.8,                    // km (SPICE mean)
    equatorial_radius: 6051.8,         // km (SPICE)
    polar_radius: 6051.8,              // km (SPICE)
    flattening: 0,                     // Perfect sphere
    mass: 4.8673520270683565e24,       // kg (SPICE-derived)
    gm: 324858.592,                    // km³/s² (SPICE)
    color: 0xffc649,
    orbitalPeriod: 224.70,             // days
    rotationPeriod: -243.018483985892, // days (SPICE, retrograde)
    semiMajorAxis: 0.72333566,              // AU
    eccentricity: 0.00677672,
    inclination: 3.39467605,                  // degrees
    axialTilt: 177.36,                 // degrees (SPICE-derived)
    atmospherePressure: 9.2e6,         // Pa
  },
  
  earth: {
    name: 'Earth',
    radius: 6371.0084,                 // km (SPICE mean)
    equatorial_radius: 6378.1366,      // km (SPICE)
    polar_radius: 6356.7519,           // km (SPICE)
    flattening: 0.0033528131084555,    // SPICE (WGS84)
    mass: 5.97217066829712e24,         // kg (SPICE-derived)
    gm: 398600.435507,                 // km³/s² (SPICE)
    color: 0x2233ff,
    orbitalPeriod: 365.25,             // days
    rotationPeriod: 0.9972696363,      // days (SPICE)
    semiMajorAxis: 1.000,              // AU
    eccentricity: 0.017,
    inclination: 0.0,                  // degrees (reference)
    axialTilt: 23.44,                  // degrees
    atmospherePressure: 101325,        // Pa
    magneticDipole: {                  // SPICE special data
      latitude: 80.74,                 // degrees
      longitude: 287.34                // degrees
    }
  },
  
  mars: {
    name: 'Mars',
    radius: 3389.9266666666667,        // km (SPICE mean)
    equatorial_radius: 3396.19,        // km (SPICE)
    polar_radius: 3376.2,              // km (SPICE)
    flattening: 0.0058860075555255,    // SPICE
    mass: 6.416909544277408e23,        // kg (SPICE-derived)
    gm: 42828.37362069909,             // km³/s² (SPICE)
    color: 0xcd5c5c,
    orbitalPeriod: 686.98,             // days
    rotationPeriod: 1.02595675596,     // days (SPICE)
    semiMajorAxis: 1.52371034,              // AU
    eccentricity: 0.09339410,
    inclination: 1.84969142,                 // degrees
    axialTilt: 25.19,                  // degrees (SPICE-derived)
    atmospherePressure: 610,           // Pa
  },
  
  jupiter: {
    name: 'Jupiter',
    radius: 69911,                     // km (SPICE mean)
    equatorial_radius: 71492,          // km (SPICE)
    polar_radius: 66854,               // km (SPICE)
    flattening: 0.06487439154,         // SPICE
    mass: 1.8981245973360496e27,       // kg (SPICE-derived)
    gm: 126686531.900370,              // km³/s² (SPICE)
    color: 0xdaa520,
    orbitalPeriod: 4332.59,            // days
    rotationPeriod: 0.41353832581,     // days (SPICE)
    semiMajorAxis: 5.20288700,              // AU
    eccentricity: 0.04838624,
    inclination: 1.30439695,                  // degrees
    axialTilt: 3.13,                   // degrees (SPICE-derived)
    atmospherePressure: null,          // No solid surface
  },
  
  saturn: {
    name: 'Saturn',
    radius: 58232,                     // km (SPICE mean)
    equatorial_radius: 60268,          // km (SPICE)
    polar_radius: 54364,               // km (SPICE)
    flattening: 0.09796243446,         // SPICE
    mass: 5.683173671924996e26,        // kg (SPICE-derived)
    gm: 37931206.234362,               // km³/s² (SPICE)
    color: 0xf4a460,
    orbitalPeriod: 10759.22,           // days
    rotationPeriod: 0.44400925924,     // days (SPICE)
    semiMajorAxis: 9.53667594,              // AU
    eccentricity: 0.05386179,
    inclination: 2.48599187,                  // degrees
    axialTilt: 26.73,                  // degrees (SPICE-derived)
    atmospherePressure: null,          // No solid surface
    hasRings: true,
  },
  
  uranus: {
    name: 'Uranus',
    radius: 25362,                     // km (SPICE mean)
    equatorial_radius: 25559,          // km (SPICE)
    polar_radius: 24973,               // km (SPICE)
    flattening: 0.02292734458,         // SPICE
    mass: 8.68096368537679e25,         // kg (SPICE-derived)
    gm: 5793951.256527,                // km³/s² (SPICE)
    color: 0x4fd1c5,
    orbitalPeriod: 30688.5,            // days
    rotationPeriod: -0.71833333334,    // days (SPICE, retrograde)
    semiMajorAxis: 19.18916464,             // AU
    eccentricity: 0.04725744,
    inclination: 0.77263783,                 // degrees
    axialTilt: 97.77,                  // degrees (SPICE-derived)
    atmospherePressure: null,          // No solid surface
  },
  
  neptune: {
    name: 'Neptune',
    radius: 24622,                     // km (SPICE mean)
    equatorial_radius: 24764,          // km (SPICE)
    polar_radius: 24341,               // km (SPICE)
    flattening: 0.01708124697,         // SPICE
    mass: 1.0240872063503284e26,       // kg (SPICE-derived)
    gm: 6835103.145462,                // km³/s² (SPICE)
    color: 0x4169e1,
    orbitalPeriod: 60182,              // days
    rotationPeriod: 0.66526249994,     // days (SPICE)
    semiMajorAxis: 30.06992276,             // AU
    eccentricity: 0.00859048,
    inclination: 1.77004347,                 // degrees
    axialTilt: 28.32,                  // degrees (SPICE-derived)
    atmospherePressure: null,          // No solid surface
  },

  pluto: {
    name: 'Pluto',
    radius: 1188.3,                    // km (mean)
    equatorial_radius: 1188.3,         // km
    polar_radius: 1188.3,              // km
    flattening: 0,                     // Essentially spherical
    mass: 1.303e22,                    // kg
    gm: 869.6,                         // km³/s² 
    color: 0xc8a882,                   // Light brown/tan
    orbitalPeriod: 90560,              // days (247.94 years)
    rotationPeriod: -6.38723,          // days (retrograde)
    semiMajorAxis: 39.482,             // AU
    eccentricity: 0.2488,
    inclination: 17.16,                // degrees
    axialTilt: 122.53,                 // degrees (retrograde)
    atmospherePressure: 1,             // Pa (very thin)
  }
};

/* ===================================
   GRAVITATIONAL PARAMETERS (μ = GM) - SPICE PRECISION
   =================================== */

export const GRAVITATIONAL_PARAMETERS = {
  sun:     1.3271244004127794e20,    // m³/s² (SPICE)
  mercury: 2.2031868551400003e13,    // m³/s² (SPICE)
  venus:   3.24858592e14,            // m³/s² (SPICE)
  earth:   3.986004355070226e14,     // m³/s² (SPICE)
  mars:    4.282837362069909e13,     // m³/s² (SPICE)
  jupiter: 1.2668653190037039e17,    // m³/s² (SPICE)
  saturn:  3.793120623436167e16,     // m³/s² (SPICE)
  uranus:  5.793951256527211e15,     // m³/s² (SPICE)
  neptune: 6.835103145462294e15      // m³/s² (SPICE)
};

/* ===================================
   DERIVED CONSTANTS
   =================================== */

// Orbital velocities at planet distances (km/s)
export const ORBITAL_VELOCITIES = {
  mercury: 47.87,
  venus:   35.02,
  earth:   29.78,
  mars:    24.07,
  jupiter: 13.07,
  saturn:  9.69,
  uranus:  6.81,
  neptune: 5.43
};

// Escape velocities from planet surfaces (km/s) - can be recalculated with SPICE GM
export const ESCAPE_VELOCITIES = {
  mercury: 4.25,
  venus:   10.36,
  earth:   11.19,
  mars:    5.03,
  jupiter: 60.20,
  saturn:  36.09,
  uranus:  21.38,
  neptune: 23.56
};

/* ===================================
   MISSION PLANNING CONSTANTS
   =================================== */

// Typical launch windows (Earth days between opportunities)
export const SYNODIC_PERIODS = {
  earthMars:    779.9,  // ~26 months
  earthVenus:   583.9,  // ~19 months
  earthJupiter: 398.9,  // ~13 months
  earthSaturn:  378.1,  // ~12.5 months
};

// Hohmann transfer times (days)
export const TRANSFER_TIMES = {
  earthMars:    259,    // ~8.5 months
  earthVenus:   146,    // ~5 months
  earthJupiter: 997,    // ~2.7 years
  earthSaturn:  2208,   // ~6 years
};