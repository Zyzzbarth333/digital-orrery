// src/app/sunlight.ts
//
// The Sunlight row of a plate: whether the Sun lights an object, from the
// fraction of its disc that the bodies near it leave (discs.js sunlight,
// the umbra's and penumbra's true cones): lit, a partial eclipse with the
// share of the Sun left, or in eclipse in a body's umbra.

import type { Row } from './panels';
import { BODIES, BODY_BY_KEY, maxRadiusKm, type BodyKey } from '../scene/catalogue';
import { bodyState } from '../scene/OrreryScene';
import { sunlight } from '../physics/discs.js';

export interface Sunlight { nu: number; by: string | null; state: 'lit' | 'penumbra' | 'umbra' }

// "the Earth's", "Jupiter's": the Earth, the Moon and the Sun take "the".
const THE = new Set(['earth', 'moon', 'sun']);
const whose = (key: string | null) => (key && key in BODY_BY_KEY ? `${THE.has(key) ? 'the ' : ''}${BODY_BY_KEY[key as BodyKey].name}'s` : 'a body\'s');

export function sunlightRow(s: Sunlight, info: 'sat-shadow' | 'craft-shadow' = 'craft-shadow'): Row {
  if (s.state === 'umbra') return { label: 'Sunlight', value: 'in eclipse', alt: `${whose(s.by)} umbra`, src: 'shadow', derived: true, info };
  if (s.state === 'penumbra') {
    return { label: 'Sunlight', value: `${(s.nu * 100).toFixed(s.nu > 0.995 ? 1 : 0)} %`, alt: `of the Sun: a partial eclipse, in ${whose(s.by)} penumbra`, src: 'shadow', derived: true, info };
  }
  return { label: 'Sunlight', value: 'lit', alt: 'the whole Sun in view', src: 'shadow', derived: true, info };
}

// The Sun seen from a heliocentric point (ecliptic km) on a date: the
// planets and Pluto, and the moons of any of them within 0.05 AU.
const PLANETS = BODIES.filter((b) => b.parent === 'sun');
export function sunlightAt(r: readonly number[], date: Date): Sunlight {
  const near: { key: string; rel: number[]; radius: number }[] = [];
  const add = (k: BodyKey) => { const p = bodyState(k, date).r; near.push({ key: k, rel: [p[0] - r[0], p[1] - r[1], p[2] - r[2]], radius: maxRadiusKm(k) }); };
  for (const b of PLANETS) {
    add(b.key);
    const q = near[near.length - 1].rel;
    if (Math.hypot(q[0], q[1], q[2]) < 7.5e6) for (const m of BODIES) if (m.parent === b.key) add(m.key);
  }
  return sunlight([-r[0], -r[1], -r[2]], near);
}

// The same as one line, for the mission readout's rows.
export function sunlightText(s: Sunlight): string {
  if (s.state === 'umbra') return `in eclipse, ${whose(s.by)} umbra`;
  if (s.state === 'penumbra') return `${(s.nu * 100).toFixed(0)} % of the Sun, in ${whose(s.by)} penumbra`;
  return 'lit';
}
