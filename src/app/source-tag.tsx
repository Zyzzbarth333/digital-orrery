// src/app/source-tag.tsx
//
// A source tag: the small label beside each readout naming where its value
// comes from (a solid tag for data, a dashed one for a value worked out
// here). Hovering it, focusing it or tapping it opens its detail: what the
// value is, the equation that gives it (typeset as MathML, tex.js) and its
// source (tag-info.js), with the row's own note.
//
// - Hover opens after a moment; the pointer can move onto the detail, and
//   it closes a moment after the pointer leaves both.
// - Focus opens it; a click or tap pins it open, a second one closes it.
// - Escape, a click elsewhere or moving focus away closes it.
// - One is open at a time. It is drawn over everything (fixed, in a portal
//   on the body), so a scrolling panel never clips it.
// - Screen readers get the same content as one line of plain text, as the
//   button's description, whether or not the detail is showing.

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { TAG_INFO } from './tag-info.js';
import { tex } from './tex.js';

export type TagInfoKey = keyof typeof TAG_INFO;
interface TagEntry { what: string; tex: string[]; where?: string; source: string }

let openId: string | null = null;
const subs = new Set<() => void>();
const setOpenId = (id: string | null) => { if (openId !== id) { openId = id; subs.forEach((f) => f()); } };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const OPEN_MS = 120, CLOSE_MS = 220, GAP = 6, EDGE = 8, MAX_W = 360;

export function SourceTag({ src, info, detail, derived = false }: { src: string; info?: TagInfoKey; detail?: string; derived?: boolean }) {
  const id = useId();
  const open = useSyncExternalStore(subscribe, () => openId === id);
  const [pinned, setPinned] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const entry: TagEntry | null = info ? TAG_INFO[info] : null;

  const later = (fn: () => void, ms: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(fn, ms); };
  const show = () => { window.clearTimeout(timer.current); setOpenId(id); };
  const hide = () => { window.clearTimeout(timer.current); setPinned(false); if (openId === id) setOpenId(null); };

  // Another tag opening unpins this one.
  useEffect(() => { if (!open) setPinned(false); }, [open]);
  useEffect(() => () => { window.clearTimeout(timer.current); if (openId === id) setOpenId(null); }, [id]);

  // While open: Escape and a press elsewhere close it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // First Escape closes the detail, not the console or a flight.
      if (e.key === 'Escape') { e.preventDefault(); hide(); }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) hide();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  });

  // Place it under the tag, right edges aligned, inside the window; above
  // the tag when there is no room below. Kept there as panels scroll.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btn.current, p = pop.current;
      if (!b || !p) return;
      const r = b.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { hide(); return; }    // its panel went away
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const w = Math.min(MAX_W, vw - 2 * EDGE);
      p.style.width = `${w}px`;
      p.style.maxHeight = `${vh - 2 * EDGE}px`;
      const h = p.offsetHeight;
      const left = Math.min(Math.max(EDGE, r.right - w), vw - w - EDGE);
      const below = r.bottom + GAP, above = r.top - GAP - h;
      const top = below + h <= vh - EDGE ? below : above >= EDGE ? above : Math.max(EDGE, vh - EDGE - h);
      p.style.left = `${left}px`;
      p.style.top = `${top}px`;
    };
    place();
    let raf = 0;
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
    window.addEventListener('scroll', soon, true);
    window.addEventListener('resize', soon);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', soon, true); window.removeEventListener('resize', soon); };
  }, [open]);

  const eqs = entry ? entry.tex.map((l) => tex(l)) : [];
  const kind = derived ? 'Worked out here' : 'Data';
  const descId = `${id}-d`, popId = `${id}-p`;
  // The whole detail as one line, for the button's description.
  const sentence = (s?: string) => (s ? (/[.!?]$/.test(s) ? s : `${s}.`) : '');
  const said = entry
    ? [entry.what, eqs.length ? sentence(eqs.map((e) => e.text).join('; ')) : '', sentence(entry.where), detail ? `Here: ${sentence(detail)}` : '', `Source: ${sentence(entry.source)}`].filter(Boolean).join(' ')
    : sentence(detail);

  return (
    <>
      <button ref={btn} type="button" className={`src-tag${derived ? ' derived' : ''}${open ? ' open' : ''}`}
        aria-describedby={descId} aria-expanded={open} aria-controls={open ? popId : undefined}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') later(show, OPEN_MS); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !pinned) later(hide, CLOSE_MS); }}
        onFocus={show}
        onBlur={(e) => { if (!pop.current?.contains(e.relatedTarget as Node)) hide(); }}
        onClick={() => { if (open && pinned) hide(); else { show(); setPinned(true); } }}>
        {src}
      </button>
      <span id={descId} hidden>{`${kind}. ${said}`}</span>
      {open && createPortal(
        <div ref={pop} id={popId} className="tag-pop" role="tooltip" data-pinned={pinned} tabIndex={-1}
          onBlur={(e) => { const t = e.relatedTarget as Node | null; if (!t || (!pop.current?.contains(t) && !btn.current?.contains(t))) hide(); }}
          onPointerEnter={() => window.clearTimeout(timer.current)}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !pinned) later(hide, CLOSE_MS); }}>
          <p className="tag-pop-head"><span className="tag-pop-src">{src}</span><span className="tag-pop-kind">{kind}</span></p>
          {entry && <p className="tag-pop-what">{entry.what}</p>}
          {eqs.length > 0 && (
            <div className="tag-pop-eq">
              {eqs.map((e, i) => (
                <span key={i} className="tag-pop-line"
                  dangerouslySetInnerHTML={{ __html: `<math display="block" aria-label="${e.text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${e.mathml}</math>` }} />
              ))}
            </div>
          )}
          {entry?.where && <p className="tag-pop-where">{entry.where}</p>}
          {detail && <p className="tag-pop-note"><span className="tag-pop-label">Here</span>{detail}</p>}
          {entry && <p className="tag-pop-source"><span className="tag-pop-label">Source</span>{entry.source}</p>}
        </div>,
        document.body,
      )}
    </>
  );
}
