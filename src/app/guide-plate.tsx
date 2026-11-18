// src/app/guide-plate.tsx
//
// Plates for what the scene draws as guides rather than objects: a guide's
// tag (a spin axis's pole, a sphere of influence or Hill sphere, a
// Lagrange point, a pull, a magnetopause or auroral oval: guides.ts and
// magnetic.ts) and an orbit line. Chosen by clicking the tag or the line
// (OrreryScene.onGuidePick, onOrbitPick); each value is worked out afresh
// as the clock runs, with its source tag, as on the bodies' plate.

import { useClock, type SimClock } from './clock';
import { Readout, fmtGroup, type Row } from './panels';
import { bodyState } from '../scene/OrreryScene';
import { BODIES, BODY_BY_KEY, type BodyKey, type FocusKey } from '../scene/catalogue';
import { bodyAxesEqj } from '../physics/orientation.js';
import { eclToEqj } from '../physics/ephemeris.js';
import { spinRate } from '../physics/spin.js';
import { soiRadius, hillRadius, lagrangePoints } from '../physics/gravityGuides.js';
import { rvToElements } from '../physics/orbital.js';

type V3 = [number, number, number];
const DEG = 180 / Math.PI;
const AU_KM = 149597870.7;

// A guide tag as clicked: its classes, text and title, and the body in view.
export interface GuidePick { cls: string; text: string; title: string; focus: FocusKey }

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const crossV = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a: readonly number[], b: readonly number[]) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b))))) * DEG;
// A body named at the start of a tag's text or title ("Earth L1", "Sun 5.9 mm/s²", "Mars's north pole").
const named = (s: string): BodyKey | null => BODIES.filter((b) => s.startsWith(`${b.name} `) || s.startsWith(`${b.name}'s`) || s.startsWith(`${b.name}–`))
  .sort((a, b) => b.name.length - a.name.length)[0]?.key ?? null;
const km = (x: number) => (x >= 1e7 ? `${(x / AU_KM).toFixed(4)}` : fmtGroup(x, 0));
const kmUnit = (x: number) => (x >= 1e7 ? 'AU' : 'km');
// An acceleration in the unit that reads best.
function accel(kms2: number): { value: string; unit: string } {
  const ms2 = kms2 * 1000;
  return ms2 >= 0.1 ? { value: ms2.toPrecision(4), unit: 'm/s²' } : ms2 >= 1e-4 ? { value: (ms2 * 1000).toPrecision(4), unit: 'mm/s²' } : { value: (ms2 * 1e6).toPrecision(4), unit: 'µm/s²' };
}

// The body's state about its parent (the Sun for a planet), and the
// parent: heliocentric ecliptic km, km/s.
function aboutParent(key: BodyKey, date: Date) {
  const b = BODY_BY_KEY[key], pk = (b.parent ?? 'sun') as BodyKey, p = BODY_BY_KEY[pk];
  const s = bodyState(key, date), ps = bodyState(pk, date);
  return { b, p, pk, r: sub(s.r, ps.r), v: sub(s.v, ps.v), s, ps };
}

function Head({ title, kind, rows, notes }: { title: string; kind: string; rows: Row[]; notes: string[] }) {
  return (
    <div className="tab-body">
      <div className="plate-head">
        <h2>{title}</h2>
        <p className="engraved">{kind}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <div className="plate-notes">{notes.map((n) => <p key={n}>{n}</p>)}</div>
    </div>
  );
}

export function GuidePlate({ clock, pick }: { clock: SimClock; pick: GuidePick }) {
  const t = useClock(clock);
  const date = new Date(t.timeMs);
  const cls = pick.cls.split(/\s+/);
  const leave = 'Choose a body in the rail, or another tag, to leave it.';
  if (cls.includes('axis-n')) {
    const key = named(pick.title) ?? named(pick.text);
    if (!key) return <Unknown pick={pick} />;
    const b = BODY_BY_KEY[key], rate = spinRate(key) as { w1: number; periodDays: number; source: string } | null;
    const Z = bodyAxesEqj(key, date)[2] as V3;
    const ra = ((Math.atan2(Z[1], Z[0]) * DEG) + 360) % 360, dec = Math.asin(Z[2]) * DEG;
    const rows: Row[] = [
      { label: 'Pole', value: `${ra.toFixed(3)}°, ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(3)}°`, alt: 'right ascension, declination (J2000)', src: rate ? 'IAU' : 'orbit', info: 'guide-axis' },
    ];
    if (rate) rows.push({ label: 'Turns', value: rate.periodDays < 2 ? (rate.periodDays * 24).toFixed(4) : fmtGroup(rate.periodDays, 3), unit: rate.periodDays < 2 ? 'h' : 'd', alt: `${rate.w1 < 0 ? 'retrograde, ' : ''}W1 ${rate.w1 > 0 ? '+' : '−'}${Math.abs(rate.w1).toPrecision(7)}°/day`, src: 'IAU', info: 'guide-axis', detail: rate.source });
    if (key !== 'sun') {
      const o = aboutParent(key, date);
      const tilt = angle(eclToEqj(crossV(o.r, o.v)), Z);
      rows.push({ label: 'Tilt', value: tilt.toFixed(2), unit: '°', alt: `to its orbit about ${o.p.name}`, src: 'DE442', derived: true, info: 'guide-axis' });
    } else {
      rows.push({ label: 'Tilt', value: angle(eclToEqj([0, 0, 1]), Z).toFixed(2), unit: '°', alt: 'to the ecliptic', src: 'IAU', derived: true, info: 'guide-axis' });
    }
    return <Head title={`${b.name}'s spin axis`} kind={`Guide · spin axis${pick.cls.includes('retro') ? ' · retrograde' : ''}`} rows={rows}
      notes={[pick.title + '.', 'The line runs through the poles along the IAU rotation model (a moon with none turns with its orbit); the arrow shows which way it turns. ' + leave]} />;
  }
  if (cls.includes('soi') || cls.includes('hill')) {
    const key = pick.focus as BodyKey;
    if (!BODY_BY_KEY[key]?.gm || key === 'sun') return <Unknown pick={pick} />;
    const o = aboutParent(key, date);
    const el = rvToElements(o.r, o.v, (o.p.gm ?? 0) + (o.b.gm ?? 0));
    const soi = cls.includes('soi');
    const R = soi ? soiRadius(el.a, o.b.gm!, o.p.gm!) : hillRadius(el.a, el.e, o.b.gm!, o.p.gm!);
    const rows: Row[] = [
      { label: 'Radius', value: km(R), unit: kmUnit(R), alt: `${fmtGroup(R / o.b.radiusKm, 1)} of its radii`, src: 'DE442', derived: true, info: soi ? 'guide-soi' : 'guide-hill' },
      { label: 'About', value: o.p.name, alt: `GM ratio ${(o.b.gm! / o.p.gm!).toExponential(4)}`, src: 'DE442', info: soi ? 'guide-soi' : 'guide-hill' },
      { label: 'Orbit', value: km(el.a), unit: kmUnit(el.a), alt: `semi-major axis; e ${el.e.toFixed(5)}`, src: 'DE442', derived: true, info: 'orbit-osculating' },
    ];
    return <Head title={`${o.b.name}'s ${soi ? 'sphere of influence' : 'Hill sphere'}`} kind={`Guide · ${soi ? 'sphere of influence' : 'Hill sphere'}`} rows={rows}
      notes={[soi ? 'Inside it, the body\'s pull is the one to reckon a craft\'s path about, with its parent\'s as the disturbance: where patched conics switch from one to the other.'
        : 'Inside it, the body can hold a satellite against its parent\'s tide; to first order, the distance to its L1 and L2. Taken at its closest to its parent.', leave]} />;
  }
  if (cls.includes('lpoint')) {
    const sk = named(pick.text), pk = named(pick.title);
    const name = /L[1-5]/.exec(pick.text)?.[0] as 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | undefined;
    if (!sk || !pk || !name) return <Unknown pick={pick} />;
    const P = bodyState(pk, date), S = bodyState(sk, date), gp = BODY_BY_KEY[pk].gm!, gs = BODY_BY_KEY[sk].gm!;
    const L = lagrangePoints(P.r, S.r, sub(S.v, P.v), gp, gs);
    const at = L[name] as V3, dS = len(sub(at, S.r)), dP = len(sub(at, P.r));
    const stable = (name === 'L4' || name === 'L5') && L.mu < 0.0385;
    const rows: Row[] = [
      { label: `From ${BODY_BY_KEY[sk].name}`, value: km(dS), unit: kmUnit(dS), src: 'DE442', derived: true, info: 'guide-lagrange' },
      { label: `From ${BODY_BY_KEY[pk].name}`, value: km(dP), unit: kmUnit(dP), alt: `the pair ${km(L.separation)} ${kmUnit(L.separation)} apart now`, src: 'DE442', derived: true, info: 'guide-lagrange' },
      { label: 'Mass ratio', value: L.mu.toExponential(4), alt: 'μ = m₂ / (m₁ + m₂)', src: 'DE442', info: 'guide-lagrange' },
      { label: 'Stability', value: stable ? 'stable' : 'unstable', alt: stable ? 'μ under 0.0385: things gather there' : name === 'L4' || name === 'L5' ? 'μ too large' : 'a craft there must keep station', src: 'CR3BP', derived: true, info: 'guide-lagrange' },
    ];
    return <Head title={`${BODY_BY_KEY[pk].name}–${BODY_BY_KEY[sk].name} ${name}`} kind="Guide · Lagrange point" rows={rows}
      notes={[`Where a small body keeps its place with the two, in the circular restricted three-body problem, placed on their line and plane now. ${leave}`]} />;
  }
  if (cls.includes('pull')) {
    const from = named(pick.text), on = pick.focus as BodyKey;
    if (!from || !BODY_BY_KEY[on]) return <Unknown pick={pick} />;
    const d = len(sub(bodyState(from, date).r, bodyState(on, date).r)), a = BODY_BY_KEY[from].gm! / (d * d), g = accel(a);
    const sunA = on === 'sun' ? null : BODY_BY_KEY.sun.gm! / len(bodyState(on, date).r) ** 2;
    const rows: Row[] = [
      { label: 'Pull', value: g.value, unit: g.unit, alt: 'GM / d²', src: 'DE442', derived: true, info: 'guide-pull' },
      { label: 'Distance', value: km(d), unit: kmUnit(d), src: 'DE442', info: 'guide-pull' },
      ...(sunA && from !== 'sun' ? [{ label: 'Against the Sun', value: (a / sunA).toExponential(3), alt: 'of the Sun\'s pull on it', src: 'DE442', derived: true, info: 'guide-pull' } as Row] : []),
    ];
    return <Head title={`${BODY_BY_KEY[from].name}'s pull on ${BODY_BY_KEY[on].name}`} kind="Guide · pull" rows={rows}
      notes={[`The strongest pulls on the body in view, each a point mass's GM / d². What moves it about its parent is the difference between the pulls on it and on the parent: the tide. ${leave}`]} />;
  }
  return <Unknown pick={pick} />;
}

// A tag the plate has no model for (the magnetic fields' tags): what it
// says, as its title gives it.
function Unknown({ pick }: { pick: GuidePick }) {
  const field = pick.cls.includes('mag-');
  const rows: Row[] = [{ label: 'Tag', value: pick.text, src: field ? 'model' : 'guide', info: field ? 'guide-field' : 'guide-axis' }];
  return <Head title={pick.text} kind={field ? 'Guide · magnetic field' : 'Guide'} rows={rows}
    notes={[pick.title, 'Choose a body in the rail, or another tag, to leave it.']} />;
}

// The plate for an orbit line: the body's osculating orbit about its
// parent now, from the ephemeris state.
export function OrbitPlate({ clock, body }: { clock: SimClock; body: BodyKey }) {
  const t = useClock(clock);
  const date = new Date(t.timeMs);
  const o = aboutParent(body, date);
  const mu = (o.p.gm ?? 0) + (o.b.gm ?? 0);
  const el = rvToElements(o.r, o.v, mu);
  const peri = el.a * (1 - el.e), apo = el.a * (1 + el.e);
  const periodS = 2 * Math.PI * Math.sqrt(el.a ** 3 / mu), days = periodS / 86400;
  const sunParent = o.pk === 'sun';
  const [pName, aName] = sunParent ? ['Perihelion', 'Aphelion'] : ['Periapsis', 'Apoapsis'];
  const r = len(o.r);
  // A planet's or the Moon's state is DE442's; the other moons' are JPL's own satellite ephemerides.
  const eph = sunParent || body === 'moon' ? 'DE442' : 'JPL';
  const rows: Row[] = [
    { label: 'About', value: o.p.name, alt: sunParent ? 'heliocentric' : `its parent`, src: eph, info: 'orbit-osculating' },
    { label: 'Semi-major axis', value: km(el.a), unit: kmUnit(el.a), src: eph, derived: true, info: 'orbit-osculating' },
    { label: 'Eccentricity', value: el.e.toFixed(6), src: eph, derived: true, info: 'orbit-osculating' },
    { label: pName, value: km(peri), unit: kmUnit(peri), alt: `${aName.toLowerCase()} ${km(apo)} ${kmUnit(apo)}`, src: eph, derived: true, info: 'orbit-osculating' },
    { label: 'Inclination', value: (el.i * DEG).toFixed(4), unit: '°', alt: 'to the ecliptic of J2000', src: eph, derived: true, info: 'orbit-osculating' },
    { label: 'Period', value: days < 2 ? (days * 24).toFixed(3) : fmtGroup(days, 2), unit: days < 2 ? 'h' : 'd', alt: days > 700 ? `${(days / 365.25).toFixed(2)} years` : 'of this ellipse', src: eph, derived: true, info: 'orbit-osculating' },
    { label: 'Now', value: km(r), unit: kmUnit(r), alt: `from ${o.p.name}; ${len(o.v).toFixed(3)} km/s`, src: eph, info: 'orbit-osculating' },
  ];
  return <Head title={`${o.b.name}'s orbit`} kind={`Orbit line · ${sunParent ? 'about the Sun' : `about ${o.p.name}`}`} rows={rows}
    notes={['The ellipse its position and velocity would follow about its parent alone now (osculating elements); the line is drawn from the ephemeris itself, so it strays from this ellipse as the others pull.', `Choose ${o.b.name} in the rail to go there, or a body to leave this.`]} />;
}
