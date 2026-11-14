// src/app/craft-state.js
//
// A craft's state in one word, for the header's FLIGHT field, and whether
// it is lost, for the annunciator's WARN light. One rule for both, so the
// header and the light never disagree: a craft that came down under its
// chutes (craft.js sets `splashed`) ended its flight as planned and is
// DOWN; one that hit the ground any other way is LOST. Pure: no DOM.

/** A craft that crashed (not a planned splashdown). */
export const craftLost = (c) => !!c.crashed && !c.splashed;

/** A craft that needs the WARN light: lost, or refused by the kernel. */
export const craftWarns = (c) => craftLost(c) || !!c.error;

/**
 * The header's word for a craft.
 * @param {{ crashed?: boolean, splashed?: boolean, error?: string | null }} c
 * @param {{ climbing?: boolean, burning?: boolean }} [now]
 * @returns {'Climb' | 'Down' | 'Lost' | 'Fault' | 'Burn' | 'Coast'}
 */
export function craftStateWord(c, { climbing = false, burning = false } = {}) {
  if (climbing) return 'Climb';
  if (c.crashed) return c.splashed ? 'Down' : 'Lost';
  if (c.error) return 'Fault';
  return burning ? 'Burn' : 'Coast';
}
