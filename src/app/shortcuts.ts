// src/app/shortcuts.ts
//
// Whether the console's single-key shortcuts (App.tsx: Space, the arrows,
// N, M, L, R, H, C, /, ?, + and -) are on. WCAG 2.2 SC 2.1.4 asks that a page's
// single-character shortcuts can be turned off, since a speech-input
// user's words or a stray key otherwise fire them. The ? sheet holds the
// switch; Escape and the controls' own keys work either way. The choice is
// kept in localStorage (remember.js SHORTCUTS_KEY).

import { SHORTCUTS_KEY, readStore, writeStore } from './remember.js';

const local = (() => { try { return window.localStorage; } catch { return undefined; } })();
let on = readStore(local, SHORTCUTS_KEY) !== 'off';
const subs = new Set<() => void>();

export const shortcuts = {
  get: (): boolean => on,
  subscribe(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; },
  set(next: boolean): void {
    if (next === on) return;
    on = next;
    writeStore(local, SHORTCUTS_KEY, on ? 'on' : 'off');
    subs.forEach((f) => f());
  },
};

// The controls that take Space themselves (a button presses, a switch
// toggles), so the console's Space for RUN and HOLD leaves them alone.
export const OWN_KEYS = 'button, a[href], summary, [role=button], [role=switch], [role=radio], [role=tab], [role=checkbox], [role=option], [role=menuitem], tr[tabindex]';
