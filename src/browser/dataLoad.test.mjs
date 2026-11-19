// src/browser/dataLoad.test.mjs
//
// The physics' injected data loader (dataLoad.js):
//   - with a loader that has nothing, loadEphemerides resolves false, says
//     what each missing table costs, and installs nothing;
//   - the browser's route (loadEphemerides, promises) handed the disk
//     (nodeData.js) installs the same tables as the Node route
//     (installEphemerides), to the bit;
//   - a missing file says to run npm run data, from either loader: on disk,
//     and through fetch when a dev server answers with its index.html.
// It does not import deNode.js: it installs the tables itself.
//
//   node src/browser/dataLoad.test.mjs

import { loadEphemerides, installEphemerides, DE_TABLE_PATH } from '@digital-orrery/physics/dataLoad.js';
import { fsLoader, nodeLoader } from '@digital-orrery/physics/nodeData.js';
import { fetchLoader } from './fetchData.js';
import { deTableInstalled, deHelioState } from '@digital-orrery/physics/deTable.js';
import { sbTableInstalled, sbIds, sbHelioState } from '@digital-orrery/physics/sbTable.js';
import { eopInstalled, eopAt } from '@digital-orrery/physics/eop.js';
import { spaceWeatherInstalled, spaceWeatherAt } from '@digital-orrery/physics/spaceWeather.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const installed = () => [deTableInstalled(), sbTableInstalled(), eopInstalled(), spaceWeatherInstalled()];

// Every answer a rejection, as fetch gives for a site without the data.
const none = { buffer: async (p) => { throw new Error(`${p}: HTTP 404`); }, json: async (p) => { throw new Error(`${p}: HTTP 404`); }, text: async (p) => { throw new Error(`${p}: HTTP 404`); } };
const warned = [], warn = console.warn;
console.warn = (m) => warned.push(String(m));
const okNone = await loadEphemerides(none);
await new Promise((r) => setTimeout(r, 0)); // the space weather, which nothing waits for
console.warn = warn;
check(okNone === false && installed().every((x) => !x), `with no data, loadEphemerides resolves false and installs nothing (${installed()})`);
check(warned.length === 4 && ['DE442', 'SB441', 'Earth orientation', 'space weather'].every((w) => warned.some((m) => m.includes(w))), `and warns once for each of the four tables (${warned.length})`);

// The browser's route, handed the disk.
const ok = await loadEphemerides(fsLoader(new URL('../../public/', import.meta.url)));
await new Promise((r) => setTimeout(r, 0));
check(ok === true && installed().every(Boolean), `loadEphemerides through the disk installs all four (${installed()})`);
const ETS = [0, 3.1e8, 8.2e8, 1.5e9];
const MS = [Date.UTC(2003, 9, 29), Date.UTC(2024, 4, 10), Date.UTC(2026, 10, 19)];
const sample = () => JSON.stringify([
  ETS.map((et) => ['mars', 'jupiter', 'pluto'].map((k) => deHelioState(k, et))),
  ETS.map((et) => sbIds().slice(0, 5).map((id) => sbHelioState(id, et))),
  MS.map((ms) => eopAt(ms)), MS.map((ms) => spaceWeatherAt(ms)),
]);
const viaPromises = sample();
installEphemerides(nodeLoader);
check(!/null/.test(viaPromises) && sbIds().length >= 5, `the sample is real states (${viaPromises.length} characters, ${sbIds().length} asteroids)`);
check(sample() === viaPromises, 'installEphemerides (at once) gives the same states, Earth orientation and space weather, to the bit');

// A missing file, on disk.
let err = null;
try { fsLoader(new URL('./no-such-root/', import.meta.url)).buffer(DE_TABLE_PATH, 'DE442'); } catch (e) { err = e; }
check(err?.missing === true && /^DE442: .*de442-2000-2050\.bin is missing \(run npm run data\)$/.test(err.message), `on disk, a missing file throws, marked missing: ${err?.message.replace(new URL('.', import.meta.url).pathname, 'src/browser/')}`);

// And through fetch, where a dev server answers a missing file with the
// app's index.html (and a 200); a real 404 says so.
const realFetch = globalThis.fetch, asked = [];
globalThis.fetch = async (url) => { asked.push(url); return url.endsWith('.json') ? new Response('{}', { status: 404 }) : new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }); };
const web = fetchLoader('/digital-orrery/');
const msg = async (p) => { try { await p; return 'resolved'; } catch (e) { return e.message; } };
const htmlMsg = await msg(web.buffer(DE_TABLE_PATH));
const notFound = await msg(web.json('data/spaceweather.json', 'space weather'));
globalThis.fetch = realFetch;
check(asked[0] === '/digital-orrery/ephemeris/de442-2000-2050.bin', `the fetch loader asks for the path under its base URL (${asked[0]})`);
check(htmlMsg === '/digital-orrery/ephemeris/de442-2000-2050.bin is missing (run npm run data)', `an index.html answer is a missing file: ${htmlMsg}`);
check(notFound === 'space weather: HTTP 404', `a 404 says so: ${notFound}`);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
