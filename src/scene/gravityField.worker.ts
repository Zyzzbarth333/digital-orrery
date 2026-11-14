// src/scene/gravityField.worker.ts
//
// Works out a body's gravity anomaly map (gravityField.ts) off the main
// thread: the Moon's 720 x 361 map at degree 100 takes about a quarter of a
// second. The coefficient files load here, only when a map is wanted.

import { fieldMap, WGS84_NORMAL_ZONALS } from '../physics/gravityGuides.js';

export type FieldQuery = { kind: 'earth' } | { kind: 'moon' } | { kind: 'j2'; gm: number; j2: number; radius: number };
export type FieldRequest = FieldQuery & { id: number };
export interface FieldReply { id: number; values: Float64Array; width: number; height: number }

self.onmessage = async (e: MessageEvent<FieldRequest>) => {
  const q = e.data;
  let values: Float64Array, width: number, height: number;
  if (q.kind === 'earth') {
    const { EGM2008 } = await import('../physics/egm2008.js');
    [width, height] = [360, 181];
    values = fieldMap({ ...EGM2008, degree: 70, normal: WGS84_NORMAL_ZONALS, width, height });
  } else if (q.kind === 'moon') {
    const { GRAIL } = await import('../physics/grail.js');
    [width, height] = [720, 361];
    values = fieldMap({ ...GRAIL, degree: 100, width, height });
  } else {
    [width, height] = [4, 181];
    values = fieldMap({ gm: q.gm, radius: q.radius, C: [[1], [0, 0], [-q.j2 / Math.sqrt(5)]], S: [], degree: 2, width, height });
  }
  (self as unknown as Worker).postMessage({ id: q.id, values, width, height } satisfies FieldReply, [values.buffer]);
};
