// src/physics/trajbrowser.fetch.mjs
//
// Fetches the optimal transfers NASA Ames's Trajectory Browser
// (https://trajbrowser.arc.nasa.gov, Mission Design Division) lists for the
// planets, and writes them to public/trajbrowser/planets.json for the
// PLANNER tab (docs/frontend/mission.md#nasas-trajectory-browser).
//
// The browser answers only form posts and sends no cross-origin headers, so
// the app cannot query it from a visitor's browser; this script queries it
// once, here. Its results come as JavaScript objects in the page: each
// trajectory is a list of segments (time in seconds past J2000, delta-v in
// m/s, a state in metres and m/s, heliocentric ecliptic or about the planet
// whose SPK ID the segment carries). The table the page draws is worked out
// from those segments, as below.
//
//   node src/physics/trajbrowser.fetch.mjs [first year] [last year]
//
// The browser's limits: launch years 2010 to 2040, delta-v up to 20 km/s.

import fs from 'node:fs';
import dns from 'node:dns';

// The site's IPv6 address is unreachable from some networks, and Node tries
// it first; its slow searches (up to a minute for the outer planets) also
// warrant a retry.
dns.setDefaultResultOrder('ipv4first');
// Each raw answer is cached (~/.cache/digital-orrery/trajbrowser), so a
// rerun after a failure asks the server only for what it has not answered.
const CACHE = `${process.env.HOME}/.cache/digital-orrery/trajbrowser`;
fs.mkdirSync(CACHE, { recursive: true });
async function cached(name, body) {
  const file = `${CACHE}/${name}.html`;
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const html = await post(body);
  fs.writeFileSync(file, html);
  await new Promise((r) => setTimeout(r, 15e3));             // gentle on their server
  return html;
}
async function post(body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(URL_TB, { method: 'POST', body, headers: { 'User-Agent': 'digital-orrery trajectory comparison' }, signal: AbortSignal.timeout(180e3) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 5) throw err;
      console.log(`  retrying after: ${err.cause?.code ?? err.message}`);
      await new Promise((r) => setTimeout(r, 20e3 * attempt));
    }
  }
}

const URL_TB = 'https://trajbrowser.arc.nasa.gov/traj_browser.php';
// Per planet: the longest flight (years) and the delta-v ceiling (km/s) of
// the search. The browser's one-per-year optima depend on both (a higher
// ceiling returns fewer, as higher-delta-v trajectories take their windows),
// so each is set to the planet's real opportunities.
const PLANETS = { Mercury: [2, 12], Venus: [1, 8], Mars: [2, 7], Jupiter: [7, 12], Saturn: [10, 15], Uranus: [16, 20], Neptune: [21, 20] };
// Route letters by SPK ID; the browser gives the outer planets as their
// system barycentres (5 to 8).
const LETTER = { 199: 'Me', 1: 'Me', 299: 'V', 2: 'V', 399: 'E', 3: 'E', 499: 'M', 4: 'M', 599: 'J', 5: 'J', 699: 'S', 6: 'S', 799: 'U', 7: 'U', 899: 'N', 8: 'N', 10: '' };
const J2000 = Date.UTC(2000, 0, 1, 12);
const first = Number(process.argv[2] ?? 2026), last = Number(process.argv[3] ?? 2040);   // the browser takes launch years 2010-2040

// The search form's fields, as the page posts them. wdw_width 365: the best
// trajectory in each year-long window ("1-yr local optima").
// The NEO boxes stay unticked (absent): ticked, the browser searches every
// near-Earth object instead of the custom list. maxMag and maxOCC must still
// hold valid values.
const form = (target, type) => new URLSearchParams({
  maxMag: '25', maxOCC: '4', chk_target_list: 'on', target_list: target,
  mission_class: 'oneway', mission_type: type, LD1: String(first), LD2: String(last),
  maxDT: String(PLANETS[target][0]), DTunit: 'yrs', maxDV: String(PLANETS[target][1]), min: 'DV', wdw_width: '365', submit: 'Search',
});

function parse(html) {
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('var segs'));
  if (!script) return null;
  const v = (name) => JSON.parse(script.match(new RegExp(`var ${name}\\s*=\\s*(\\{[\\s\\S]*?\\});`))[1]);
  const segs = v('segs'), bodies = v('bodies');
  const byId = new Map();
  segs.Traj_ID.forEach((id, k) => {
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(Object.fromEntries(Object.keys(segs).map((f) => [f, segs[f][k]])));
  });
  const gm = Object.fromEntries(bodies.SPK_ID.map((id, k) => [id, bodies.GM[k] / 1e9]));
  // The destination's constants and the periapsis its captures use.
  const destId = segs.SPK_ID.at(-1), k = bodies.SPK_ID.indexOf(destId);
  const last = [...byId.values()][0]?.at(-1);
  const body = k < 0 ? null : { spk: destId, muKm3s2: bodies.GM[k] / 1e9, radiusKm: bodies.Dia1[k] / 2000, rPeriKm: last ? Math.hypot(last.RX, last.RY, last.RZ) / 1000 : null };
  const list = [...byId.values()].map((ss) => {
    const dep = ss[0], dest = ss.at(-1).SPK_ID;
    const arrival = ss.find((x, k) => k > 0 && x.SPK_ID === dest);
    // Injection from a 200 km LEO: dv = sqrt(C3 + 2 mu/r) - sqrt(mu/r).
    const rLeo = Math.hypot(dep.RX, dep.RY, dep.RZ) / 1000, mu = gm[399], vc = Math.sqrt(mu / rLeo), vp = dep.DV / 1000 + vc;
    // Each encounter is two segments (entering the sphere of influence, then
    // periapsis): consecutive repeats are one flyby.
    const flybys = ss.slice(1, -1).filter((x) => x.SPK_ID !== 10 && x.SPK_ID !== dest)
      .filter((x, i, a) => i === 0 || a[i - 1].SPK_ID !== x.SPK_ID).map((x) => LETTER[x.SPK_ID] ?? '?');
    return {
      depMs: Math.round(J2000 + dep.T * 1000), arrMs: Math.round(J2000 + arrival.T * 1000),
      c3: vp * vp - 2 * mu / rLeo,
      injectionDv: dep.DV / 1000,
      postDv: ss.slice(1).reduce((s, x) => s + x.DV, 0) / 1000,
      route: ['E', ...flybys, LETTER[dest]].join(''),
    };
  }).sort((a, b) => a.depMs - b.depMs);
  return { list, body };
}

const out = { limits: PLANETS, source: 'NASA Ames Research Center, Trajectory Browser (Mission Design Division)', url: URL_TB, fetched: new Date().toISOString().slice(0, 10), years: [first, last], conventions: 'one-way; patched conics with a Lambert heliocentric leg; injection from a 200 km circular LEO; rendezvous delta-v to capture at the planet as the browser defines it; 1-yr local optima minimising total delta-v', bodies: {} };
for (const p of Object.keys(PLANETS)) {
  out.bodies[p.toLowerCase()] = {};
  for (const type of ['rendezvous', 'flyby']) {
    const parsed = parse(await cached(`${p}-${type}-${first}-${last}-${PLANETS[p].join('-')}`, form(p, type)));
    const list = parsed?.list ?? [];
    out.bodies[p.toLowerCase()][type] = list;
    // The body's constants from either search; the capture periapsis only
    // means something for a rendezvous.
    if (parsed?.body && (type === 'rendezvous' || !out.bodies[p.toLowerCase()].body)) out.bodies[p.toLowerCase()].body = parsed.body;
    console.log(`${p.padEnd(8)} ${type.padEnd(10)} ${list.length} optima${list.length ? `, best ${Math.min(...list.map((t) => t.injectionDv + t.postDv)).toFixed(3)} km/s` : ''}`);
  }
}
const path = new URL('../../public/trajbrowser/planets.json', import.meta.url);
fs.mkdirSync(new URL('.', path), { recursive: true });
fs.writeFileSync(path, JSON.stringify(out));
console.log(`wrote ${path.pathname}, ${(fs.statSync(path).size / 1024).toFixed(1)} kB`);
