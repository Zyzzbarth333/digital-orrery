// src/physics/ork.test.mjs
//
// OpenRocket design files (ork.js): reading them, and flying a saved flight
// with the app's ascent.
// 1. The file: a design of our own, written as OpenRocket writes its files
//    and stored zipped (with OpenRocket's data descriptors), gzipped and
//    plain, reads the same every way.
// 2. The round trip: a two-stage flight flown by ascent() and saved in that
//    format comes back as the same vehicle, and flies to the same apogee,
//    at full precision and at the four figures OpenRocket saves.
// 3. OpenRocket's own examples, where they are on this machine (they are
//    GPL, so not in the repo; rocket.openrocket.mjs unpacks them into
//    ~/.cache/digital-orrery/openrocket/designs): every saved simulation
//    flown against OpenRocket's own apogee.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { orkXml, readOrk, vehicleFromOrk, flyOrk, parseXml } from './ork.js';
import { ascent, EARTH } from './rocket.js';
import { standardAtmosphere } from './atmosphere.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(72)); console.log(s); console.log('='.repeat(72)); };
const rel = (a, b) => Math.abs(a / b - 1);

// A zip of one file as OpenRocket writes it: deflated, sizes in a data
// descriptor after the data (flag bit 3), UTF-8 names (bit 11).
function zipOne(name, data) {
  const body = zlib.deflateRawSync(data), nm = Buffer.from(name);
  const crc = zlib.crc32 ? zlib.crc32(data) : 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x808, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(nm.length, 26);
  const desc = Buffer.alloc(16); desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc >>> 0, 4); desc.writeUInt32LE(body.length, 8); desc.writeUInt32LE(data.length, 12);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x808, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc >>> 0, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nm.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nm.length + body.length + desc.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + nm.length, 12); end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nm, body, desc, central, nm, end]);
}

// ------------------------------------------------------------------ flight
// A two-stage rocket of our own, flown straight up from sea level by
// ascent() in the 1976 standard atmosphere, with drag against Mach that
// differs by stage and with the engine lit.
const G = 9.80665;
const STAGES = [
  { name: 'Booster', motor: 'K550', dry: 1.6, prop: 0.75, thrustCurve: [[0, 0], [0.05, 900], [0.3, 700], [2.2, 520], [2.6, 0]] },
  { name: 'Sustainer', motor: 'J350', dry: 0, prop: 0.38, thrustCurve: [[0, 0], [0.4, 0], [0.45, 420], [1.6, 330], [2.0, 0]] },
];
const PAYLOAD = 2.1, AREA = 0.0081;
const CD = [{ on: [[0, 0.52], [0.5, 0.50], [0.9, 0.62]], off: [[0, 0.62], [0.5, 0.60], [0.9, 0.74]] }, { on: [[0, 0.41], [0.5, 0.40], [0.9, 0.50]], off: [[0, 0.49], [0.5, 0.48], [0.9, 0.58]] }];
const lerp = (pts, x) => { if (x <= pts[0][0]) return pts[0][1]; if (x >= pts.at(-1)[0]) return pts.at(-1)[1]; let i = 1; while (pts[i][0] < x) i++; const [a, b] = [pts[i - 1], pts[i]]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); };
const isa = (h) => { const s = standardAtmosphere(Math.max(0, h) / 1000); return { rho: s.rho, p: s.p / 101325, T: s.T, P: s.p }; };
const sound = (h) => Math.sqrt(1.4 * 287.053 * isa(h).T);
const sep = STAGES[0].thrustCurve.at(-1)[0];
const stageAt = (t) => (t < sep ? 0 : 1);
const thrustAt = (t) => (t < sep ? lerp(STAGES[0].thrustCurve, t) : lerp(STAGES[1].thrustCurve, t - sep));
const cdAt = (M, t, burning) => lerp(CD[stageAt(t)][burning ? 'on' : 'off'], M);
const truth = ascent({ stages: STAGES, payload: PAYLOAD, vertical: true, stopAtApogee: true, coast: 1e6, cdAt, area: AREA, atmosphere: isa, g0: G, R: EARTH.R, dt: 0.001, sample: 0.01 });
const truthApogee = truth.events.find((e) => e.type === 'apogee');

// The flight as OpenRocket saves it: its columns at each step, and events.
const TYPES = ['Time', 'Altitude', 'Vertical velocity', 'Total velocity', 'Mass', 'Thrust', 'Drag coefficient', 'Mach number', 'Reference area', 'Gravitational acceleration', 'Air temperature', 'Air pressure', 'Air density', 'Speed of sound'];
function savedFlight(figures) {
  const f = (x) => (figures ? Number(x.toPrecision(figures)) : x);
  const rows = truth.history.map((p) => {
    const M = p.v / sound(p.h), F = thrustAt(p.t), a = isa(p.h);
    return [p.t, p.h, p.v * Math.sin(p.gamma * Math.PI / 180), p.v, p.m, F, cdAt(M, p.t, F > 0), M, AREA, G * (EARTH.R / (EARTH.R + p.h)) ** 2, a.T, a.P, a.rho, sound(p.h)].map(f);
  });
  // A sample just past apogee, so the top sits between two.
  const ev = [['launch', 0, 'rkt'], ['ignition', 0, 'mmB'], ['burnout', sep, 'mmB'], ['stageseparation', sep, 'stB'], ['ignition', sep + 0.4, 'mmS'], ['burnout', sep + 2.0, 'mmS'], ['apogee', truthApogee.t, 'rkt']];
  return `<databranch name="Sustainer" types="${TYPES.join(',')}">
${ev.map(([type, time, src]) => `          <event time="${time}" type="${type}" source="${src}"/>`).join('\n')}
${rows.map((r) => `          <datapoint>${r.join(',')}</datapoint>`).join('\n')}
        </databranch>`;
}
const orkFile = (branch) => `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.10" creator="OpenRocket 24.12">
  <!-- written by ork.test.mjs -->
  <rocket>
    <name>Test rocket &amp; friends</name>
    <id>rkt</id>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <id>stS</id>
        <subcomponents><bodytube><name>Sustainer tube</name><id>btS</id><subcomponents><innertube><name>Sustainer mount</name><id>mmS</id>
          <motormount><motor configid="cfg1"><type>reload</type><manufacturer>Test</manufacturer><designation>J350</designation><delay>0.0</delay></motor></motormount>
        </innertube></subcomponents></bodytube></subcomponents>
      </stage>
      <stage>
        <name>Booster</name>
        <id>stB</id>
        <subcomponents><bodytube><name>Booster tube</name><id>btB</id><subcomponents><innertube><name>Booster mount</name><id>mmB</id>
          <motormount><motor configid="cfg1"><type>reload</type><manufacturer>Test</manufacturer><designation>K550</designation><delay>0.0</delay></motor></motormount>
        </innertube></subcomponents></bodytube></subcomponents>
      </stage>
    </subcomponents>
  </rocket>
  <simulations>
    <simulation status="uptodate">
      <name>Calm day</name>
      <conditions>
        <configid>cfg1</configid>
        <launchrodlength>2.0</launchrodlength>
        <launchrodangle>0.0</launchrodangle>
        <windaverage>0.0</windaverage>
        <launchaltitude>0.0</launchaltitude>
        <launchlatitude>-27.5</launchlatitude>
        <launchlongitude>153.0</launchlongitude>
        <atmosphere model="isa"/>
      </conditions>
      <flightdata maxaltitude="${truthApogee.h}" maxvelocity="${Math.max(...truth.history.map((p) => p.v))}" timetoapogee="${truthApogee.t}">
        <warning type="Other"><description>A note with a &gt; sign and an attribute-free tag</description></warning>
        ${branch}
      </flightdata>
    </simulation>
    <simulation status="outdated">
      <name>Not run</name>
      <conditions><configid>cfg1</configid><launchrodlength>2.0</launchrodlength></conditions>
    </simulation>
  </simulations>
</openrocket>
`;

header('CASE 1: the file, zipped, gzipped and plain');
{
  const xml = orkFile(savedFlight(0));
  const ways = { zip: zipOne('rocket.ork', Buffer.from(xml)), gzip: zlib.gzipSync(Buffer.from(xml)), plain: Buffer.from(xml) };
  const read = {};
  for (const [k, bytes] of Object.entries(ways)) read[k] = readOrk(await orkXml(bytes));
  const d = read.zip;
  console.log(`  ${d.name}: stages ${d.stages.map((s) => s.name).join(', ')}; motors ${d.motors.map((m) => `${m.designation} in ${m.mount} (${m.stage})`).join(', ')}; simulations ${d.simulations.map((s) => `${s.name} (${s.status}, ${s.branches.length} branches)`).join(', ')}`);
  check('the zipped, gzipped and plain files read the same', JSON.stringify(read.zip, (k, v) => (v instanceof Float64Array ? [...v] : v)) === JSON.stringify(read.gzip, (k, v) => (v instanceof Float64Array ? [...v] : v)) && JSON.stringify(read.zip, (k, v) => (v instanceof Float64Array ? [...v] : v)) === JSON.stringify(read.plain, (k, v) => (v instanceof Float64Array ? [...v] : v)));
  check('the name with its entity decoded, the stages top first, the motors with their stages', d.name === 'Test rocket & friends' && d.stages.map((s) => s.name).join() === 'Sustainer,Booster' && d.motors.map((m) => `${m.designation}/${m.stage}`).join() === 'J350/Sustainer,K550/Booster');
  const s = d.simulations[0], b = s.branches[0];
  check('the conditions, the summary, the columns and the events (their sources named)', s.conditions.rodLength === 2 && s.conditions.latitude === -27.5 && s.conditions.atmosphere.model === 'isa'
    && Math.abs(s.summary.maxAltitude - truthApogee.h) < 1e-9 && b.columns['Mass'].length === truth.history.length && b.events.find((e) => e.type === 'stageseparation').source === 'Booster');
  check('a simulation with no saved flight reads as one', d.simulations[1].branches.length === 0 && d.simulations[1].status === 'outdated');
  let threw = '';
  try { vehicleFromOrk(d.simulations[1]); } catch (e) { threw = e.message; }
  check('and flying it says to run and save it in OpenRocket', /no saved flight/.test(threw));
  let bad = '';
  try { parseXml('<a><b></a>'); } catch (e) { bad = e.message; }
  check('mismatched XML is refused', /closes/.test(bad));
  const quoted = parseXml(`<x a="1 > 0" b='it&apos;s'><![CDATA[<raw>]]></x>`);
  check("a '>' inside an attribute, single quotes, entities and CDATA", quoted.attrs.a === '1 > 0' && quoted.attrs.b === "it's" && quoted.text === '<raw>');
}

header('CASE 2: a saved flight comes back as the vehicle that flew it');
for (const figures of [0, 4]) {
  const d = readOrk(await orkXml(zipOne('rocket.ork', Buffer.from(orkFile(savedFlight(figures))))));
  const v = vehicleFromOrk(d.simulations[0], d.motors);
  const label = figures ? `saved to ${figures} figures, as OpenRocket saves` : 'at full precision';
  const [b, s] = v.stages;
  console.log(`  ${label}: ${v.stages.map((x) => `${x.name} burns ${(x.prop * 1000).toFixed(1)} g, drops ${(x.dry * 1000).toFixed(1)} g, ${x.impulse.toFixed(2)} N s`).join('; ')}; payload ${(v.payload * 1000).toFixed(1)} g`);
  const impulse = (c) => c.reduce((a, p, i) => (i ? a + 0.5 * (p[1] + c[i - 1][1]) * (p[0] - c[i - 1][0]) : 0), 0);
  const tol = figures ? 2e-3 : 2e-4;
  check(`${label}: the stages named for their motors, propellant and dropped masses within ${tol * 100} %`, b.name === 'Booster (K550)' && s.name === 'Sustainer (J350)'
    && rel(b.prop, STAGES[0].prop) < tol && rel(b.dry, STAGES[0].dry) < tol && rel(s.prop, STAGES[1].prop) < tol && rel(v.payload, PAYLOAD) < tol);
  check(`${label}: each stage's impulse within 1 % of its motor's (straight lines through 0.01 s samples)`, rel(b.impulse, impulse(STAGES[0].thrustCurve)) < 0.01 && rel(s.impulse, impulse(STAGES[1].thrustCurve)) < 0.01);
  for (const drag of ['mach', 'replay']) {
    const r = flyOrk(v, { drag });
    console.log(`    flown, ${drag === 'mach' ? 'drag against Mach' : 'drag replayed'}: ${r.apogee.toFixed(2)} m at ${r.timeToApogee.toFixed(3)} s (the flight saved: ${truthApogee.h.toFixed(2)} m at ${truthApogee.t.toFixed(3)} s)`);
    check(`${label}, ${drag === 'mach' ? 'drag against Mach' : 'drag replayed'}: apogee and the time to it within ${figures ? '0.3' : '0.1'} %`, rel(r.apogee, truthApogee.h) < (figures ? 3e-3 : 1e-3) && rel(r.timeToApogee, truthApogee.t) < (figures ? 3e-3 : 1e-3));
  }
}

header('CASE 2b: a flight saved without air density (OpenRocket before 24.12), and a rounded reference area');
{
  const xml = orkFile(savedFlight(4)).replace(',Air density,Speed of sound', ',Speed of sound').replace(/<datapoint>([^<]*)<\/datapoint>/g, (all, row) => {
    const v = row.split(','); v.splice(TYPES.indexOf('Air density'), 1); return `<datapoint>${v.join(',')}</datapoint>`;
  });
  const d = readOrk(await orkXml(Buffer.from(xml)));
  const v = vehicleFromOrk(d.simulations[0], d.motors), r = flyOrk(v);
  console.log(`  no density column: ${v.air.length} rows of air from pressure and temperature; apogee ${r.apogee.toFixed(2)} m (the flight saved: ${truthApogee.h.toFixed(2)} m)`);
  check('the air comes from pressure and temperature, and the apogee within 0.3 %', v.air.length > 100 && rel(r.apogee, truthApogee.h) < 3e-3);
  // The reference area saved to three decimals, as OpenRocket saves it:
  // recovered from the drag force within that rounding.
  const D = ['Drag force'];
  const xml2 = orkFile(savedFlight(4)).replace(`types="${TYPES.join(',')}"`, `types="${[...TYPES, ...D].join(',')}"`).replace(/<datapoint>([^<]*)<\/datapoint>/g, (all, row) => {
    const v = row.split(',').map(Number), M = v[TYPES.indexOf('Mach number')], a = v[TYPES.indexOf('Speed of sound')], rho = v[TYPES.indexOf('Air density')], cd = v[TYPES.indexOf('Drag coefficient')];
    v[TYPES.indexOf('Reference area')] = 0.008;
    return `<datapoint>${[...v, 0.5 * rho * (M * a) ** 2 * cd * AREA].join(',')}</datapoint>`;
  });
  const v2 = vehicleFromOrk(readOrk(await orkXml(Buffer.from(xml2))).simulations[0]);
  console.log(`  reference area saved as 0.008 m^2 (true ${AREA}): recovered ${v2.refArea.toFixed(6)} m^2`);
  check('a reference area saved to three decimals is recovered from the drag force to 0.1 %', rel(v2.refArea, AREA) < 1e-3);
}

header("CASE 3: OpenRocket's own examples, against OpenRocket");
{
  const dir = `${process.env.HOME}/.cache/digital-orrery/openrocket/designs`;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.ork')) : [];
  if (!files.length) console.log("  SKIP: OpenRocket's example designs are not on this machine (npm run oracle:openrocket unpacks them from a local OpenRocket jar)");
  let worst = 0, n = 0;
  for (const f of files) {
    const d = readOrk(await orkXml(fs.readFileSync(`${dir}/${f}`)));
    for (const sim of d.simulations.filter((s) => s.branches[0]?.length > 2)) {
      const v = vehicleFromOrk(sim, d.motors);
      const r = flyOrk(v);
      const e = r.apogee / v.openrocket.apogee - 1;
      worst = Math.max(worst, Math.abs(e)); n++;
      console.log(`  ${d.name}, ${sim.name}: ${v.stages.map((s) => s.name).join(' + ')}, ${v.conditions.windAverage} m/s wind; ours ${r.apogee.toFixed(1)} m, OpenRocket ${v.openrocket.apogee.toFixed(1)} m (${(e * 100).toFixed(2)} %)${v.deployedAt !== null ? `; its parachute opened at ${v.deployedAt.toFixed(2)} s, before apogee` : ''}`);
    }
  }
  if (n) check(`all ${n} saved simulations within 1 % of OpenRocket's apogee (a point mass whose axis follows the wind with a 0.1 s lag)`, worst < 0.01);
}

console.log('='.repeat(72));
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
