// src/app/satellite-rail.tsx
//
// The rail's satellites section (src/scene/satellites.ts): the switch for
// the whole layer, the named ones to fly to, a search over every one by
// name, NORAD catalogue number or international designator, and the key
// that asks CelesTrak for its latest element sets, and one to the ISS's
// passes over a place (satellite-passes.tsx).
//
// The layer loads its data (2.5 MB, 0.9 MB compressed) the first time it is
// switched on.

import { useState } from 'react';
import { SmallBodySearch, type SmallSearch } from './small-body-search';
import { SAT_GROUPS, type NamedSat, type SatSource } from '../scene/satellites';

export interface SatelliteApi {
  on: boolean;
  setOn: (on: boolean) => void;
  named: readonly NamedSat[];
  source: SatSource | null;
  current: number | null;
  fly: (id: number) => void;
  search: SmallSearch;
  latest: () => Promise<string>;
}

// The ISS (Zarya), whose passes the Passes key shows when no satellite is in view.
const ISS = 25544;
const day = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export function SatelliteRail({ api }: { api: SatelliteApi }) {
  const [status, setStatus] = useState('');
  const [asking, setAsking] = useState(false);
  const count = api.search.count;
  return (
    <>
      <h2 className="strip split"><span>Satellites</span><span title="shown">On</span></h2>
      <ul className="body-list small-bodies">
        <li>
          <button className="body-row" role="switch" aria-checked={api.on} onClick={() => api.setOn(!api.on)}
            title="Every active satellite CelesTrak lists, moved by SGP4; the named ones with their orbits. Dimmer in the Earth's shadow">
            <span className="lamp-sq" style={{ background: api.on ? 'var(--phosphor)' : 'transparent', borderColor: 'var(--phosphor)' }} />
            <span>All active</span>
            <span className="dist">{api.on ? 'on' : 'off'}</span>
          </button>
        </li>
      </ul>
      {api.on && api.source && (
        <>
          <p className="sat-source" title={`${api.source.label}, fetched ${api.source.fetched} UTC`}>
            <span className="tag">CelesTrak</span> {api.source.live ? 'live' : 'snapshot'} {day(api.source.fetched)} UTC
          </p>
          <label className="sb-pick">
            <span className="engraved">Fly to</span>
            <select className="input select" value={api.current ?? ''} onChange={(e) => { if (e.target.value) api.fly(Number(e.target.value)); }}>
              <option value="">a named one…</option>
              {SAT_GROUPS.map((g) => {
                const list = api.named.filter((n) => n.group === g.key);
                return list.length ? <optgroup key={g.key} label={g.label}>{list.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</optgroup> : null;
              })}
            </select>
          </label>
          <SmallBodySearch api={api.search} label={`Search all ${count.toLocaleString('en-AU')}`} placeholder="ISS, 25544, 1998-067A" />
          <div className="sat-live">
            <button className="key small" disabled={asking} onClick={() => {
              setAsking(true);
              void api.latest().then(setStatus, (err) => setStatus(`Not fetched: ${err instanceof Error ? err.message : err}`)).finally(() => setAsking(false));
            }} title="Fetch CelesTrak's current element sets for every active satellite (2.5 MB), at most once every 2 hours: they change no more often">Latest</button>
            <button className="key small" onClick={() => api.fly(api.current ?? ISS)}
              title="Its passes over a place, on its plate: the ISS, or the satellite in view">Passes</button>
            <span role="status">{asking ? 'Asking CelesTrak…' : status}</span>
          </div>
        </>
      )}
    </>
  );
}
