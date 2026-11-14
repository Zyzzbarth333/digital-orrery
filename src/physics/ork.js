// src/physics/ork.js
//
// OpenRocket design files (.ork), read in the browser or in Node so the
// ROCKET tab can fly a design with its own physics
// (docs/physics/rocket.md#openrocket-designs-in-the-rocket-tab). Nothing here
// runs or copies OpenRocket: it reads a file format.
//
// An .ork is XML, usually zipped (OpenRocket 15 and later), sometimes
// gzipped or plain. From it, readOrk takes the rocket's name, its stages and
// motors, and each simulation: its launch conditions, its summary and, when
// OpenRocket saved it, the flight itself (each data branch's columns at
// OpenRocket's steps, and its events). vehicleFromOrk turns a saved flight
// into what ascent() (rocket.js) flies: stages with thrust curves, the
// masses as the flight carried them, drag against Mach, the air it flew
// through and its gravity. flyOrk flies it.
//
// An .ork names its motors but does not hold their thrust curves, so the
// thrust comes from OpenRocket's own samples of the flight, joined by
// straight lines.

import { ascent } from './rocket.js';
import { standardAtmosphere } from './atmosphere.js';

// ------------------------------------------------------------- the file

// The XML text of an .ork file's bytes (ArrayBuffer or Uint8Array): a zip
// (the .ork entry inside), gzip, or plain XML.
export async function orkXml(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x50 && b[1] === 0x4b) return new TextDecoder().decode(await unzipEntry(b, (name) => name.toLowerCase().endsWith('.ork')));
  if (b[0] === 0x1f && b[1] === 0x8b) return new TextDecoder().decode(await inflate(b, 'gzip'));
  return new TextDecoder().decode(b);
}

async function inflate(data, format) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// One entry of a zip archive: found through the central directory, whose
// sizes hold even when the local header defers them to a data descriptor
// (as OpenRocket's do). Stored or deflated.
async function unzipEntry(b, want) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const names = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip central directory is damaged');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    names.push(name);
    if (want(name)) {
      if (dv.getUint32(local, true) !== 0x04034b50) throw new Error(`zip entry ${name}: no local header`);
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = b.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data, 'deflate-raw');
      throw new Error(`zip entry ${name}: compression method ${method} is not supported`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`no .ork entry in the zip (it holds ${names.join(', ') || 'nothing'})`);
}

// A small XML parser, enough for OpenRocket's files: elements, attributes,
// text, entities, comments, CDATA, processing instructions. Returns the
// document's root element as { name, attrs, children, text }.
export function parseXml(xml) {
  const doc = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [doc];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) { top.text += decode(xml.slice(i)); break; }
    if (lt > i) top.text += decode(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) { i = end(xml.indexOf('-->', lt + 4), 'comment') + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = end(xml.indexOf(']]>', lt + 9), 'CDATA'); top.text += xml.slice(lt + 9, e); i = e + 3; continue; }
    if (xml[lt + 1] === '?') { i = end(xml.indexOf('?>', lt + 2), 'processing instruction') + 2; continue; }
    if (xml[lt + 1] === '!') { i = end(xml.indexOf('>', lt + 2), 'declaration') + 1; continue; }
    // The tag's end: the first '>' outside quotes.
    let j = lt + 1, q = '';
    for (; j < n; j++) {
      const c = xml[j];
      if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    if (j >= n) throw new Error('unclosed tag at the end of the XML');
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      const el = stack.pop();
      if (!el || el.name !== name) throw new Error(`XML: </${name}> closes <${el?.name}>`);
      el.text = el.text.trim();
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const m = /^([^\s/]+)/.exec(inner);
    if (!m) throw new Error(`XML: bad tag <${body.slice(0, 40)}>`);
    const el = { name: m[1], attrs: {}, children: [], text: '' };
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    const rest = inner.slice(m[1].length);
    let a;
    while ((a = re.exec(rest))) el.attrs[a[1]] = decode(a[3] ?? a[4]);
    top.children.push(el);
    if (!selfClosing) stack.push(el);
  }
  if (stack.length > 1) throw new Error(`XML: <${stack[stack.length - 1].name}> is never closed`);
  const root = doc.children[0];
  if (!root) throw new Error('XML: no root element');
  return root;
}
function end(k, what) { if (k < 0) throw new Error(`XML: unclosed ${what}`); return k; }
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (all, e) => (e[0] === '#'
    ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : ENTITIES[e] ?? all));
}
const child = (el, name) => el?.children.find((c) => c.name === name) ?? null;
const kids = (el, name) => el?.children.filter((c) => c.name === name) ?? [];
const num = (el, name) => { const t = child(el, name)?.text; const x = t === undefined || t === '' ? NaN : Number(t); return Number.isFinite(x) ? x : null; };
function walk(el, f, parents = []) { f(el, parents); for (const c of el.children) walk(c, f, [...parents, el]); }

// ------------------------------------------------------------- the design

// Everything the ROCKET tab uses from an .ork's XML text.
export function readOrk(xml) {
  const root = parseXml(xml);
  if (root.name !== 'openrocket') throw new Error(`not an OpenRocket file (its root is <${root.name}>)`);
  const rocket = child(root, 'rocket');
  // Components by id (events name their source by it), the stages top
  // first, and the motors in each mount.
  const names = new Map(), stages = [], motors = [];
  if (rocket) {
    walk(rocket, (el, parents) => {
      const id = child(el, 'id')?.text, name = child(el, 'name')?.text;
      if (id && name !== undefined) names.set(id, name);
      // The rocket's stages: its own subcomponents, top first.
      if (el.name === 'stage' && parents.at(-1)?.name === 'subcomponents' && parents.at(-2) === rocket) stages.push({ name: name ?? `Stage ${stages.length + 1}`, id: id ?? null });
      if (el.name === 'motor' && parents.at(-1)?.name === 'motormount') {
        const mount = parents.at(-2), stage = [...parents].reverse().find((p) => p.name === 'stage');
        motors.push({
          config: el.attrs.configid ?? null, mount: child(mount, 'name')?.text ?? '', mountId: child(mount, 'id')?.text ?? null,
          stage: child(stage, 'name')?.text ?? '', manufacturer: child(el, 'manufacturer')?.text ?? '', designation: child(el, 'designation')?.text ?? '',
          delay: num(el, 'delay'),
        });
      }
    });
  }
  const sims = kids(child(root, 'simulations'), 'simulation').map((s, index) => {
    const c = child(s, 'conditions'), atm = child(c, 'atmosphere'), fd = child(s, 'flightdata');
    const fa = fd?.attrs ?? {}, f = (k) => (fa[k] === undefined || fa[k] === 'NaN' ? null : Number(fa[k]));
    return {
      index, name: child(s, 'name')?.text || `Simulation ${index + 1}`, status: s.attrs.status ?? '',
      config: child(c, 'configid')?.text ?? null,
      conditions: {
        rodLength: num(c, 'launchrodlength'), rodAngle: num(c, 'launchrodangle'), rodDirection: num(c, 'launchroddirection'),
        windAverage: num(c, 'windaverage'), windTurbulence: num(c, 'windturbulence'),
        altitude: num(c, 'launchaltitude'), latitude: num(c, 'launchlatitude'), longitude: num(c, 'launchlongitude'),
        atmosphere: atm ? { model: atm.attrs.model ?? '', baseTemperature: num(atm, 'basetemperature'), basePressure: num(atm, 'basepressure') } : null,
        timeStep: num(c, 'timestep'),
      },
      summary: fd ? {
        maxAltitude: f('maxaltitude'), maxVelocity: f('maxvelocity'), maxAcceleration: f('maxacceleration'), maxMach: f('maxmach'),
        timeToApogee: f('timetoapogee'), flightTime: f('flighttime'), groundHitVelocity: f('groundhitvelocity'), launchRodVelocity: f('launchrodvelocity'),
      } : null,
      branches: kids(fd, 'databranch').map((br) => {
        const types = (br.attrs.types ?? '').split(',');
        // A row with the wrong count of values is skipped, as OpenRocket's
        // own loader does.
        const rows = kids(br, 'datapoint').map((dp) => dp.text.split(',').map(Number)).filter((r) => r.length === types.length);
        const columns = {};
        types.forEach((t, k) => { columns[t] = Float64Array.from(rows, (r) => r[k]); });
        return {
          name: br.attrs.name ?? '', types, columns, length: rows.length,
          events: kids(br, 'event').map((e) => ({ time: Number(e.attrs.time), type: e.attrs.type ?? '', source: names.get(e.attrs.source) ?? e.attrs.source ?? '' })),
        };
      }),
    };
  });
  return {
    name: child(rocket, 'name')?.text || 'OpenRocket design', creator: root.attrs.creator ?? '', version: root.attrs.version ?? '',
    stages, motors, simulations: sims,
  };
}

// ------------------------------------------------------------- the flight

// OpenRocket's names for the columns used here (its English names, as it
// writes them in "types").
const COL = {
  t: 'Time', h: 'Altitude', vz: 'Vertical velocity', v: 'Total velocity', m: 'Mass', F: 'Thrust', cd: 'Drag coefficient',
  mach: 'Mach number', area: 'Reference area', g: 'Gravitational acceleration', rho: 'Air density', a: 'Speed of sound', p: 'Air pressure',
  T: 'Air temperature', D: 'Drag force', L: 'Reference length',
};
const round = (x, k) => Number(x.toFixed(k));

// A saved flight as ascent() flies it. sim: one of readOrk's simulations;
// motors: readOrk's motors (to name the stages). Throws when the flight was
// not saved, or lacks a column it needs.
export function vehicleFromOrk(sim, motors = []) {
  const br = sim.branches[0];
  if (!br || br.length < 3) throw new Error(`${sim.name} has no saved flight: run it in OpenRocket and save the file`);
  // OpenRocket names its columns in its display language; this reads the
  // English names.
  if (!br.columns[COL.t]) throw new Error(`${sim.name}'s saved flight has no "Time" column: OpenRocket may have saved it in another language. Switch OpenRocket to English, run the simulation and save again`);
  for (const k of ['t', 'h', 'vz', 'm', 'F', 'cd', 'mach', 'area']) if (!br.columns[COL[k]]) throw new Error(`${sim.name}'s saved flight has no "${COL[k]}"`);
  const C = (k) => br.columns[COL[k]];
  // The rows in time order, a repeated time (an event's) kept once, the
  // later row.
  const order = [...C('t').keys()].sort((p, q) => C('t')[p] - C('t')[q] || p - q);
  const keep = order.filter((k, j) => j === order.length - 1 || C('t')[order[j + 1]] > C('t')[k]);
  const col = (k) => (br.columns[COL[k]] ? keep.map((j) => br.columns[COL[k]][j]) : null);
  const t = col('t'), h = col('h'), vz = col('vz'), m = col('m'), cd = col('cd'), mach = col('mach'), area = col('area');
  const F = col('F').map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  // The top of the climb: where the climb rate crosses zero, between rows.
  const k = vz.findLastIndex((x, j) => x > 0 && j < vz.length - 1 && vz[j + 1] <= 0) >= 0
    ? vz.findIndex((x, j) => x > 0 && j < vz.length - 1 && vz[j + 1] <= 0 && t[j] > 0.1) : -1;
  if (k < 0) throw new Error(`${sim.name}'s saved flight never reaches its apogee`);
  const apogeeTime = t[k] + vz[k] / (vz[k] - vz[k + 1]) * (t[k + 1] - t[k]);
  const last = k + 1;                       // rows 0..last cover the climb
  const at = (arr, x) => { let j = 1; while (j < last && t[j] < x) j++; const u = (x - t[j - 1]) / (t[j] - t[j - 1] || 1); return arr[j - 1] + (arr[j] - arr[j - 1]) * Math.min(1, Math.max(0, u)); };

  // Separations: the stage-separation events up to apogee, else the
  // samples where the mass falls by over 5 % at once.
  let seps = br.events.filter((e) => e.type === 'stageseparation' && e.time <= apogeeTime).map((e) => ({ time: e.time, source: e.source }));
  if (!seps.length) for (let j = 1; j <= last; j++) if (m[j] < 0.95 * m[j - 1]) seps.push({ time: t[j], source: '' });
  seps = seps.sort((p, q) => p.time - q.time).filter((s, j, a) => j === 0 || s.time - a[j - 1].time > 1e-6);
  // Each separation's drop: the biggest fall in the mass from one row to
  // the next within a few rows of it.
  const drops = seps.map((s) => {
    const j0 = t.findIndex((x) => x >= s.time - 1e-9);
    let best = -1;
    for (let j = Math.max(1, j0 - 3); j <= Math.min(last, j0 + 3); j++) if (best < 0 || m[j - 1] - m[j] > m[best - 1] - m[best]) best = j;
    return { ...s, at: best };
  });
  const stageNames = [...new Set(motors.map((x) => x.stage))];
  const stages = [];
  let start = 0, from = 0;
  for (let i = 0; i <= drops.length; i++) {
    const d = drops[i] ?? null;
    const endT = d ? d.time : apogeeTime, to = d ? d.at - 1 : last;
    // Its thrust: OpenRocket's samples from the last separation to this
    // one, joined by straight lines; ends at zero.
    const curve = [];
    for (let j = 0; j <= last; j++) if (t[j] >= start - 1e-9 && t[j] <= endT + 1e-9) curve.push([round(t[j] - start, 6), round(F[j], 5)]);
    if (!curve.length || curve[0][0] > 0) curve.unshift([0, round(at(F, start), 5)]);
    // The top stage's trailing zeros go (it coasts as the payload); a
    // stage that separates keeps them, so it stays on until it separates.
    if (!d) while (curve.length > 1 && curve.at(-1)[1] === 0 && curve.at(-2)[1] === 0) curve.pop();
    if (curve.at(-1)[1] !== 0 || (d && curve.at(-1)[0] < endT - start - 1e-6)) curve.push([round(Math.max(curve.at(-1)[0] + 1e-3, endT - start), 6), 0]);
    const impulse = curve.reduce((s, p, j) => (j ? s + 0.5 * (p[1] + curve[j - 1][1]) * (p[0] - curve[j - 1][0]) : 0), 0);
    // Its propellant: the mass lost while it was the bottom stage; its dry
    // mass: what dropped away when it separated.
    const prop = m[from] - m[to], dry = d ? m[d.at - 1] - m[d.at] : 0;
    // Its name: OpenRocket's stages are listed top first.
    const sname = d?.source || stageNames[stageNames.length - 1 - i] || `Stage ${i + 1}`;
    const its = motors.filter((x) => x.stage === sname && (!sim.config || !x.config || x.config === sim.config)).map((x) => x.designation).filter(Boolean);
    stages.push({ name: its.length ? `${sname} (${its.join(' + ')})` : sname, thrustCurve: curve, impulse, prop: Math.max(0, prop), dry: Math.max(0, dry), burn: curve.findLast((p) => p[1] > 0)?.[0] ?? 0 });
    if (d) { start = d.time; from = d.at; }
  }
  const payload = at(m, apogeeTime);

  // Drag against Mach while burning and while coasting (OpenRocket's base
  // drag differs with an engine lit), in bins of 0.01, on the liftoff
  // reference area, from the rows before any parachute opens; and against
  // time, to replay, parachutes and all.
  const deployedAt = br.events.find((e) => e.type === 'recoverydevicedeployment' && e.time < apogeeTime)?.time ?? null;
  // What OpenRocket itself flagged in this flight before apogee.
  const flagged = [...new Set(br.events.filter((e) => ['tumble', 'exception'].includes(e.type) && e.time <= apogeeTime).map((e) => e.type))];
  // The reference area: OpenRocket saves it to three decimals (0.019 for
  // 0.0186 m^2, 2 % off), so it is recovered from the drag force,
  // D / (q Cd), over the climb's rows with a firm q, and kept within the
  // saved value's rounding. Where it changes (a stage drops) the saved
  // values' ratio scales it.
  const D = col('D'), rho = col('rho'), snd = col('a'), pr = col('p'), T = col('T');
  const rhoOf = (j) => (rho && Number.isFinite(rho[j]) ? rho[j] : pr && T && pr[j] > 0 && T[j] > 0 ? pr[j] / (287.053 * T[j]) : NaN);
  const aOf = (j) => (snd && Number.isFinite(snd[j]) ? snd[j] : T && T[j] > 0 ? Math.sqrt(1.4 * 287.053 * T[j]) : NaN);
  let area0 = area[0];
  if (D) {
    let num = 0, den = 0;
    const firstDrop = drops.length ? drops[0].at : last + 1;
    for (let j = 0; j < Math.min(last + 1, firstDrop); j++) {
      const rj = rhoOf(j), aj = aOf(j), q = 0.5 * rj * (mach[j] * aj) ** 2;
      if (!(q > 300) || !(cd[j] > 0) || !(D[j] >= 1) || (deployedAt !== null && t[j] >= deployedAt)) continue;
      num += D[j]; den += q * cd[j];
    }
    const saved = String(area[0]), dec = saved.includes('.') && !/e/i.test(saved) ? saved.split('.')[1].length : 12;
    const half = 0.5 * 10 ** -dec;
    if (den > 0) area0 = Math.min(area[0] + half, Math.max(area[0] - half, num / den));
  }
  const cdRef = cd.map((c, j) => c * area[j] / area[0]);
  const table = (burning, from = -Infinity, until = Infinity) => {
    const bins = new Map();
    for (let j = 0; j <= last; j++) {
      if (deployedAt !== null && t[j] >= deployedAt) break;
      if (t[j] < from || t[j] >= until) continue;
      if (!(mach[j] > 0.02) || !Number.isFinite(cdRef[j]) || (F[j] > 0) !== burning) continue;
      const key = Math.round(mach[j] * 100), v = bins.get(key) ?? [0, 0, 0];
      bins.set(key, [v[0] + mach[j], v[1] + cdRef[j], v[2] + 1]);
    }
    return [...bins.entries()].sort((p, q) => p[0] - q[0]).map(([, [sM, sc, n]]) => [round(sM / n, 4), round(sc / n, 5)]);
  };
  const replay = [];
  for (let j = 0; j <= last; j++) if (Number.isFinite(cdRef[j])) replay.push([t[j], cdRef[j]]);
  // The air it flew through, against height above the pad, while climbing.
  const air = [];
  // Files from before OpenRocket 24.12 save no density: it comes from the
  // pressure and temperature (p / R T, within 0.13 % of 24.12's own).
  for (let j = 0; j <= last; j++) {
    const r = rhoOf(j);
    if (Number.isFinite(r) && (!air.length || h[j] > air.at(-1).h)) air.push({ h: h[j], rho: r, a: aOf(j), p: pr?.[j] ?? NaN });
  }
  const g = col('g')?.[0];
  const v = col('v');
  return {
    name: sim.name, stages, payload, liftoff: m[0], refArea: area0, diameter: 2 * Math.sqrt(area0 / Math.PI), flagged,
    gravity: Number.isFinite(g) ? g : 9.80665, air,
    // The whole flight's tables, and each stage's (a stack drags
    // differently from its upper stage alone), until its separation.
    drag: {
      powerOn: table(true), powerOff: table(false), replay,
      stages: drops.map((d) => d.time).concat(Infinity).map((until, i, a) => ({ until, powerOn: table(true, i ? a[i - 1] : -Infinity, until), powerOff: table(false, i ? a[i - 1] : -Infinity, until) })),
    },
    conditions: sim.conditions, deployedAt,
    openrocket: {
      apogee: sim.summary?.maxAltitude ?? Math.max(...h.slice(0, last + 1)), apogeeTime,
      timeToApogee: sim.summary?.timeToApogee ?? apogeeTime,
      maxSpeed: sim.summary?.maxVelocity ?? (v ? Math.max(...v.slice(0, last + 1)) : null), maxMach: sim.summary?.maxMach ?? Math.max(...mach.slice(0, last + 1).filter(Number.isFinite)),
      history: t.slice(0, last + 1).map((x, j) => [x, h[j]]),
    },
  };
}

// Piecewise linear through [x, y] points, held beyond the ends.
function lerp(pts) {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts.at(-1)[0]) return pts.at(-1)[1];
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= x) lo = mid; else hi = mid; }
    const [x0, y0] = pts[lo], [x1, y1] = pts[hi];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0 || 1);
  };
}

// A stable rocket's axis follows its velocity through the air with a lag:
// 0.1 s, as the airbrakes project's point-mass truth model takes it.
export const TURN_LAG = 0.1;

// Flies a vehicle from vehicleFromOrk with ascent(): from its pad, up its
// launch rod, then along its velocity through the air, into the
// simulation's steady wind (its average; OpenRocket's gusts are left out),
// to apogee, in the air OpenRocket's flight recorded. drag: 'mach' (each
// stage's tables, burning and coasting; OpenRocket's record once a
// parachute opens) or 'replay' (OpenRocket's own drag coefficient against
// time throughout). calm: no wind. Returns
// apogee (m above the pad), the time to it, the top speed and Mach, and the
// height against time.
export function flyOrk(veh, { drag = 'mach', calm = false, dt = 0.002, turnLag = TURN_LAG } = {}) {
  // Each stage's tables, burning and coasting; where a stage has no rows
  // of one kind (a booster that drops at burnout never coasts), its other
  // table, then the whole flight's.
  const pick = (...ts) => lerp(ts.find((x) => x?.length) ?? [[0, 0.5]]);
  const all = veh.drag;
  const byStage = (all.stages ?? [{ until: Infinity, powerOn: all.powerOn, powerOff: all.powerOff }]).map((d) => ({
    until: d.until, on: pick(d.powerOn, d.powerOff, all.powerOn, all.powerOff), off: pick(d.powerOff, d.powerOn, all.powerOff, all.powerOn),
  }));
  const replay = lerp(all.replay.length ? all.replay : [[0, 0.5]]);
  // Once a parachute opens (some flights open one before apogee), the drag
  // is OpenRocket's record either way: the tables are the rocket's alone.
  const opened = veh.deployedAt ?? Infinity;
  const cdAt = drag === 'replay' ? (M, t) => replay(t) : (M, t, burning) => {
    if (t >= opened) return replay(t);
    const d = byStage.find((x) => t < x.until) ?? byStage.at(-1);
    return (burning ? d.on : d.off)(M);
  };
  // The recorded air, by height above the pad; above the top of the
  // record, falling off with an 8 km scale height.
  const air = veh.air;
  const rhoAt = air.length > 1 ? lerp(air.map((x) => [x.h, x.rho])) : null;
  const aAt = air.length > 1 && air.every((x) => Number.isFinite(x.a)) ? lerp(air.map((x) => [x.h, x.a])) : null;
  const pAt = air.length > 1 && air.every((x) => Number.isFinite(x.p)) ? lerp(air.map((x) => [x.h, x.p])) : null;
  const top = air.at(-1);
  // With no air recorded at all, the 1976 standard from the pad's height.
  const pad = Math.max(0, veh.conditions?.altitude ?? 0);
  const atmosphere = rhoAt ? (hh) => {
    const fall = hh > top.h ? Math.exp(-(hh - top.h) / 8000) : 1;
    return { rho: rhoAt(hh) * fall, p: pAt ? pAt(hh) * fall / 101325 : fall };
  } : (hh) => { const s = standardAtmosphere((pad + Math.max(0, hh)) / 1000); return { rho: s.rho, p: s.p / 101325 }; };
  const soundAt = aAt ?? ((hh) => Math.sqrt(1.4 * 287.053 * standardAtmosphere((pad + Math.max(0, hh)) / 1000).T));
  const angle = veh.conditions?.rodAngle ?? 0, rod = veh.conditions?.rodLength ?? 1, wind = calm ? 0 : Math.max(0, veh.conditions?.windAverage ?? 0);
  // Up the rod, then along its velocity through the air (into any wind).
  // A rod tilted from the vertical sets the direction it leaves at (taken
  // to lean into the wind, as OpenRocket launches by default); an upright
  // rod in wind leaves it as it goes.
  const top_ = Math.max(0.1, rod * Math.cos(angle * Math.PI / 180));
  const launch = angle > 0.01 ? { pitchAlt: top_, gamma0: 90 - angle, wind }
    : wind > 0.01 ? { pitchAlt: top_, weathercock: true, wind } : { vertical: true };
  const res = ascent({
    stages: veh.stages.map(({ name, dry, prop, thrustCurve }) => ({ name, dry, prop, thrustCurve })), payload: veh.payload,
    ...launch, turnLag,
    stopAtApogee: true, coast: 1e6, cdAt, area: veh.refArea, atmosphere, sound: soundAt,
    g0: veh.gravity, rotation: 0, dt, sample: 0.01,
  });
  const apo = res.events.find((e) => e.type === 'apogee');
  let maxSpeed = 0, maxMach = 0;
  for (const p of res.history) { maxSpeed = Math.max(maxSpeed, p.v); maxMach = Math.max(maxMach, p.v / soundAt(p.h)); }
  if (!Number.isFinite(res.burnout.h)) throw new Error(`${veh.name} could not be flown: its saved flight gave no usable thrust or mass`);
  return {
    apogee: apo?.h ?? res.burnout.h, timeToApogee: apo?.t ?? res.burnout.t, maxSpeed, maxMach,
    history: res.history.map((p) => [p.t, p.h]), res,
  };
}
