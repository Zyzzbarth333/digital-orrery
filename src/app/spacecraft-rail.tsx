// src/app/spacecraft-rail.tsx
//
// The rail's "Beyond Earth" section (src/scene/spacecraftLayer.ts): the
// switch for the spacecraft JPL Horizons places, and the list to fly to
// one, by where it is. Its data (an index, then a month at a time, 0.1 to
// 1 MB) loads the first time it is switched on.

import { PROBE_GROUPS, type Probe } from '../scene/spacecraftLayer';
import { RailGroup } from './panels';

export interface SpacecraftApi {
  on: boolean;
  setOn: (on: boolean) => void;
  craft: readonly Probe[];
  fetched: string | null;
  current: string | null;
  fly: (key: string) => void;
}

export function SpacecraftRail({ api }: { api: SpacecraftApi }) {
  return (
    <RailGroup title="Beyond Earth" note={api.on ? 'Spacecraft shown' : 'none shown'}>
      <ul className="body-list small-bodies">
        <li>
          <button className="body-row" role="switch" aria-checked={api.on} onClick={() => api.setOn(!api.on)}
            title="Working spacecraft at Mercury, the Moon, Mars and Jupiter, near the Sun-Earth L1 and L2 points, and in cruise, where JPL Horizons places them">
            <span className="lamp-sq" style={{ background: api.on ? 'var(--phosphor)' : 'transparent', borderColor: 'var(--phosphor)' }} />
            <span>Spacecraft</span>
            <span className="dist">{api.on ? 'on' : 'off'}</span>
          </button>
        </li>
      </ul>
      {api.on && api.fetched && (
        <>
          <p className="sat-source" title={`JPL Horizons trajectories for 2026 and 2027, fetched ${api.fetched.slice(0, 16).replace('T', ' ')} UTC`}>
            <span className="tag">Horizons</span> 2026–2027, fetched {api.fetched.slice(0, 10)}
          </p>
          <label className="sb-pick">
            <span className="engraved">Fly to</span>
            <select className="input select" value={api.current ?? ''} onChange={(e) => { if (e.target.value) api.fly(e.target.value); }}>
              <option value="">a spacecraft…</option>
              {PROBE_GROUPS.map((g) => {
                const list = api.craft.filter((c) => c.group === g.key && c.days > 0);
                return list.length ? <optgroup key={g.key} label={g.label}>{list.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</optgroup> : null;
              })}
            </select>
          </label>
        </>
      )}
    </RailGroup>
  );
}
