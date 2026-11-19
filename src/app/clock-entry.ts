// src/app/clock-entry.ts
//
// Typing the clock (panels.tsx, ClockWindow): what a person types, read as
// UTC, and the arrow keys stepping the part of it under the caret. Kept out
// of the component so it can be checked in Node (clock-entry.test.mjs).
//
// Accepted, always UTC (a trailing Z or UTC is allowed, any other offset
// is not):
//   2027-08-02 10:06:30   2027-08-02T10:06Z   2027-8-2 9:05
//   2027-08-02            midnight that day
//   10:06 or 10:06:30     that time on the clock's own day

// The parts of formatUtc's text, by character: [start, end, unit].
export const FIELDS = [
  [0, 4, 'year'], [5, 7, 'month'], [8, 10, 'day'], [11, 13, 'hour'], [14, 16, 'minute'], [17, 19, 'second'],
] as const;
export type Unit = (typeof FIELDS)[number][2];

const UNIT_MS: Record<Exclude<Unit, 'year' | 'month'>, number> = { day: 86400e3, hour: 3600e3, minute: 60e3, second: 1e3 };

// The clock's own text: 2027-08-02 10:06:30.
export const formatUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// The instant typed, in UTC ms, or null if it isn't a date and time.
export function parseUtc(text: string, baseMs: number): number | null {
  const parts = text.trim().replace(/\s*(?:z|utc)$/i, '').split(/[T\s]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  let date: RegExpExecArray | null = null, time: RegExpExecArray | null = null;
  for (const p of parts) {
    const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(p);
    const t = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(p);
    if (d && !date && !time) date = d;
    else if (t && !time) time = t;
    else return null;
  }
  const base = new Date(baseMs);
  const y = date ? Number(date[1]) : base.getUTCFullYear();
  const mo = date ? Number(date[2]) : base.getUTCMonth() + 1;
  const d = date ? Number(date[3]) : base.getUTCDate();
  const h = time ? Number(time[1]) : 0, mi = time ? Number(time[2]) : 0, s = time?.[3] ? Number(time[3]) : 0;
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  // 31 February and the like roll into the next month: refuse them.
  return new Date(ms).getUTCDate() === d ? ms : null;
}

// The part of formatUtc's text the caret is in (or touches).
export function unitAt(caret: number): number {
  const i = FIELDS.findIndex(([a, b]) => caret >= a && caret <= b);
  return i < 0 ? FIELDS.length - 1 : i;
}

// The arrow keys: the part under the caret stepped by delta (a month keeps
// its day where it can: 31 January plus a month is 28 or 29 February).
// Null if the text isn't a date and time.
export function stepAt(text: string, caret: number, delta: number, baseMs: number): { ms: number; text: string; sel: [number, number] } | null {
  const ms0 = parseUtc(text, baseMs);
  if (ms0 === null) return null;
  const i = unitAt(caret), [a, b, unit] = FIELDS[i];
  let ms: number;
  if (unit === 'year' || unit === 'month') {
    const t = new Date(ms0);
    const y = t.getUTCFullYear() + (unit === 'year' ? delta : 0), m = t.getUTCMonth() + (unit === 'month' ? delta : 0);
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    ms = Date.UTC(y, m, Math.min(t.getUTCDate(), last), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds());
  } else {
    ms = ms0 + delta * UNIT_MS[unit];
  }
  return { ms, text: formatUtc(ms), sel: [a, b] };
}
