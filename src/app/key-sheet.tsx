// src/app/key-sheet.tsx
//
// The ? sheet: every keyboard shortcut App.tsx handles, in a small readout
// window drawn over everything (styled as the source tags' detail). ? or
// Escape closes it, as does a press outside it or its Close key; focus
// goes back to where it was.

import { useEffect, useRef } from 'react';

export const SHORTCUTS: [string[], string][] = [
  [['Space'], 'Run or hold time'],
  [['←', '→'], 'Slower or faster rate'],
  [['↑', '↓'], 'The body before or after in the rail'],
  [['N'], 'Jump to now'],
  [['M'], 'Open or close the flight console'],
  [['H'], 'Home: back to the opening view'],
  [['C'], 'Centre the view on the focus after a pan'],
  [['/'], 'Find any body, satellite or spacecraft'],
  [['+', '−'], 'Larger or smaller type (the rail foot\'s TYPE keys)'],
  [['↑', '↓', 'Enter'], 'In FIND: move through the matches, fly to the marked one'],
  [['Esc'], 'Stop a flight, close a list, then the console'],
  [['?'], 'Show or hide these keys'],
];

// Elements that open and close the sheet themselves (the rail foot's key):
// a press on one is not a press outside.
export const KEYS_TOGGLE = 'data-keys-toggle';

export function KeySheet({ onClose }: { onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus();
    // Captured, so the first Escape closes the sheet, not a flight or the console.
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (e.key === 'Escape' || (e.key === '?' && !typing)) { e.preventDefault(); e.stopPropagation(); close.current(); }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!sheet.current?.contains(t) && !t.closest?.(`[${KEYS_TOGGLE}]`)) close.current();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
      // Focus left with the sheet (not moved by a press elsewhere): put it back.
      const now = document.activeElement;
      if (back?.isConnected && (!now || now === document.body)) back.focus();
    };
  }, []);
  return (
    <div ref={sheet} className="tag-pop key-sheet" role="dialog" aria-labelledby="key-sheet-title" tabIndex={-1}>
      <div className="tag-pop-head">
        <span className="tag-pop-kind" id="key-sheet-title">Keys</span>
        <button className="key small" onClick={() => close.current()}>Close</button>
      </div>
      <dl className="key-list">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys.join()}>
            <dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className="tag-pop-note">Ignored while typing in a field. Drag to turn the view; scroll to zoom.</p>
    </div>
  );
}
