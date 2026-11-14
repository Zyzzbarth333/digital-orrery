// src/physics/smallbodies.fetch.mjs
//
// Fetches the asteroids and comets the orrery shows from JPL's Small-Body
// Database query API (https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html):
// osculating heliocentric elements (ecliptic J2000) with their epochs.
//
//   npm run fetch:smallbodies
//
// Groups (SBDB orbit classes):
//   main belt (IMB, MBA, OMB, MCA) brighter than H 16 (185,811 in Nov 2026),
//   near-Earth asteroids (IEO, ATE, APO, AMO), Jupiter trojans (TJN),
//   centaurs and trans-Neptunian objects (CEN, TNO): all of each;
//   comets: all.
// Each page of 20,000 is cached in ~/.cache/digital-orrery/sbdb-full, two
// seconds apart, so a rerun asks only for what it does not have. The
// reduced file the app loads is written by smallbodies.build.mjs.

import fs from 'node:fs';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');
const API = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
// Full precision: the API's default output is rounded for display (Ceres's
// a to 2.766 au, angles to 0.01 deg), tens of thousands of km off.
export const CACHE = `${process.env.HOME}/.cache/digital-orrery/sbdb-full`;
fs.mkdirSync(CACHE, { recursive: true });
const PAGE = 20000;

const AST = 'spkid,pdes,name,class,epoch,e,a,i,om,w,ma,H,diameter,albedo';
const COM = 'spkid,pdes,name,prefix,class,epoch,e,q,i,om,w,tp,M1,K1';
export const GROUPS = [
  { key: 'mainbelt', params: { 'sb-class': 'IMB,MBA,OMB,MCA', 'sb-cdata': JSON.stringify({ AND: ['H|LE|16'] }), fields: AST } },
  { key: 'neo', params: { 'sb-class': 'IEO,ATE,APO,AMO', fields: AST } },
  { key: 'trojans', params: { 'sb-class': 'TJN', fields: AST } },
  { key: 'outer', params: { 'sb-class': 'CEN,TNO', fields: AST } },
  { key: 'comets', params: { 'sb-kind': 'c', fields: COM } },
];

async function get(params) {
  const url = `${API}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'digital-orrery data fetch' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`  retry ${attempt}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const g of GROUPS) {
    const { fields, ...countOnly } = g.params;
    const { count } = await get(countOnly);
    const pages = Math.ceil(Number(count) / PAGE);
    console.log(`${g.key}: ${count} objects, ${pages} pages`);
    for (let p = 0; p < pages; p++) {
      const file = `${CACHE}/${g.key}_${String(p).padStart(3, '0')}.json`;
      if (fs.existsSync(file)) continue;
      const d = await get({ ...g.params, sort: 'spkid', limit: PAGE, 'limit-from': p * PAGE, 'full-prec': 'true' });
      fs.writeFileSync(file, JSON.stringify({ fields: d.fields, data: d.data }));
      console.log(`  page ${p + 1}/${pages}: ${d.data.length} rows`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const bytes = fs.readdirSync(CACHE).reduce((n, f) => n + fs.statSync(`${CACHE}/${f}`).size, 0);
  console.log(`cached in ${CACHE}: ${(bytes / 1e6).toFixed(1)} MB`);
}
