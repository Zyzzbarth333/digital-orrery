// src/app/trajbrowser-panel.tsx
//
// NASA's Trajectory Browser in the PLANNER tab. NASA Ames's Mission Design
// Division publishes the lowest-delta-v transfers to each planet
// (https://trajbrowser.arc.nasa.gov); public/trajbrowser/planets.json holds
// them for 2026-2040 (src/physics/trajbrowser.fetch.mjs). Beside each, our
// own transfer between the same two dates (src/physics/trajsearch.js: the
// Lambert arc, up to two revolutions, with NASA's conventions), so the two
// can be compared. A row can set the porkchop to its window, or be flown.
//
// The browser cannot be queried from a page (it answers only its own form
// posts and sends no cross-origin headers), so "Open on NASA's site" posts
// the same search to it in a new tab.

import { useEffect, useMemo, useRef, useState } from 'react';
import { transfer } from '../physics/trajsearch.js';
import { helioStateEcl } from '../physics/ephemeris.js';

export interface TbTransfer { depMs: number; arrMs: number; c3: number; injectionDv: number; postDv: number; route: string }
interface TbBody { spk: number; muKm3s2: number; radiusKm: number; rPeriKm: number }
interface TbData { source: string; url: string; fetched: string; years: [number, number]; bodies: Record<string, { body?: TbBody; rendezvous: TbTransfer[]; flyby: TbTransfer[] }> }
interface Ours { totalDv: number; c3: number; revs: number; edge?: boolean }

const DAY_MS = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmt = (n: number, d = 2) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
// NASA's route letters for each destination.
const LETTER: Record<string, string> = { mercury: 'Me', venus: 'V', mars: 'M', jupiter: 'J', saturn: 'S', uranus: 'U', neptune: 'N' };
// NASA's Earth (from its own pages): GM, and the 200 km parking orbit.
const TB_EARTH = { mu: 398600.4418, rPark: 6371 + 200 };

export function TrajBrowserPanel({ dest, destName, tof, onWindow, onFly }: {
  dest: string; destName: string; tof: [number, number];
  onWindow: (startMs: number, spanDays: number) => void;
  onFly: (depMs: number, arrMs: number) => void;
}) {
  const [data, setData] = useState<TbData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'rendezvous' | 'flyby'>('rendezvous');
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}trajbrowser/planets.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => setSel(null), [dest, kind]);

  const entry = data?.bodies[dest];
  const list = useMemo(() => (entry ? entry[kind] : []), [entry, kind]);
  // Ours: the transfer between NASA's own two dates, with NASA's constants
  // for the destination. Only for a direct route (ours has no gravity
  // assists yet).
  const direct = (t: TbTransfer) => t.route === `E${LETTER[dest]}`;
  // A flight time just under a multi-revolution family's minimum has no
  // such transfer here, though it has in NASA's ephemeris (Mars 2026-03-13:
  // 654.3 d against our 1-revolution minimum of 654.5 d), so the direct arc
  // is all that is left and it is absurd. Such a row is compared one day
  // longer, as trajsearch.test.mjs does, and says so.
  const oursFor = (t: TbTransfer): Ours | null => {
    if (!entry?.body || !direct(t)) return null;
    const o = { stateOf: helioStateEcl, muSun: 132712440018, to: dest, kind, departure: TB_EARTH, arrival: { mu: entry.body.muKm3s2, rPeri: entry.body.rPeriKm } };
    const days = (t.arrMs - t.depMs) / DAY_MS, dv = t.injectionDv + t.postDv;
    const a = transfer(o, t.depMs, days);
    if (a && Math.abs(a.totalDv / dv - 1) <= 0.2) return a;
    const b = transfer(o, t.depMs, days + 1);
    return b && b.revs > 0 && Math.abs(b.totalDv / dv - 1) < 0.05 ? { ...b, edge: true } : a;
  };

  // Post the same search to NASA's site in a new tab.
  const form = useRef<HTMLFormElement>(null);

  if (error) return <p className="hint">NASA's Trajectory Browser data did not load ({error}).</p>;
  if (!data) return <p className="hint">Loading NASA's Trajectory Browser data…</p>;
  const shown = list.slice().sort((a, b) => a.injectionDv + a.postDv - (b.injectionDv + b.postDv)).slice(0, 8).sort((a, b) => a.depMs - b.depMs);
  const picked = sel !== null ? shown[sel] : null;

  return (
    <details className="section" open>
      <summary className="strip">NASA Trajectory Browser</summary>
      <div className="keys-row" role="radiogroup" aria-label="Mission type">
        <button className="key" role="radio" aria-checked={kind === 'rendezvous'} onClick={() => setKind('rendezvous')}>Rendezvous</button>
        <button className="key" role="radio" aria-checked={kind === 'flyby'} onClick={() => setKind('flyby')}>Flyby</button>
      </div>
      {shown.length === 0 ? <p className="hint">NASA lists no {kind} transfers to {destName} for {data.years[0]}–{data.years[1]}.</p> : (
        <table className="tb-table">
          <thead><tr><th>Launch</th><th>Days</th><th>Route</th><th title="total delta-v from a 200 km LEO, NASA's figure">NASA Δv</th><th title="our Lambert transfer between the same dates, NASA's conventions">Ours</th></tr></thead>
          <tbody>
            {shown.map((t, i) => {
              const o = oursFor(t), dv = t.injectionDv + t.postDv;
              return (
                <tr key={t.depMs + t.route} aria-selected={sel === i} onClick={() => setSel(i)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSel(i); }}>
                  <td>{iso(t.depMs)}</td>
                  <td>{Math.round((t.arrMs - t.depMs) / DAY_MS)}</td>
                  <td>{t.route}</td>
                  <td>{fmt(dv, 3)}</td>
                  <td title={o ? `ours ${o.edge ? 'one day longer' : 'between the same dates'}: C3 ${fmt(o.c3, 2)} km²/s²${o.revs ? `, ${o.revs} revolution${o.revs > 1 ? 's' : ''} round the Sun` : ''}${o.edge ? '; NASA\'s flight time is just under our minimum for that many revolutions (the ephemerides differ)' : ''}` : direct(t) ? 'no Lambert arc between these exact dates (see the docs)' : 'gravity assist: not in our solver yet'}>{o ? `${fmt(o.totalDv, 3)} (${o.totalDv >= dv ? '+' : ''}${fmt((o.totalDv / dv - 1) * 100, 1)} %)${o.edge ? ' +1 d' : ''}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {picked && (
        <div className="keys-row wrap">
          <button className="key" onClick={() => onWindow(picked.depMs - 60 * DAY_MS, 120)}>Show on the grid</button>
          <button className="key primary" onClick={() => onFly(picked.depMs, picked.arrMs + (oursFor(picked)?.edge ? DAY_MS : 0))}>Fly NASA's dates</button>
          <span className="hint">Flies our Lambert arc between NASA's dates; jumps the clock (BACK undoes it)</span>
        </div>
      )}
      <p className="hint">
        {kind === 'rendezvous' ? `Rendezvous Δv brakes to escape speed at ${fmt((entry?.body?.rPeriKm ?? 0) - (entry?.body?.radiusKm ?? 0), 0)} km, NASA's convention (the grid above captures into a 400 km circle). ` : 'Flyby: no arrival burn. '}
        The lowest eight of {list.length}, from NASA Ames's Trajectory Browser, fetched {data.fetched}.
      </p>
      <form ref={form} method="post" action={data.url} target="_blank" rel="noopener">
        {Object.entries({ maxMag: '25', maxOCC: '4', chk_target_list: 'on', target_list: destName, mission_class: 'oneway', mission_type: kind, LD1: String(data.years[0]), LD2: String(data.years[1]), maxDT: String((data as unknown as { limits: Record<string, number[]> }).limits?.[destName]?.[0] ?? 12), DTunit: 'yrs', maxDV: String((data as unknown as { limits: Record<string, number[]> }).limits?.[destName]?.[1] ?? 20), min: 'DV', wdw_width: '365', submit: 'Search' })
          .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <button className="key" type="submit">Open on NASA's site</button>
      </form>
    </details>
  );
}
