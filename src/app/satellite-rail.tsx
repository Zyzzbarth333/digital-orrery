// src/app/satellite-rail.tsx
//
// The rail's satellites section (src/scene/satellites.ts): a switch for
// each set (the active satellites, the debris clouds, the rocket bodies
// and the analyst objects), the named ones and the debris clouds to fly
// to, the key that asks CelesTrak for its latest element sets for the
// active ones, and one to the ISS's passes over a place
// (satellite-passes.tsx). Any loaded one is found by name, NORAD catalogue
// number or international designator from the rail's FIND field (find.tsx).
//
// Each set loads its data the first time it is switched on: the active
// satellites 2.5 MB (0.9 MB compressed), the rest 0.8 MB together.

import { useState } from 'react';
import { SAT_GROUPS, SAT_LAYERS, layerColour, type NamedSat, type SatSource, type SatCloud, type SatLayerKey } from '../scene/satellites';

export interface SatelliteApi {
  layers: Record<SatLayerKey, boolean>;
  setLayer: (k: SatLayerKey, on: boolean) => void;
  named: readonly NamedSat[];
  source: SatSource | null;
  current: number | null;
  clouds: readonly SatCloud[];
  cloud: string | null;
  fly: (id: number) => void;
  flyCloud: (key: string) => void;
  latest: () => Promise<string>;
}

// The ISS (Zarya), whose passes the Passes key shows when no satellite is in view.
const ISS = 25544;
const day = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export function SatelliteRail({ api }: { api: SatelliteApi }) {
  const [status, setStatus] = useState('');
  const [asking, setAsking] = useState(false);
  const any = SAT_LAYERS.some((l) => api.layers[l.key]);
  const pick = api.cloud !== null ? `cloud:${api.cloud}` : api.current ?? '';
  return (
    <>
      <h2 className="strip split"><span>Satellites</span><span title="shown">On</span></h2>
      <ul className="body-list small-bodies">
        {SAT_LAYERS.map((l) => (
          <li key={l.key}>
            <button className="body-row" role="switch" aria-checked={api.layers[l.key]} onClick={() => api.setLayer(l.key, !api.layers[l.key])} title={l.hint}>
              <span className="lamp-sq" style={{ background: api.layers[l.key] ? layerColour(l.key) : 'transparent', borderColor: layerColour(l.key) }} />
              <span>{l.label}</span>
              <span className="dist">{api.layers[l.key] ? 'on' : 'off'}</span>
            </button>
          </li>
        ))}
      </ul>
      {any && api.source && (
        <>
          <p className="sat-source" title={`${api.source.label}, fetched ${api.source.fetched} UTC`}>
            <span className="tag">CelesTrak</span> {api.source.live ? 'live' : 'snapshot'} {day(api.source.fetched)} UTC
          </p>
          <label className="sb-pick">
            <span className="engraved">Fly to</span>
            <select className="input select" value={pick} onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('cloud:')) api.flyCloud(v.slice(6));
              else if (v) api.fly(Number(v));
            }}>
              <option value="">a named one…</option>
              {api.layers.debris && api.clouds.length > 0 && (
                <optgroup label="Debris clouds">
                  {api.clouds.map((c) => <option key={c.key} value={`cloud:${c.key}`}>{c.name} ({c.date.slice(0, 4)})</option>)}
                </optgroup>
              )}
              {SAT_GROUPS.map((g) => {
                const list = api.named.filter((n) => n.group === g.key && api.layers[n.layer ?? 'active']);
                return list.length ? <optgroup key={g.key} label={g.label}>{list.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</optgroup> : null;
              })}
            </select>
          </label>
          {api.layers.active && (
            <div className="sat-live">
              <button className="key small" disabled={asking} onClick={() => {
                setAsking(true);
                void api.latest().then(setStatus, (err) => setStatus(`Not fetched: ${err instanceof Error ? err.message : err}`)).finally(() => setAsking(false));
              }} title="Fetch CelesTrak's current element sets for every active satellite (2.5 MB), at most once every 2 hours: they change no more often. The debris, rocket bodies and analyst objects stay the snapshot's">Latest</button>
              <button className="key small" onClick={() => api.fly(api.current ?? ISS)}
                title="Its passes over a place, on its plate: the ISS, or the satellite in view">Passes</button>
              <span role="status">{asking ? 'Asking CelesTrak…' : status}</span>
            </div>
          )}
        </>
      )}
    </>
  );
}
