// src/app/find.tsx
//
// The rail's FIND field: one search over everything the app can fly to.
// The planets and major moons, the irregular moons, the 135,353 asteroids
// and comets, the satellites, the spacecraft beyond Earth and the Moon's
// landing sites, each kind in a group of its first few matches. The
// asteroid index (smallbodies-index.txt, 0.44 MB compressed), the
// spacecraft's index (21 kB) and the satellites' names (10 kB) are fetched
// the first time the field takes focus.
//
// A combobox (WAI-ARIA 1.2), as the small-body search before it was: type,
// then the arrow keys move through the matches across the groups, Enter
// flies to the one marked (the first by default), Escape closes the list.
// Pointer: click a match. The / key focuses the field (App.tsx).
//
// Choosing one whose layer is off switches the layer on (the hit's pick
// says so, and the line under the field repeats it), then flies there.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SearchHit } from '../scene/smallBodies';

// The asteroids' and comets' search (smallBodies.ts), as App wires it.
export interface SmallSearch {
  search: (query: string, limit?: number) => Promise<SearchHit[]>;
  load: () => Promise<unknown>;
  pick: (j: number) => void;
  count: number;
}

export type FindGroup = 'bodies' | 'irregular' | 'small' | 'satellites' | 'spacecraft' | 'sites';
export const FIND_GROUPS: { key: FindGroup; label: string }[] = [
  { key: 'bodies', label: 'Planets and moons' },
  { key: 'irregular', label: 'Irregular moons' },
  { key: 'small', label: 'Asteroids and comets' },
  { key: 'satellites', label: 'Satellites' },
  { key: 'spacecraft', label: 'Beyond Earth' },
  { key: 'sites', label: 'Moon landings' },
];
// How many of each kind the list shows.
export const PER_GROUP = 3;

// A match: its group, its name and kind, and what choosing it does. pick
// flies there, switching its layer on first if it is off, and returns the
// line that says so ("Satellites shown"), or null.
export interface FindHit { id: string; group: FindGroup; label: string; kind: string; pick: () => string | null }

// now: the catalogues in memory, at once; later: those that wait on a
// fetch (the asteroid index). load: the fetches, on first focus; the first
// resolves to the asteroid index (null if it failed), and each one that
// lands searches again.
export interface FindApi {
  now: (q: string) => FindHit[];
  later: (q: string) => Promise<FindHit[]>;
  load: () => Promise<unknown>[];
}

// Names compared without case, accents or apostrophes ("Chang'e", "Hiʻiaka").
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’ʻ]/g, '').toLowerCase();
// How well a name matches a folded query: 0 exactly, 1 from its start, 2
// from a word's start, 3 anywhere in it; -1 not at all.
function rank(name: string, q: string): number {
  const n = fold(name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  const i = n.indexOf(q);
  if (i < 0) return -1;
  return /[\s\-(/]/.test(n[i - 1]) ? 2 : 3;
}
// The best `limit` of a catalogue for a query, by the best of each one's
// names, in the catalogue's order among equals.
export function best<T>(items: readonly T[], query: string, names: (t: T) => (string | undefined)[], limit = PER_GROUP): T[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: [number, number, T][] = [];
  items.forEach((t, k) => {
    const r = Math.min(...names(t).map((n) => (n ? rank(n, q) : -1)).map((x) => (x < 0 ? Infinity : x)));
    if (r !== Infinity) scored.push([r, k, t]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((s) => s[2]);
}

const ORDER = Object.fromEntries(FIND_GROUPS.map((g, k) => [g.key, k])) as Record<FindGroup, number>;
const inOrder = (hits: FindHit[]) => hits.map((h, k) => [h, k] as const).sort((a, b) => ORDER[a[0].group] - ORDER[b[0].group] || a[1] - b[1]).map((x) => x[0]);

// The list hangs under the field, or over it where there is more room
// above (on a phone the rail is at the foot of the screen).
const EDGE = 8, GAP = 2, MIN_W = 240;

export function FindField({ api, inputId = 'find' }: { api: FindApi; inputId?: string }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FindHit[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [loads, setLoads] = useState(0);
  const [note, setNote] = useState('');
  const seq = useRef(0);
  // The chosen one's name, written into the field: not searched again.
  const picked = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The app's catalogues change as layers load; the search reads the latest.
  const apiRef = useRef(api);
  apiRef.current = api;

  // Search as the query changes, a moment after typing stops, and again
  // when an index lands; a late answer to an older query is dropped.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits([]); setOpen(false); return; }
    if (q === picked.current) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      // What is in memory shows at once; with none of it, the list waits
      // for the index rather than say "No match" first.
      // A new query marks its first match; the asteroids arriving after
      // leave the marked one marked.
      const show = (list: FindHit[], keep: boolean) => {
        setHits(list); setOpen(true);
        setActiveId((a) => (keep && list.some((h) => h.id === a) ? a : list[0]?.id ?? null));
      };
      const now = inOrder(apiRef.current.now(q));
      if (now.length) show(now, false);
      else { setHits([]); setOpen(false); }
      void apiRef.current.later(q).then((more) => {
        if (n !== seq.current || (now.length && !more.length)) return;
        show(inOrder([...now, ...more]), now.length > 0);
      });
    }, 120);
    return () => clearTimeout(t);
  }, [query, loads]);

  const load = () => {
    // Once, unless the index failed (or the scene was not up yet): then again.
    if (state === 'loading' || state === 'ready') return;
    setState('loading');
    const [index, ...rest] = apiRef.current.load();
    void index.then((ix) => { setState(ix ? 'ready' : 'failed'); setLoads((k) => k + 1); });
    for (const p of rest) void p.then(() => setLoads((k) => k + 1));
  };
  const choose = (h: FindHit | undefined) => {
    if (!h) return;
    const said = h.pick();
    picked.current = h.label;
    setQuery(h.label);
    setOpen(false);
    setNote(said ?? '');
  };
  const shown = open && hits.length > 0;
  const active = Math.max(0, hits.findIndex((h) => h.id === activeId));
  const move = (d: number) => setActiveId(hits[Math.max(0, Math.min(hits.length - 1, active + d))]?.id ?? null);

  // Placed on the screen (position: fixed), so neither the rail's scroll
  // nor its strip on a phone clips it; kept there as panels scroll.
  useLayoutEffect(() => {
    if (!shown) return;
    const place = () => {
      const i = input.current, l = list.current;
      if (!i || !l) return;
      const r = i.getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const w = Math.min(Math.max(r.width, MIN_W), vw - 2 * EDGE);
      const below = vh - r.bottom - GAP - EDGE, above = r.top - GAP - EDGE;
      const down = below >= Math.min(l.scrollHeight, 240) || below >= above;
      l.style.left = `${Math.min(Math.max(EDGE, r.left), vw - w - EDGE)}px`;
      l.style.width = `${w}px`;
      l.style.maxHeight = `${Math.max(96, down ? below : above)}px`;
      l.style.top = down ? `${r.bottom + GAP}px` : 'auto';
      l.style.bottom = down ? 'auto' : `${vh - r.top + GAP}px`;
    };
    place();
    let raf = 0;
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
    window.addEventListener('scroll', soon, true);
    window.addEventListener('resize', soon);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', soon, true); window.removeEventListener('resize', soon); };
  }, [shown, hits]);

  // The marked one stays in the list's view.
  useEffect(() => {
    const l = list.current, o = shown ? document.getElementById(`${id}-o${active}`) : null;
    if (!l || !o) return;
    if (o.offsetTop < l.scrollTop) l.scrollTop = o.offsetTop - 24;
    else if (o.offsetTop + o.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = o.offsetTop + o.offsetHeight - l.clientHeight;
  }, [active, shown, id]);

  const status = note || (state === 'loading' ? 'Loading the asteroid index…'
    : query.trim() && open && !hits.length ? 'No match'
      : state === 'failed' && query.trim() ? 'The asteroid index did not load' : '');

  return (
    <div className="sb-search find" role="search">
      <label className="engraved" htmlFor={inputId}>Find</label>
      <input ref={input} id={inputId} className="input" type="search" placeholder="Mars, Eros, ISS, Apollo 11" autoComplete="off" spellCheck={false}
        role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={`${id}-list`}
        aria-activedescendant={shown ? `${id}-o${active}` : undefined} aria-describedby={`${id}-status`}
        aria-keyshortcuts="/"
        title="Any planet, moon, asteroid, comet, satellite, spacecraft or Moon landing, by name, number or designation (/)"
        value={query}
        onFocus={() => { load(); if (hits.length && query.trim() !== picked.current) setOpen(true); }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { picked.current = null; setNote(''); setQuery(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); if (shown) move(1); else setOpen(true); }
          else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); if (shown) move(-1); else setOpen(true); }
          else if (e.key === 'Enter') { e.preventDefault(); if (query.trim() !== picked.current) choose(hits[active]); }
          else if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }} />
      {shown && (
        <div ref={list} className="sb-hits find-hits" role="listbox" id={`${id}-list`} aria-label="Matches">
          {FIND_GROUPS.map((g) => {
            const own = hits.filter((h) => h.group === g.key);
            if (!own.length) return null;
            return (
              <ul key={g.key} role="group" aria-label={g.label}>
                <li role="none" aria-hidden="true" className="find-group">{g.label}</li>
                {own.map((h) => {
                  const k = hits.indexOf(h);
                  return (
                    <li key={h.id} id={`${id}-o${k}`} role="option" aria-selected={k === active}
                      onMouseDown={(e) => { e.preventDefault(); choose(h); }} onMouseEnter={() => setActiveId(h.id)}>
                      <span className="sb-hit-name">{h.label}</span>
                      <span className="sb-hit-kind">{h.kind}</span>
                    </li>
                  );
                })}
              </ul>
            );
          })}
        </div>
      )}
      <span id={`${id}-status`} className="sb-search-status" role="status">{status}</span>
    </div>
  );
}
