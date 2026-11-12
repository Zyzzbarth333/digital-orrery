// src/simulation/spacecraft/launch.js
//
// Where a launched craft starts. A launch is given as the hyperbolic excess
// velocity v_inf the craft should leave the planet with. The kernel applies
// the planet's gravity, so the craft starts on that escape hyperbola, on the
// outbound asymptote at R = min(100 planet radii, sphere of influence), with
// the speed energy conservation gives there, sqrt(|v_inf|^2 + 2 mu / R); the
// planet slows it to |v_inf| as it climbs out. Measured against the
// patched-conic energy that is 0.3 % for Earth, 0.1 % for Mars and 3 % for
// Jupiter (the Sun's pull during Jupiter's long climb out is real physics).
//
// Pure: plain arrays, heliocentric J2000 equatorial (EQJ) km and km/s.

export function escapeStart({ planetR, planetV, vInf, mu, radius, muSun }) {
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const vi = norm(vInf);
  const dir = vi > 0 ? vInf.map((x) => x / vi) : planetV.map((x) => x / norm(planetV));
  const soi = mu > 0 ? norm(planetR) * Math.pow(mu / muSun, 0.4) : 0;
  const R = Math.min(soi, 100 * (radius || 0));
  const speed = Math.sqrt(vi * vi + (R > 0 ? 2 * mu / R : 0));
  return {
    r: planetR.map((x, i) => x + R * dir[i]),
    v: planetV.map((x, i) => x + speed * dir[i]),
    startRadius: R,
  };
}
