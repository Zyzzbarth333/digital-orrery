// src/app/stow.tsx
//
// Beside the sky (not on a phone, whose one sheet holds both), the body rail
// (L1) and the data plate (R1) are stowed unless pinned, so a first visit
// sees the sky first (docs/frontend/panels.md). A stowed panel folds back to
// its spine: a narrow strip of the same sheet metal on its edge of the sky,
// engraved with its code, its name and its key.
//
// - Peek: a pointer resting on the spine slides the panel out over the sky,
//   and away again once the pointer has left both. Keyboard focus on the
//   spine, or anywhere in the panel, opens it too and holds it open.
// - A press on the spine latches it open, until Escape, a press elsewhere
//   or the spine again.
// - Pin: the PIN key in the panel's corner, or L and R (App.tsx), puts it
//   back in its column beside the sky, kept for this browser (remember.js
//   PINS_KEY).
//
// Only the pointer's peek slides: what a key opens or closes (Tab, Escape,
// / for FIND) is there at once, as a key's action should be. Pinning moves
// the sky's edge, a layout change, so it is not animated either: the sky
// would resize every frame.

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { PINS_KEY, parsePins, readStore, writeStore, type Pins } from './remember.js';

export type PanelId = keyof Pins;
type How = 'pointer' | 'key';

const local = (() => { try { return window.localStorage; } catch { return undefined; } })();
let pins: Pins = parsePins(readStore(local, PINS_KEY));
const subs = new Set<() => void>();
const openers = new Set<(id: PanelId, how: How) => void>();

export const panels = {
  get: (): Pins => pins,
  subscribe(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; },
  pin(id: PanelId, on: boolean): void {
    if (pins[id] === on) return;
    pins = { ...pins, [id]: on };
    writeStore(local, PINS_KEY, JSON.stringify(pins));
    subs.forEach((f) => f());
  },
  // Open a stowed panel and latch it, as a press on its spine does: FIND
  // opens the rail before focusing its field, a guide's or an orbit's pick
  // opens the plate it fills.
  open(id: PanelId, how: How = 'pointer'): void {
    if (!pins[id]) openers.forEach((f) => f(id, how));
  },
};

export function usePins(): Pins {
  return useSyncExternalStore(panels.subscribe, panels.get);
}

const OPEN_MS = 150;      // a pointer rests this long on the spine before it peeks: a pass over the edge doesn't
const CLOSE_MS = 300;     // grace after the pointer leaves, so a slip off the panel's edge doesn't shut it

// A source tag's detail is drawn on the body (source-tag.tsx): pressing or
// pointing at it is still the panel's.
const own = (root: HTMLElement | null, n: EventTarget | null): boolean =>
  n instanceof Node && (!!root?.contains(n) || (n instanceof Element && !!n.closest('.tag-pop')));

export function Stow({ id, side, code, name, legend, keyName, wordmark = false, children }: {
  id: PanelId;
  side: 'left' | 'right';
  code: string;                 // the panel code, L1 or R1
  name: string;                 // what the panel is, for its keys' names: "bodies rail"
  legend: ReactNode;            // engraved down the spine
  keyName: string;              // its key, L or R
  wordmark?: boolean;           // the spine carries the app's name (the rail heads with it)
  children: ReactNode;
}) {
  const pinned = usePins()[id];
  const root = useRef<HTMLDivElement>(null);
  const spine = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [latched, setLatched] = useState(false);
  // Shut by Escape or a press on the spine: no peek until pointer and focus have left.
  const [hush, setHush] = useState(false);
  const [how, setHow] = useState<How>('pointer');
  const timer = useRef(0);
  const open = !pinned && !hush && (hover || focus || latched);
  const later = (f: () => void, ms: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(f, ms); };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Pinned or stowed afresh: nothing held open.
  useEffect(() => { setHover(false); setLatched(false); setHush(false); }, [pinned]);

  useEffect(() => {
    const f = (which: PanelId, h: How) => { if (which === id) { setHow(h); setHush(false); setLatched(true); } };
    openers.add(f);
    return () => { openers.delete(f); };
  }, [id]);

  // A latched panel closes at a press anywhere else.
  useEffect(() => {
    if (!latched || pinned) return;
    const onDown = (e: globalThis.PointerEvent) => { if (!own(root.current, e.target)) { setHow('pointer'); setLatched(false); } };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [latched, pinned]);

  const onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || pinned) return;
    if (hover) { window.clearTimeout(timer.current); return; }
    later(() => { setHow('pointer'); setHover(true); }, OPEN_MS);
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (hover) later(() => { setHow('pointer'); setHover(false); setHush(false); }, CLOSE_MS);
    else { window.clearTimeout(timer.current); if (!focus) setHush(false); }
  };
  // Keyboard focus only (:focus-visible): a key or row pressed with the
  // mouse keeps its focus, and would otherwise hold the panel open after
  // the pointer has gone. A text field is always focus-visible, so typing
  // in FIND holds it open.
  const onFocus = (e: FocusEvent) => {
    const kb = (e.target as Element).matches?.(':focus-visible') ?? false;
    if (kb && !focus) setHow('key');
    setFocus(kb);
  };
  const onBlur = (e: FocusEvent) => {
    if (own(root.current, e.relatedTarget)) return;
    setFocus(false);
    if (!hover) setHush(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open || e.defaultPrevented) return;
    // Back to the spine, which stays focused but quiet.
    setHow('key'); setLatched(false); setHover(false); setHush(true);
    if (root.current?.contains(document.activeElement) && document.activeElement !== spine.current) spine.current?.focus();
    e.preventDefault();
  };
  const onSpine = () => {
    if (latched || (open && focus)) { setHow('pointer'); setLatched(false); setHover(false); setHush(true); return; }
    setHow('pointer'); setHush(false); setLatched(true);
  };

  const pinTitle = pinned ? `Stow the ${name} to its spine (${keyName})` : `Pin the ${name} open beside the sky (${keyName})`;
  return (
    <div ref={root} className={`stow ${side}`} data-pinned={pinned || undefined} data-open={open || undefined} data-how={how}
      onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}>
      {!pinned && (
        <button ref={spine} type="button" className="stow-spine" onClick={onSpine} aria-expanded={open} aria-controls={panelId}
          aria-keyshortcuts={keyName} title={open ? `Close the ${name} (Esc)` : `Open the ${name}; ${keyName} pins it`}>
          {wordmark && <span className="spine-mark" aria-hidden="true">digital-orrery</span>}
          <span className="spine-legend">
            <span className="spine-code" aria-hidden="true">{code}</span>
            <span className="spine-name">{legend}</span>
          </span>
          <span className="spine-grip" aria-hidden="true" />
          <kbd className="spine-key" aria-hidden="true">{keyName}</kbd>
        </button>
      )}
      <div className="stow-drawer" id={panelId} inert={!pinned && !open ? true : undefined}>
        <button type="button" className="key small pin-key" aria-pressed={pinned} aria-keyshortcuts={keyName} title={pinTitle}
          onClick={() => panels.pin(id, !pinned)}>Pin</button>
        {children}
      </div>
    </div>
  );
}
