// src/scene/probeModels.ts
//
// NASA's own models of the spacecraft beyond Earth and of the MISSION
// tab's real craft (docs/frontend/spacecraft.md#close-up-models,
// docs/credits.md): one GLB each in public/models/probes, from NASA 3D
// Resources (free to use) or NASA's Eyes on the Solar System
// (NASA/JPL-Caltech, the JPL Image Use Policy).
//
// What each entry holds:
// - file: the GLB's name; nasa3d: its source (else Eyes).
// - title: the model as its source names it, for the credit.
// - sun: the model's axis (in its own glTF axes) its solar arrays,
//   sunshield or heat shield face; earth instead for a craft that points
//   its high-gain antenna at the Earth (the RTG craft). The app carries
//   none of these craft's attitudes: each is drawn with that axis turned to
//   the Sun (or the Earth), and up: its second axis, turned as near the
//   ecliptic's north as is square to the first.
// - scale: the published size it is drawn at: a part of the model (a mesh
//   or material name, or the whole model), its extent along an axis, made
//   the published figure (m) from the source cited in `cite`. A model with
//   no published figure to match is drawn at its own size, in metres.
// - thrust: the axis the main engine pushes along, where the model shows
//   it, for a burn's plume (the engine aft along -thrust).
// - span: the size (m) the 3-pixel threshold goes by (craftModels.ts).
//
// The axes were read from each model in its own frame (x, y, z as the GLB
// has them) and checked close up in the app.

export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export interface ProbeModel {
  file: string; nasa3d: boolean; title: string; name: string;
  sun?: Axis; earth?: Axis; up: Axis;
  scale: { part: string | null; axis: 'x' | 'y' | 'z'; m: number; what: string; cite: string } | null;
  thrust?: Axis; span: number;
}

export const PROBE_MODELS: Record<string, ProbeModel> = {
  jwst: { file: 'jwst.glb', nasa3d: true, title: 'James Webb Space Telescope (B)', name: 'Webb', sun: '-y', up: '+z', span: 21.2,
    scale: { part: null, axis: 'z', m: 21.197, what: 'its sunshield 21.197 m long', cite: 'NASA, "Webb\'s Sunshield"' } },
  mro: { file: 'mro.glb', nasa3d: true, title: 'Mars Reconnaissance Orbiter (MRO) (C)', name: 'MRO', sun: '-y', up: '+z', span: 13.6,
    scale: { part: 'shiny_panel', axis: 'x', m: 13.6, what: '13.6 m across its two solar panels', cite: 'NASA/JPL, MRO arrival press kit' } },
  maven: { file: 'maven.glb', nasa3d: true, title: 'Mars Atmosphere and Volatile EvolutioN (MAVEN) (B)', name: 'MAVEN', sun: '+y', up: '+z', span: 11.4,
    scale: { part: 'shiny_panel', axis: 'x', m: 11.4, what: '11.4 m long across its solar panels', cite: 'NASA, MAVEN mission page' } },
  juno: { file: 'juno.glb', nasa3d: true, title: 'Juno (A)', name: 'Juno', sun: '+y', up: '+z', thrust: '+y', span: 21, scale: null },
  lro: { file: 'lro.glb', nasa3d: true, title: 'Lunar Reconnaissance Orbiter (B)', name: 'LRO', sun: '-y', up: '+z', span: 6.2, scale: null },
  messenger: { file: 'messenger.glb', nasa3d: true, title: 'MErcury Surface, Space ENvironment, GEochemistry, and Ranging (MESSENGER)', name: 'MESSENGER', sun: '+x', up: '+y', span: 6.7,
    scale: { part: 'AO_heatshield', axis: 'y', m: 2.5, what: 'its sunshade 2.5 m tall', cite: 'JHU/APL, MESSENGER spacecraft page' } },
  odyssey: { file: 'odyssey.glb', nasa3d: true, title: 'Mars Odyssey', name: 'Odyssey', sun: '+z', up: '+y', span: 8.3,
    scale: { part: 'shiny_panel', axis: 'x', m: 5.7, what: 'its solar array 5.7 m tip to tip', cite: 'NASA/JPL, Odyssey arrival press kit' } },
  dscovr: { file: 'dscovr.glb', nasa3d: true, title: 'Deep Space Climate Observatory (DSCOVR) (Triana)', name: 'DSCOVR', sun: '-y', up: '+z', span: 6.3,
    scale: { part: 'TrianaXsides.001', axis: 'x', m: 1.83, what: 'its body 6 ft (1.83 m) across', cite: 'NASA, "DSCOVR\'s size"' } },
  roman: { file: 'roman.glb', nasa3d: true, title: 'Nancy Grace Roman Space Telescope (B)', name: 'Roman', sun: '+y', up: '+x', span: 12.7,
    scale: { part: null, axis: 'x', m: 12.7, what: '12.7 m long', cite: 'NASA, Roman FAQ' } },
  parker: { file: 'parker.glb', nasa3d: true, title: 'Parker Solar Probe', name: 'Parker', sun: '-z', up: '+y', span: 6.6,
    scale: { part: 'PSP', axis: 'z', m: 3.05, what: '10 ft (3.05 m) high', cite: 'JHU/APL, full-scale model release' } },
  voyager: { file: 'voyager.glb', nasa3d: true, title: 'Voyager Probe (A)', name: 'Voyager', earth: '+y', up: '+z', span: 13,
    scale: { part: 'VoyagerDish', axis: 'x', m: 3.7, what: 'its high-gain antenna 3.7 m across', cite: 'NASA, Voyager spacecraft page' } },
  dart: { file: 'dart.glb', nasa3d: false, title: 'DART', name: 'DART', sun: '+y', up: '+z', span: 17.5,
    scale: { part: 'Cylinder082', axis: 'x', m: 8.5, what: 'each solar array 8.5 m long', cite: 'JHU/APL, DART impactor spacecraft page' } },
  psyche: { file: 'psyche.glb', nasa3d: false, title: 'Psyche', name: 'Psyche', sun: '+y', up: '+z', span: 24.8,
    scale: { part: null, axis: 'x', m: 24.76, what: '24.76 m long across its arrays', cite: 'NASA/JPL, Psyche press kit' } },
  lucy: { file: 'lucy.glb', nasa3d: false, title: 'Lucy', name: 'Lucy', sun: '+z', up: '+y', span: 16,
    scale: { part: null, axis: 'x', m: 16, what: '16 m tip to tip', cite: 'NASA, the Lucy spacecraft' } },
  clipper: { file: 'clipper.glb', nasa3d: false, title: 'Europa Clipper', name: 'Europa Clipper', sun: '-y', up: '+z', span: 30.5,
    scale: { part: null, axis: 'x', m: 30.5, what: '30.5 m tip to tip', cite: 'NASA/JPL, Europa Clipper press kit' } },
  newhorizons: { file: 'newhorizons.glb', nasa3d: false, title: 'New Horizons', name: 'New Horizons', earth: '+y', up: '+z', span: 3.3,
    scale: { part: 'AO_dish', axis: 'x', m: 2.1, what: 'its high-gain antenna 2.1 m across', cite: 'JHU/APL, New Horizons spacecraft page' } },
  juice: { file: 'juice.glb', nasa3d: false, title: 'JUICE', name: 'JUICE', sun: '-x', up: '+y', span: 27,
    scale: { part: null, axis: 'z', m: 27, what: '27 m tip to tip', cite: 'ESA, Juice spacecraft specs' } },
  euclid: { file: 'euclid.glb', nasa3d: false, title: 'Euclid', name: 'Euclid', sun: '+x', up: '+y', span: 6.3, scale: null },
  soho: { file: 'soho.glb', nasa3d: false, title: 'SOHO', name: 'SOHO', sun: '+y', up: '+z', span: 9.5,
    scale: { part: null, axis: 'x', m: 9.5, what: '9.5 m across its solar array', cite: 'ESA, SOHO fact sheet' } },
  mex: { file: 'mex.glb', nasa3d: false, title: 'Mars Express', name: 'Mars Express', sun: '-x', up: '+y', span: 48, scale: null },
  danuri: { file: 'danuri.glb', nasa3d: false, title: 'Danuri', name: 'Danuri', sun: '+z', up: '+y', span: 6.3,
    scale: { part: null, axis: 'x', m: 6.3, what: '6.3 m across', cite: 'KPLO press kit' } },
  capstone: { file: 'capstone.glb', nasa3d: false, title: 'CAPSTONE', name: 'CAPSTONE', sun: '-z', up: '+y', span: 1.4, scale: null },
};

// The model a spacecraft layer's craft (spacecraft.js keys) is drawn by:
// both Voyagers by the one.
const PROBE_MODEL_OF: Record<string, string> = { voyager1: 'voyager', voyager2: 'voyager' };
export function probeModelKey(probeKey: string): string | null {
  const k = PROBE_MODEL_OF[probeKey] ?? probeKey;
  return PROBE_MODELS[k] ? k : null;
}
// The MISSION tab's real craft, by the name its file gives.
const MISSION_MODEL: Record<string, string> = { Juno: 'juno', DART: 'dart', LRO: 'lro', MESSENGER: 'messenger' };
export const missionModelKey = (craft: string | undefined): string | null => (craft && MISSION_MODEL[craft]) || null;

// What the plate says of a model: whose it is, its size, how it is turned.
export function probeNote(key: string): string {
  const p = PROBE_MODELS[key];
  const whose = p.nasa3d ? `NASA's "${p.title}" model (NASA 3D Resources)` : `NASA/JPL-Caltech's ${p.title} model from NASA's Eyes on the Solar System`;
  const size = p.scale ? `scaled to ${p.scale.what}, as ${p.scale.cite.replace(/,.*$/, '')} gives` : 'at the model\'s own size in metres (no published figure to scale it to)';
  const turned = p.earth
    ? 'its high-gain antenna turned to the Earth'
    : `its ${key === 'parker' ? 'heat shield' : key === 'messenger' ? 'sunshade' : key === 'jwst' || key === 'euclid' ? 'sunshield' : 'solar arrays'} turned to the Sun`;
  return `Drawn close up by ${whose}, ${size}. The app does not carry its attitude: it is drawn with ${turned}, its arrays and antennas fixed as modelled. Until the model has loaded it stays a marker.`;
}

// LICIACube, the 6U CubeSat DART released on 11 September 2022: built in
// code at the 6U envelope, 10 by 22.6 by 36.6 cm (NASA's small spacecraft
// technology report), its two solar panels left out. Its 14 kg is JHU/APL's.
export const LICIACUBE = { size: [0.366, 0.2263, 0.1] as [number, number, number], massKg: 14 };
export const LICIACUBE_NOTE = 'LICIACube is drawn as a plain 6U CubeSat, 10 by 22.6 by 36.6 cm, its two solar panels left out. It moves off DART at the speed that balances DART\'s recoil in its reconstruction (0.033 m/s) for its 14 kg.';
