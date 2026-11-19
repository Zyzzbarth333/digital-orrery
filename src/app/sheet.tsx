// src/app/sheet.tsx
//
// The phone's one sheet (docs/frontend/phone.md): a beige panel over the
// sky with three stops, peek (its head: a latch bar, the name and two
// values), half (about half the screen) and full (the screen under the
// band). On a short touch screen it runs up the right-hand side instead,
// 40 % wide, with the same stops.
//
// The head (and the body below full) drags it: while the finger is down it
// moves 1:1, past the end stops with resistance; let go, it settles on the
// stop nearest where the fling would carry it, and a drag can catch it
// mid-flight. Motion is a transform; at rest the sheet sits by its top, so
// the popups inside it (FIND's matches, a tag's detail), which are placed
// on the screen, land where they should. Tapping the peek toggles peek and
// half; the latch is a button (aria-expanded) that steps through the stops,
// and ArrowUp and ArrowDown step too. Above peek, one history entry lets
// Back drop it to peek. With reduced motion it jumps between stops. Focus
// moving below what half shows opens it fully.
//
// Pointer events and CSS only, no library.

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';

export type Stop = 'peek' | 'half' | 'full';
const ORDER: Stop[] = ['peek', 'half', 'full'];
const WORD: Record<Stop, string> = { peek: 'lowered', half: 'half open', full: 'open' };

// The iOS sheet's curve (as Vaul uses it): steep at first, a gentle settle.
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SLOP = 6;                 // px before a press becomes a drag
const FLING = 0.45;             // px/ms: a flick moves at least one stop
const PROJECT = 180;            // ms of travel a release is carried forward

interface Geom { top: number; h: number; y: Record<Stop, number> }

export function Sheet({ stop, onStop, side, label, peek, children, onRest, aboveRef }: {
  stop: Stop;
  onStop: (s: Stop) => void;
  side: boolean;
  label: string;
  peek: ReactNode;
  children: ReactNode;
  // Once settled: how much of the sky it covers, from the bottom (px) or,
  // as a side sheet, from the right.
  onRest?: (cover: { bottom: number; right: number }, stop: Stop) => void;
  aboveRef?: Ref<HTMLDivElement>;
}) {
  const el = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const safe = useRef<HTMLSpanElement>(null);
  const bodyId = useId();
  const geom = useRef<Geom>({ top: 0, h: 0, y: { peek: 0, half: 0, full: 0 } });
  const rest = useRef(0);                 // the y the sheet's top sits at
  const shown = useRef<Stop>(stop);       // the stop it is at, or going to
  const drag = useRef<{ id: number; y0: number; from: number; on: boolean; samples: [number, number][]; moved: boolean } | null>(null);
  const clickEaten = useRef(false);
  const reduced = useRef(typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null);
  const latest = useRef({ onStop, onRest, side });
  latest.current = { onStop, onRest, side };

  // Where each stop puts the sheet's top, from the band's foot to the
  // bottom of what can be seen (the visual viewport: it shrinks under a
  // software keyboard).
  const measure = (): Geom => {
    const band = document.querySelector('.band');
    const top = band ? Math.round(band.getBoundingClientRect().bottom) : 0;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const h = Math.max(120, Math.round(vh - top));
    const peekH = Math.min(h, (head.current?.offsetHeight ?? 88) + (safe.current?.offsetHeight ?? 0));
    const half = Math.min(h, Math.max(peekH + 160, Math.round(vh * 0.5)));
    return { top, h, y: { peek: h - peekH, half: h - half, full: 0 } };
  };

  // At rest: by its top, no transform.
  const commit = (y: number) => {
    const s = el.current;
    if (!s) return;
    rest.current = y;
    s.style.transition = 'none';
    s.style.transform = '';
    s.style.top = `${geom.current.top + y}px`;
    s.style.height = `${geom.current.h}px`;
  };
  // The y it is drawn at now (mid-flight included).
  const current = () => {
    const s = el.current;
    if (!s) return rest.current;
    const t = getComputedStyle(s).transform;
    return rest.current + (t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0);
  };
  const settled = (to: Stop) => {
    const g = geom.current;
    const cover = to === 'peek' || to === 'half' || latest.current.side ? g.h - g.y[to] : 0;
    const rect = el.current?.getBoundingClientRect();
    latest.current.onRest?.(latest.current.side
      ? { bottom: 0, right: to === 'peek' ? 0 : Math.round(rect?.width ?? 0) }
      : { bottom: cover, right: 0 }, to);
    if (to !== 'full' && body.current) body.current.scrollTop = 0;
  };
  // Move to a stop: a transform eased from where it is, then at rest there.
  // One move at a time: a newer move, a press or a commit retires the last
  // (the cancel event of a retired transition arrives late, so moves are
  // told apart by a counter, not by their listeners), and a timer finishes
  // a move whose transitionend never comes.
  const move = useRef<{ n: number; finish: () => void } | null>(null);
  const moves = useRef(0);
  const go = (to: Stop, ms = 420) => {
    const s = el.current;
    if (!s) return;
    shown.current = to;
    const n = ++moves.current;
    const y = geom.current.y[to];
    const from = current();
    if (reduced.current?.matches || Math.abs(from - y) < 1) { move.current = null; commit(y); settled(to); return; }
    s.style.transition = 'none';
    s.style.transform = `translateY(${from - rest.current}px)`;
    void s.offsetHeight;                       // start from there
    s.style.transition = `transform ${ms}ms ${EASE}`;
    s.style.transform = `translateY(${y - rest.current}px)`;
    const finish = () => {
      if (moves.current !== n || drag.current?.on) return;
      move.current = null;
      commit(geom.current.y[to]);
      settled(to);
    };
    move.current = { n, finish };
    setTimeout(finish, ms + 100);
  };
  useEffect(() => {
    const s = el.current;
    if (!s) return;
    const end = (e: TransitionEvent) => { if (e.target === s && e.propertyName === 'transform') move.current?.finish(); };
    s.addEventListener('transitionend', end);
    return () => s.removeEventListener('transitionend', end);
  }, []);
  const moving = () => move.current !== null;

  // First placement, and again whenever the band, the head or the visible
  // area changes size (the keyboard, a rotation, the hint going): at rest
  // on the stop, without motion.
  useLayoutEffect(() => {
    const refit = () => {
      geom.current = measure();
      // A finger on it keeps it; one in flight goes on to the new place.
      if (drag.current) return;
      if (moving()) { go(shown.current, 240); return; }
      commit(geom.current.y[shown.current]);
      settled(shown.current);
    };
    refit();
    const ro = new ResizeObserver(refit);
    if (head.current) ro.observe(head.current);
    const band = document.querySelector('.band');
    if (band) ro.observe(band);
    ro.observe(document.documentElement);
    window.visualViewport?.addEventListener('resize', refit);
    return () => { ro.disconnect(); window.visualViewport?.removeEventListener('resize', refit); };
    // Measured once mounted; side changes the sheet's width.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side]);

  // The stop, as the app sets it.
  useEffect(() => {
    // Already there or on its way (a drag's release sets both).
    if (stop === shown.current || drag.current?.on) return;
    go(stop, 360);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop]);

  // Focus moves into the sheet when it opens to full (FIND puts it on its
  // field itself), and out of the body once it is lowered to peek.
  useEffect(() => {
    const s = el.current;
    if (!s) return;
    if (stop === 'full' && !s.contains(document.activeElement)) body.current?.focus({ preventScroll: true });
    if (stop === 'peek' && body.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }, [stop]);

  // Back drops it to peek: one history entry while it is above peek,
  // never more than one.
  const pushed = useRef(false);
  const skipPop = useRef(false);
  useEffect(() => {
    if (stop !== 'peek' && !pushed.current) {
      history.pushState({ ...(history.state ?? {}), orrerySheet: true }, '');
      pushed.current = true;
    } else if (stop === 'peek' && pushed.current) {
      pushed.current = false;
      if (history.state?.orrerySheet) { skipPop.current = true; history.back(); }
    }
  }, [stop]);
  useEffect(() => {
    const onPop = () => {
      if (skipPop.current) { skipPop.current = false; return; }
      if (pushed.current) { pushed.current = false; latest.current.onStop('peek'); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ---- the drag ------------------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return;
    const t = e.target as Element;
    // A source tag or a form control takes its own press; the body drags
    // only below full, where it does not scroll.
    if (t.closest('input, select, textarea, .src-tag, .tag-pop')) return;
    if (body.current?.contains(t) && shown.current === 'full') return;
    drag.current = { id: e.pointerId, y0: e.clientY, from: current(), on: false, samples: [[e.timeStamp, e.clientY]], moved: false };
    // A press on a moving sheet catches it where it is.
    if (el.current && moving()) {
      moves.current++;
      move.current = null;
      const y = drag.current.from;
      el.current.style.transition = 'none';
      el.current.style.transform = `translateY(${y - rest.current}px)`;
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y0;
    if (!d.on) {
      if (Math.abs(dy) < SLOP) return;
      d.on = true;
      d.moved = true;
      // Captured only now, so a tap still clicks what it lands on.
      el.current?.setPointerCapture(e.pointerId);
      el.current?.classList.add('dragging');
    }
    // Every sample the browser coalesced into this event, for the speed.
    const all = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const c of all.length ? all : [e.nativeEvent]) d.samples.push([c.timeStamp, c.clientY]);
    if (d.samples.length > 12) d.samples.splice(0, d.samples.length - 12);
    const g = geom.current;
    let y = d.from + dy;
    // Resistance past the end stops: it gives, less the further it goes.
    if (y < g.y.full) y = g.y.full - 48 * Math.log1p((g.y.full - y) / 48);
    if (y > g.y.peek) y = g.y.peek + 48 * Math.log1p((y - g.y.peek) / 48);
    if (el.current) el.current.style.transform = `translateY(${y - rest.current}px)`;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    el.current?.classList.remove('dragging');
    if (!d.on) {
      // A press that caught a moving sheet and did not drag: let it go on.
      if (Math.abs(current() - geom.current.y[shown.current]) >= 1) go(shown.current, 300);
      return;
    }
    // The click that ends a drag is not a tap.
    clickEaten.current = true;
    setTimeout(() => { clickEaten.current = false; }, 0);
    // The release speed from the last ~80 ms, px/ms, down positive.
    const s = d.samples, last = s[s.length - 1];
    // A busy page delivers moves late and bunched: with no earlier sample
    // in the window, the one before the last still gives the speed.
    let first = s.find(([t]) => last[0] - t < 80) ?? s[0];
    if (first === last && s.length > 1) first = s[s.length - 2];
    // A finger that came to rest before it lifted throws nothing.
    const v = e.timeStamp - last[0] > 80 || last[0] <= first[0] ? 0 : (last[1] - first[1]) / (last[0] - first[0]);
    const y = current();
    const g = geom.current;
    const projected = y + v * PROJECT;
    let to = ORDER.reduce((a, b) => (Math.abs(g.y[b] - projected) < Math.abs(g.y[a] - projected) ? b : a));
    // A flick moves on at least one stop from where it was let go.
    if (Math.abs(v) > FLING) {
      const here = ORDER.reduce((a, b) => (Math.abs(g.y[b] - y) < Math.abs(g.y[a] - y) ? b : a));
      const i = ORDER.indexOf(here), step = v < 0 ? 1 : -1;
      if (to === here && ORDER[i + step]) to = ORDER[i + step];
    }
    shown.current = to;
    go(to, Math.round(Math.min(480, Math.max(260, 420 - Math.abs(v) * 120))));
    if (to !== stop) latest.current.onStop(to);
  };
  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    el.current?.classList.remove('dragging');
    go(shown.current, 300);
  };

  // A tap on the peek toggles peek and half (from full, to half).
  const onHeadClick = (e: ReactMouseEvent) => {
    if ((e.target as Element).closest('button, a, input, select, .tag-pop')) return;
    latest.current.onStop(stop === 'peek' ? 'half' : stop === 'half' ? 'peek' : 'half');
  };
  // Focus that lands below what half shows (Tab from the console's tabs:
  // the body does not scroll at half) opens the sheet fully, and the
  // control is scrolled into view once it has settled (WCAG 2.4.11).
  const onBodyFocus = (e: ReactFocusEvent) => {
    if (stop !== 'half') return;
    const t = e.target as HTMLElement;
    const r = t.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    if (r.top >= 0 && r.bottom <= vh) return;
    onStop('full');
    window.setTimeout(() => { if (document.activeElement === t) t.scrollIntoView({ block: 'nearest' }); }, reduced.current?.matches ? 0 : 500);
  };
  const step = (dir: 1 | -1) => {
    const i = ORDER.indexOf(stop) + dir;
    if (ORDER[i]) onStop(ORDER[i]);
  };

  return (
    <section ref={el} className={`sheet${side ? ' side' : ''}`} data-stop={stop} aria-label={label}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
      onClickCapture={(e) => { if (clickEaten.current) { e.stopPropagation(); e.preventDefault(); } }}>
      {/* The view plate (FOLLOW, CENTRE, HOME) rides just above the sheet's top. */}
      <div className="sheet-above" ref={aboveRef} />
      <div className="sheet-head" ref={head} onClick={onHeadClick}>
        <button type="button" className="sheet-latch" aria-controls={bodyId} aria-expanded={stop !== 'peek'}
          aria-label={`${label}: ${WORD[stop]}`} title="Drag, or press to raise and lower (Up and Down arrows step)"
          onClick={(e) => {
            e.stopPropagation();
            onStop(stop === 'full' ? 'peek' : ORDER[ORDER.indexOf(stop) + 1]);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') { step(1); e.preventDefault(); } else if (e.key === 'ArrowDown') { step(-1); e.preventDefault(); }
          }}>
          <span className="latch-bar" aria-hidden="true" />
        </button>
        {peek}
      </div>
      <div className="sheet-body" id={bodyId} ref={body} tabIndex={-1} inert={stop === 'peek' || undefined} onFocus={onBodyFocus}>
        {children}
      </div>
      <span className="sheet-safe" ref={safe} aria-hidden="true" />
    </section>
  );
}
