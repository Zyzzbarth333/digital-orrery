// src/app/peek.tsx
//
// The phone sheet's peek (docs/frontend/phone.md): a nomenclature strip
// with the name of what the camera is on, and two of its values in an
// amber window, each with its source tag. Which two depends on its kind,
// and the plate in view chooses them from its own rows (usePeek), so the
// peek always says what the plate says:
//   planet, the Sun, a barycentre: distance from Earth, light time;
//   moon: distance from its planet, orbital period;
//   satellite: height, speed;
//   spacecraft: distance from Earth, speed (a craft of the user's: its
//   altitude or distance and speed, as the MISSION tab gives them);
//   small body: distance from the Sun, diameter;
//   landing site: the body, the landing date.

import { useId, useLayoutEffect, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { SourceTag } from './source-tag';
import type { Row } from './panels';

// The rows each mounted chooser gave: the plate in view (priority 0), and
// a followed craft over it (priority 1). The highest priority shows, and
// among equals the one mounted last.
const entries = new Map<string, { prio: number; order: number; rows: readonly Row[] }>();
let order = 0;
let shown: readonly Row[] = [];
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function recompute() {
  let best: { prio: number; order: number; rows: readonly Row[] } | null = null;
  for (const e of entries.values()) if (!best || e.prio > best.prio || (e.prio === best.prio && e.order > best.order)) best = e;
  const next = best?.rows ?? [];
  if (next === shown) return;
  shown = next;
  for (const fn of listeners) fn();
}

// Two rows for the peek. Called on every render (the plates redraw ten
// times a second); the peek redraws only when a shown value changes.
export function usePeek(pick: readonly (Row | null | undefined | false)[], prio = 0): void {
  const id = useId();
  const list = pick.filter((r): r is Row => !!r).slice(0, 2);
  const key = list.map((r) => `${r.label}\u0000${r.value}\u0000${r.unit ?? ''}\u0000${r.src}\u0000${r.derived ? 1 : 0}\u0000${r.info}\u0000${r.detail ?? ''}`).join('\u0001');
  useLayoutEffect(() => {
    const e = entries.get(id);
    if (e) e.rows = list; else entries.set(id, { prio, order: ++order, rows: list });
    recompute();
    // list follows key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key]);
  useLayoutEffect(() => () => { entries.delete(id); recompute(); }, [id]);
}

export function Peek({ name, hintRef, children }: { name: string; hintRef?: Ref<HTMLDivElement>; children?: ReactNode }) {
  const rows = useSyncExternalStore(subscribe, () => shown);
  return (
    <div className="peek">
      <h2 className="strip peek-name" title={name}>{name}</h2>
      {rows.length > 0 && (
        <dl className="peek-values">
          {rows.map((r) => (
            <div key={r.label} className="peek-value">
              <dt title={r.hint}>{r.label}</dt>
              <dd>
                <span className="peek-num">{r.value}{r.unit && <span className="unit">{r.unit}</span>}</span>
                <SourceTag src={r.src} derived={r.derived} info={r.info} detail={r.detail} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {children}
      <div className="peek-hint" ref={hintRef} />
    </div>
  );
}

// The rows with these labels, in this order (for usePeek).
export const byLabel = (rows: readonly Row[], ...labels: string[]) => labels.map((l) => rows.find((r) => r.label === l));
