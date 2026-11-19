// src/app/satellite-passes.tsx
//
// The satellite plate's passes over a place: the place (latitude,
// longitude and height, kept in this browser's localStorage), then the
// satellite's next passes over it in the coming three days, each with its
// rise, culmination and set, where in the sky, and whether it can be seen.
// The search runs in a worker (passes.worker.ts, packages/physics/src/passes.js);
// the ground track on the Earth is src/scene/groundTrack.ts.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useClockValue, type SimClock } from './clock';
import { Readout, type Row } from './readout';
import { siteOf, lookAt } from '@digital-orrery/physics/passes.js';
import type { PassRequest } from './passes.worker';
import type { GroundTrack } from '../scene/groundTrack';
import type { PlateSat } from './satellite-plate';

export interface Place { lat: number; lon: number; heightM: number }
interface SkyPoint { t: number; azDeg: number; elDeg: number; rangeKm: number }
interface Pass {
  rise: SkyPoint | null; peak: SkyPoint; set: SkyPoint | null;
  visible: { from: SkyPoint; to: SkyPoint } | null; sunlit: boolean[]; sunElDeg: number; kind: 'visible' | 'daylight' | 'unlit';
}

const PLACE_KEY = 'orrery.passes.place', TRACK_KEY = 'orrery.passes.track';
// The Royal Observatory, Greenwich, until a place is given.
const DEFAULT_PLACE: Place = { lat: 51.4769, lon: -0.0005, heightM: 46 };
const DAYS = 3, BUCKET_MS = 6 * 3600e3, SHOWN = 6;

const valid = (p: Place) => Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && p.lon >= -180 && p.lon <= 360
  && Number.isFinite(p.heightM) && p.heightM >= -500 && p.heightM <= 9000;
function loadPlace(): Place {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null');
    if (p && valid(p)) return { lat: p.lat, lon: p.lon, heightM: p.heightM };
  } catch { /* storage off or unreadable: the default */ }
  return DEFAULT_PLACE;
}
const store = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* storage off: not remembered */ } };
const loadTrack = () => { try { return localStorage.getItem(TRACK_KEY) !== 'off'; } catch { return true; } };

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (az: number) => COMPASS[Math.round(az / 22.5) % 16];
const hms = (t: number) => new Date(t).toISOString().slice(11, 19);
const day = (t: number) => { const s = new Date(t).toUTCString(); return `${s.slice(0, 3)} ${s.slice(5, 11)}`; };
const dir = (p: SkyPoint) => `${p.azDeg.toFixed(0)}° ${compass(p.azDeg)}`;
const latLon = (p: Place) => `${Math.abs(p.lat).toFixed(4)}° ${p.lat < 0 ? 'S' : 'N'}, ${Math.abs(((p.lon + 540) % 360) - 180).toFixed(4)}° ${((p.lon + 540) % 360) - 180 < 0 ? 'W' : 'E'}`;

let worker: Worker | null = null;
let nextId = 1;

export function SatellitePasses({ clock, sat, track }: { clock: SimClock; sat: PlateSat; track: GroundTrack | null }) {
  const [place, setPlace] = useState(loadPlace);
  const [draft, setDraft] = useState(() => ({ lat: String(place.lat), lon: String(place.lon), h: String(place.heightM) }));
  const [trackOn, setTrackOn] = useState(loadTrack);
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [found, setFound] = useState<{ key: string; base: string; passes: Pass[] } | null>(null);
  const [failed, setFailed] = useState('');
  const [locating, setLocating] = useState('');
  const want = useRef('');
  // The clock to the second, and its six-hour bucket: the search covers
  // three days from the bucket's start, so it reruns four times a day of
  // clock, not every frame.
  const nowS = useClockValue(clock, (s) => Math.floor(s.timeMs / 1000));
  const now = nowS * 1000, from = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const id = sat.omm.NORAD_CAT_ID;
  const base = `${id}|${sat.omm.EPOCH}|${place.lat}|${place.lon}|${place.heightM}`, key = `${base}|${from}`;

  useEffect(() => {
    want.current = key;
    worker ??= new Worker(new URL('./passes.worker.ts', import.meta.url), { type: 'module' });
    const w = worker, req = nextId++;
    const onMsg = (e: MessageEvent) => { if (e.data.id === req && want.current === key) { setFound({ key, base, passes: e.data.passes }); setFailed(''); } };
    const onErr = (e: ErrorEvent) => setFailed(e.message || 'the search stopped');
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    const q: PassRequest = { id: req, omm: sat.omm, lat: place.lat, lon: place.lon, heightKm: place.heightM / 1000, fromMs: from, days: DAYS + BUCKET_MS / 86400e3 };
    w.postMessage(q);
    return () => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // The last search for this satellite and place stands until the next
  // six hours' arrives (the passes past are dropped below).
  const passes = found?.base === base ? found.passes : null;
  const ahead = useMemo(() => (passes ?? []).filter((p) => (p.set?.t ?? p.peak.t) > now && (p.rise?.t ?? p.peak.t) < now + DAYS * 86400e3), [passes, now]);
  const next = ahead[0] ?? null;

  // The ground track, with the next pass on it.
  useEffect(() => {
    if (!track) return;
    track.set(trackOn ? sat.rec : null, { lat: place.lat, lon: place.lon, heightKm: place.heightM / 1000 },
      next?.rise && next.set ? { riseMs: next.rise.t, setMs: next.set.t } : null);
  }, [track, trackOn, sat.rec, place, next?.rise?.t, next?.set?.t]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => track?.set(null, null, null), [track]);

  const edit = (k: 'lat' | 'lon' | 'h', v: string) => {
    const d = { ...draft, [k]: v };
    setDraft(d);
    const p = { lat: Number(d.lat), lon: Number(d.lon), heightM: Number(d.h) };
    if (d.lat.trim() && d.lon.trim() && d.h.trim() && valid(p)) { setPlace(p); store(PLACE_KEY, JSON.stringify(p)); }
  };
  const locate = () => {
    if (!('geolocation' in navigator)) { setLocating('This browser has no location'); return; }
    setLocating('Asking the browser…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const c = pos.coords, h = c.altitude ?? place.heightM;
      const p = { lat: Number(c.latitude.toFixed(4)), lon: Number(c.longitude.toFixed(4)), heightM: Math.round(h) };
      setDraft({ lat: String(p.lat), lon: String(p.lon), h: String(p.heightM) });
      setPlace(p); store(PLACE_KEY, JSON.stringify(p));
      setLocating(c.altitude == null ? 'Placed; the browser gave no height' : 'Placed');
    }, (err) => setLocating(`Not placed: ${err.message || 'refused'}`), { enableHighAccuracy: false, timeout: 15000, maximumAge: 600e3 });
  };

  const shown = (visibleOnly ? ahead.filter((p) => p.kind === 'visible') : ahead).slice(0, SHOWN);
  // A satellite that never sets or rises (geostationary): where it is now.
  const stays = passes && !ahead.length ? lookAt(sat.rec, siteOf(place.lat, place.lon, place.heightM / 1000), now) : null;
  const bad = (k: 'lat' | 'lon' | 'h') => {
    const n = Number(draft[k]);
    return !draft[k].trim() || !Number.isFinite(n) || (k === 'lat' ? Math.abs(n) > 90 : k === 'lon' ? n < -180 || n > 360 : n < -500 || n > 9000);
  };
  return (
    <section className="passes" aria-label="Passes over a place">
      <p className="strip split" aria-hidden="true"><span>Passes over</span><span>UTC</span></p>
      <div className="place-grid">
        <label className="num"><span className="engraved" title="Geodetic latitude, north positive">Latitude</span>
          <input className="input" type="number" step="any" min={-90} max={90} aria-invalid={bad('lat')} value={draft.lat} onChange={(e) => edit('lat', e.target.value)} /><span className="unit">°N</span>
        </label>
        <label className="num"><span className="engraved" title="Longitude, east positive">Longitude</span>
          <input className="input" type="number" step="any" min={-180} max={360} aria-invalid={bad('lon')} value={draft.lon} onChange={(e) => edit('lon', e.target.value)} /><span className="unit">°E</span>
        </label>
        <label className="num"><span className="engraved" title="Height above the WGS-84 ellipsoid">Height</span>
          <input className="input" type="number" step={1} min={-500} max={9000} aria-invalid={bad('h')} value={draft.h} onChange={(e) => edit('h', e.target.value)} /><span className="unit">m</span>
        </label>
      </div>
      <div className="keys-row wrap">
        <button className="key small" onClick={locate} title="Ask the browser where you are. It stays in this browser: nothing is sent anywhere">Locate</button>
        <button className="key small att-toggle" aria-pressed={trackOn} onClick={() => { setTrackOn(!trackOn); store(TRACK_KEY, trackOn ? 'off' : 'on'); }}
          title="Draw the ground under the satellite on the Earth, its next pass brighter, and the place">Ground track</button>
        <button className="key small att-toggle" aria-pressed={visibleOnly} onClick={() => setVisibleOnly(!visibleOnly)}
          title="Only the passes it can be seen on: lit by the Sun, with the sky dark">Visible only</button>
        <span className="hint" role="status">{locating || latLon(place)}</span>
      </div>
      {!passes && <p className={`status${failed ? ' bad' : ''}`}>{failed ? `Not searched: ${failed}` : 'Searching three days…'}</p>}
      {passes && !ahead.length && (
        <p className="status">{stays && stays.elDeg > 0
          ? `No pass: it stays in the sky, now ${stays.azDeg.toFixed(1)}° ${compass(stays.azDeg)} at ${stays.elDeg.toFixed(1)}°`
          : 'No pass above 10° in the next three days'}</p>
      )}
      {passes && ahead.length > 0 && !shown.length && <p className="status">None visible in the next three days ({ahead.length} by day or in shadow)</p>}
      {shown.map((p) => <PassBlock key={p.peak.t} pass={p} now={now} onGo={() => clock.setTime((p.rise?.t ?? p.peak.t) - 60e3)} />)}
      {passes && <p className="hint passes-note">Passes peaking 10° or more, from SGP4; rise and set at the horizon, without refraction. Visible: sunlit, with the Sun 6° or more below the horizon.</p>}
    </section>
  );
}

function PassBlock({ pass: p, now, onGo }: { pass: Pass; now: number; onGo: () => void }) {
  const up = (p.rise?.t ?? p.peak.t) <= now && now < (p.set?.t ?? p.peak.t);
  const rows: Row[] = [
    p.rise ? { label: 'Rise', value: hms(p.rise.t), alt: `${dir(p.rise)} · ${p.rise.rangeKm.toFixed(0)} km`, src: 'SGP4', derived: true, info: 'sat-pass' }
      : { label: 'Rise', value: '—', alt: 'before the search', src: 'SGP4', derived: true, info: 'sat-pass' },
    { label: 'Peak', value: hms(p.peak.t), alt: `${p.peak.elDeg.toFixed(1)}° up, ${dir(p.peak)} · ${p.peak.rangeKm.toFixed(0)} km`, src: 'SGP4', derived: true, info: 'sat-pass' },
    p.set ? { label: 'Set', value: hms(p.set.t), alt: `${dir(p.set)} · ${p.set.rangeKm.toFixed(0)} km`, src: 'SGP4', derived: true, info: 'sat-pass' }
      : { label: 'Set', value: '—', alt: 'after the search', src: 'SGP4', derived: true, info: 'sat-pass' },
  ];
  if (p.visible) {
    const { from, to } = p.visible;
    // Why it starts or stops being seen within the pass: the shadow's edge,
    // or the Sun crossing 6° below the horizon.
    const late = p.rise && from.t - p.rise.t > 500, early = p.set && p.set.t - to.t > 500;
    const how = [
      late ? (p.sunlit[0] ? `once the sky darkens, at ${from.elDeg.toFixed(0)}°` : `out of shadow at ${from.elDeg.toFixed(0)}°`) : '',
      early ? (p.sunlit[1] ? `until the sky brightens, at ${to.elDeg.toFixed(0)}°` : `into shadow at ${to.elDeg.toFixed(0)}°`) : '',
    ].filter(Boolean).join(', ');
    rows.push({ label: 'Seen', value: `${hms(from.t)}–${hms(to.t)}`, alt: how || 'rise to set', src: 'Sun', derived: true, info: 'sat-visible' });
  }
  const kind = p.kind === 'visible' ? 'Visible' : p.kind === 'daylight' ? 'Daylight' : 'In shadow';
  return (
    <div className={`pass${up ? ' up' : ''}`}>
      <p className="pass-head">
        <span className="engraved">{day(p.peak.t)}</span>
        <span className={`pass-kind ${p.kind}`} title={p.kind === 'visible' ? 'Sunlit while the sky is dark: it can be seen' : p.kind === 'daylight' ? 'The sky is too bright (the Sun under 6° below the horizon)' : 'In the Earth\'s shadow all the way across'}>
          <span className="lamp-sq" aria-hidden="true" />{kind}
        </span>
        <span className="pass-max">max {p.peak.elDeg.toFixed(0)}°</span>
        {up ? <span className="pass-now" title="Above the horizon now">Up now</span>
          : <button className="key small" onClick={onGo} title="Set the clock to a minute before it rises">Go</button>}
      </p>
      <Readout rows={rows} />
    </div>
  );
}
