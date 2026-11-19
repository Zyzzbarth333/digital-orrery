// src/app/type-step.ts
//
// The console's TYPE step (app.css html[data-type]; DESIGN.md, Typography),
// shared by the rail foot's TYPE keys and the + and - keys. A reader's
// choice is kept in localStorage (remember.js TYPE_KEY); until they make
// one, a wide screen starts at step 2 and a laptop at 1 (defaultType). It
// is applied when this module loads, before the app paints.

import { TYPE_KEY, defaultType, parseType, readStore, writeStore } from './remember.js';

export type TypeStep = 1 | 2 | 3;
const local = (() => { try { return window.localStorage; } catch { return undefined; } })();
const stored = readStore(local, TYPE_KEY);
let step: TypeStep = stored === null ? defaultType(window.innerWidth) : parseType(stored);
const subs = new Set<() => void>();

function apply(): void {
  if (step === 1) delete document.documentElement.dataset.type;
  else document.documentElement.dataset.type = String(step);
}
apply();

export const typeStep = {
  get: (): TypeStep => step,
  subscribe(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; },
  // A reader's choice: applied, kept, and the sky and panels told the size changed.
  set(n: number): void {
    const next = Math.max(1, Math.min(3, Math.round(n))) as TypeStep;
    if (next === step) return;
    step = next;
    apply();
    writeStore(local, TYPE_KEY, String(step));
    subs.forEach((f) => f());
    window.dispatchEvent(new Event('resize'));
  },
};
