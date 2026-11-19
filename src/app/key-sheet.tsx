// src/app/key-sheet.tsx
//
// The ? sheet: every keyboard shortcut App.tsx handles, in a small readout
// window drawn over everything (styled as the source tags' detail). ? or
// Escape closes it, as does a press outside it or its Close key; focus
// goes back to where it was. Its switch turns the single-key shortcuts off
// and on (shortcuts.ts).

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { shortcuts } from './shortcuts';

export const SHORTCUTS: [string[], string][] = [
  [['Space'], 'Run or hold time'],
  [['←', '→'], 'Slower or faster rate'],
  [['↑', '↓'], 'The body before or after in the rail'],
  [['N'], 'Jump to now'],
  [['T'], 'Type a date and time (UTC)'],
  [['M'], 'Open or close the flight console'],
  [['L'], 'Pin the bodies rail beside the sky, or stow it to its spine'],
  [['R'], 'Pin the data plate beside the sky, or stow it to its spine'],
  [['H'], 'Home: back to the opening view'],
  [['C'], 'Centre the view on the focus after a pan'],
  [['Shift', '←', '→'], 'Turn the view (or the sky\'s VIEW keys)'],
  [['Shift', '↑', '↓'], 'Tilt the view'],
  [['[', ']'], 'Zoom the view out or in'],
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
  const on = useSyncExternalStore(shortcuts.subscribe, shortcuts.get);
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus();
    // Captured, so the first Escape closes the sheet, not a flight or the console.
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (e.key === 'Escape' || (e.key === '?' && !typing && shortcuts.get())) { e.preventDefault(); e.stopPropagation(); close.current(); }
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
      <div className="key-sheet-switch">
        <span id="shortcuts-label">Single-key shortcuts</span>
        <button type="button" className="key small" role="switch" aria-checked={on} aria-labelledby="shortcuts-label" data-shortcuts-switch
          onClick={() => shortcuts.set(!on)} title={on ? 'Turn the keys above off (Esc still works)' : 'Turn the keys above back on'}>{on ? 'On' : 'Off'}</button>
      </div>
      <p className="tag-pop-note">Ignored while typing in a field. Off, only Esc works; the rail's ? keys button opens this sheet. Drag to turn the view; scroll to zoom.</p>
    </div>
  );
}
