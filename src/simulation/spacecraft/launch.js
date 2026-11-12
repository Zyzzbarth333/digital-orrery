// src/simulation/spacecraft/launch.js
//
// Where a launched craft starts. A launch is given as the hyperbolic excess
// velocity v_inf the craft should leave the planet with. Launches use
// departureHyperbola (below): periapsis on a parking orbit, asymptote along
// v_inf. escapeStart is the fallback for v_inf = 0 (no asymptote) and for
// bodies without GM: a radial start, which is a degenerate hyperbola.
//
// escapeStart: the kernel applies
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

// A true departure: the hyperbola about the planet whose periapsis is on a
// circular parking orbit of radius rp and whose outgoing asymptote points
// along vInf. The craft starts at periapsis (where the departure burn is
// made) at the launch instant.
//
//   e     = 1 + rp |v_inf|^2 / mu                    (eccentricity)
//   th_inf = arccos(-1 / e)                         (true anomaly of the asymptote)
//   v_p   = sqrt(|v_inf|^2 + 2 mu / rp)             (speed at periapsis)
//
// In the orbit plane, with unit normal n, the outgoing asymptote is
// u = cos(th_inf) p + sin(th_inf) q (p towards periapsis, q along the
// periapsis velocity). With w = n x u that inverts to
//   p = cos(th_inf) u - sin(th_inf) w,   q = sin(th_inf) u + cos(th_inf) w.
//
// The plane can be any rotation about u. By default it is the one closest to
// the planet's equator (pole: unit vector, EQJ): n = (k - (k.u) u) normalised,
// whose inclination is the declination of the asymptote, the launch-window
// limit. planeAngle (rad) rotates the plane about u from there. When u is
// parallel to the pole the plane is undefined and any perpendicular is used.
//
// Pure: plain arrays, heliocentric J2000 equatorial (EQJ) km and km/s.
export function departureHyperbola({ planetR, planetV, vInf, mu, rp, pole = [0, 0, 1], planeAngle = 0 }) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const n = norm(a); return a.map((x) => x / n); };
  const vi = norm(vInf);
  if (!(vi > 0) || !(mu > 0) || !(rp > 0)) throw new Error('departureHyperbola needs v_inf > 0, mu > 0 and rp > 0');
  const u = vInf.map((x) => x / vi);
  let n = pole.map((x, i) => x - dot(pole, u) * u[i]);
  if (norm(n) < 1e-9) n = Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]);
  n = unit(n);
  if (planeAngle) {
    // Rodrigues rotation of n about u (n is perpendicular to u).
    const c = Math.cos(planeAngle), s = Math.sin(planeAngle), uxn = cross(u, n);
    n = n.map((x, i) => c * x + s * uxn[i]);
  }
  const e = 1 + rp * vi * vi / mu;
  const thInf = Math.acos(-1 / e);
  const w = cross(n, u);
  const p = u.map((x, i) => Math.cos(thInf) * x - Math.sin(thInf) * w[i]);
  const q = u.map((x, i) => Math.sin(thInf) * x + Math.cos(thInf) * w[i]);
  const vp = Math.sqrt(vi * vi + 2 * mu / rp);
  return {
    r: planetR.map((x, i) => x + rp * p[i]),
    v: planetV.map((x, i) => x + vp * q[i]),
    e, thInf, vp,
    inclinationToPole: Math.acos(Math.min(1, Math.abs(dot(n, unit(pole))))),
  };
}
