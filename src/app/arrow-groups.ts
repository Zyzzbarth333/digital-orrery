// src/app/arrow-groups.ts
//
// Arrow keys inside a radio group or a tab list, as the WAI-ARIA Authoring
// Practices have them: the arrows move to the next or previous radio (all
// four) or tab (left and right) and choose it, wrapping at the ends, and
// Home and End go to the first and last. One listener on the document for
// every group in the console (the RUN and HOLD keys, the TYPE keys, the
// flight console's tabs, the plotting table's stations and the panels'
// latching keys), rather than a handler in each. It marks the key handled,
// so App.tsx's arrow shortcuts (the rate, the next body) leave it alone.

const NEXT: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target instanceof HTMLElement ? e.target : null;
  const role = t?.getAttribute('role');
  if (!t || (role !== 'radio' && role !== 'tab')) return;
  if (role === 'tab' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
  if (!(e.key in NEXT) && e.key !== 'Home' && e.key !== 'End') return;
  const group = t.closest(role === 'radio' ? '[role=radiogroup]' : '[role=tablist]');
  if (!group) return;
  const items = [...group.querySelectorAll<HTMLElement>(`[role=${role}]`)]
    .filter((x) => !(x as HTMLButtonElement).disabled && x.closest(role === 'radio' ? '[role=radiogroup]' : '[role=tablist]') === group);
  const i = items.indexOf(t);
  if (i < 0 || items.length < 2) return;
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + NEXT[e.key] + items.length) % items.length;
  e.preventDefault();
  items[j].focus();
  // Choosing follows focus, as a radio's does.
  if (items[j].getAttribute(role === 'radio' ? 'aria-checked' : 'aria-selected') !== 'true') items[j].click();
}

export function installArrowGroups(): () => void {
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
