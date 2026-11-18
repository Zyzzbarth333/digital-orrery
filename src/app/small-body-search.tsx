// src/app/small-body-search.tsx
//
// Search every asteroid and comet the sky draws (135,353) by number, name
// or designation, and fly to the one chosen, as the Fly-to list does for
// the named ones. The designation index (smallbodies-index.txt, 0.44 MB
// compressed) is fetched the first time the box takes focus.
//
// A combobox (WAI-ARIA 1.2): type, then the arrow keys move through the
// matches, Enter flies to the one marked (the first by default), Escape
// closes the list. Pointer: click a match.

import { useEffect, useId, useRef, useState } from 'react';
import type { SearchHit } from '../scene/smallBodies';

export interface SmallSearch {
  search: (query: string) => Promise<SearchHit[]>;
  load: () => Promise<unknown>;
  pick: (j: number) => void;
  count: number;
}

// label and placeholder: for another catalogue (the satellites' search).
export function SmallBodySearch({ api, label, placeholder = '433, Eros, 1997 AU24, 1P' }: { api: SmallSearch; label?: string; placeholder?: string }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const seq = useRef(0);
  // The chosen body's name, written into the box: not searched again.
  const picked = useRef<string | null>(null);

  // Search as the query changes, a moment after typing stops; a late answer
  // to an older query is dropped.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits([]); return; }
    if (q === picked.current) return;
    picked.current = null;
    const n = ++seq.current;
    const t = setTimeout(() => {
      void api.search(q).then((h) => { if (n === seq.current) { setHits(h); setActive(0); setOpen(true); } });
    }, 120);
    return () => clearTimeout(t);
  }, [query, api]);

  const load = () => {
    if (state !== 'idle') return;
    setState('loading');
    void api.load().then((ix) => setState(ix ? 'ready' : 'failed'));
  };
  const choose = (h: SearchHit | undefined) => {
    if (!h) return;
    api.pick(h.j);
    picked.current = h.label;
    setQuery(h.label);
    setOpen(false);
  };
  const shown = open && hits.length > 0;
  const status = state === 'loading' ? 'Loading the index…' : state === 'failed' ? 'The index did not load'
    : query.trim() && open && !hits.length ? 'No match' : '';

  return (
    <div className="sb-search">
      <label className="engraved" htmlFor={`${id}-q`}>{label ?? `Search all ${api.count.toLocaleString('en-AU')}`}</label>
      <input id={`${id}-q`} className="input" type="search" placeholder={placeholder} autoComplete="off" spellCheck={false}
        role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={`${id}-list`}
        aria-activedescendant={shown ? `${id}-o${active}` : undefined} aria-describedby={`${id}-status`}
        value={query} onFocus={load} onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); setOpen(true); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(hits[active]); }
          else if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }} />
      {shown && (
        <ul className="sb-hits" role="listbox" id={`${id}-list`} aria-label="Matches">
          {hits.map((h, k) => (
            <li key={h.j} id={`${id}-o${k}`} role="option" aria-selected={k === active}
              onMouseDown={(e) => { e.preventDefault(); choose(h); }} onMouseEnter={() => setActive(k)}>
              <span className="sb-hit-name">{h.label}</span>
              <span className="sb-hit-kind">{h.kind}</span>
            </li>
          ))}
        </ul>
      )}
      <span id={`${id}-status`} className="sb-search-status" role="status">{status}</span>
    </div>
  );
}
