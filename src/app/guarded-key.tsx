// src/app/guarded-key.tsx
//
// A key for an action that can't be taken back (removing a craft, a
// stage): the first press arms it, and the key turns caution yellow and asks
// to confirm; a second press acts, and Keep or Esc stands it down. As real
// panels guard such commands, without slowing the action beyond what it
// needs (DESIGN.md, What real panels do).

import { useEffect, useState } from 'react';

export function GuardedKey({ label, confirm, onConfirm, className = 'key', ariaLabel, disabled = false }: {
  label: string; confirm: string; onConfirm: () => void; className?: string; ariaLabel?: string; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    // First Escape stands it down; the console stays open (App skips a prevented Escape).
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setArmed(false); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [armed]);
  if (!armed) return <button className={className} aria-label={ariaLabel} disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
  return (
    <span className="guarded" role="group" aria-label={confirm}>
      <button className={`${className} arm`} aria-pressed="true" onClick={() => { setArmed(false); onConfirm(); }}>{confirm}</button>
      <button className={className} onClick={() => setArmed(false)} autoFocus>Keep</button>
    </span>
  );
}
