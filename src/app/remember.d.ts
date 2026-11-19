// Types for remember.js (what the app keeps across a refresh).
type Bools<K extends string> = Record<K, boolean>;
export interface Layers {
  small: Bools<'belt' | 'neo' | 'trojans' | 'outer' | 'comets' | 'colours'>;
  irregular: boolean;
  sites: boolean;
  sats: Bools<'active' | 'debris' | 'rocket-bodies' | 'analyst'>;
  probes: boolean;
  guides: Bools<'axes' | 'field' | 'spheres' | 'lagrange' | 'pulls' | 'flow' | 'magnetic' | 'aurora' | 'belts'>;
  flow: { frame: 'inertial' | 'falling' | 'others' | 'rotating'; plane: 'orbit' | 'view' };
  frame: 'sun' | 'ssb';
  sky: Bools<'lines' | 'names'>;
}
export interface KeptCam { az: number; el: number; dist: number; pan: [number, number, number] }
export interface KeptClock { timeMs: number; rate: number; playing: boolean }
export interface KeptView { focus: string; on: string | null; cam: KeptCam | null; clock: KeptClock | null; savedAt: number | null }
export const VIEW_KEY: string;
export const LAYERS_KEY: string;
export const TYPE_KEY: string;
export const SHORTCUTS_KEY: string;
export const PINS_KEY: string;
export interface Pins { rail: boolean; plate: boolean }
export const DEFAULT_PINS: Readonly<Pins>;
export function parsePins(text: string | null): Pins;
export function parseType(text: string | null): 1 | 2 | 3;
export const WIDE_TYPE_PX: number;
export function defaultType(widthPx: number): 1 | 2;
export const DEFAULT_LAYERS: Readonly<Layers>;
export function readStore(storage: Storage | undefined, key: string): string | null;
export function writeStore(storage: Storage | undefined, key: string, value: string): void;
export function clearStore(storage: Storage | undefined, key: string): void;
export function parseLayers(text: string | null): Layers;
export function parseView(text: string | null): KeptView | null;
export function resumeTime(clock: KeptClock, savedAt: number | null, nowMs: number): number;
