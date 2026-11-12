// src/app/App.tsx

import { useMemo, useState } from 'react';
import { SimClock } from './clock';
import { SceneView } from '../scene/SceneView';
import { BodyList, BodyPanel, TimeBar } from './panels';
import { BODY_BY_KEY, type BodyKey } from '../scene/catalogue';

// Optional start state from the URL: ?focus=mars&t=2030-01-01T00:00Z&view=sun
// (or &phase=90: the camera at that angle from the Sun, seen from the body)
function initialState(): { focus: BodyKey; timeMs: number; sunView: boolean; phaseDeg: number } {
  const q = new URLSearchParams(window.location.search);
  const f = q.get('focus');
  const t = Date.parse(q.get('t') ?? '');
  return {
    focus: f && f in BODY_BY_KEY ? (f as BodyKey) : 'sun',
    timeMs: Number.isFinite(t) ? t : Date.now(),
    sunView: q.get('view') === 'sun' || q.has('phase'),
    phaseDeg: Number(q.get('phase') ?? 20),
  };
}

export function App() {
  const init = useMemo(initialState, []);
  const clock = useMemo(() => new SimClock(init.timeMs), [init]);
  const [focus, setFocus] = useState<BodyKey>(init.focus);
  return (
    <div className="app">
      <SceneView clock={clock} focus={focus} onFocusChange={setFocus}
        onReady={init.sunView ? (scene) => scene.viewFromSun((init.phaseDeg * Math.PI) / 180) : undefined} />
      <header className="top">
        <span className="title">digital-orrery</span>
        <TimeBar clock={clock} />
      </header>
      <aside className="left">
        <BodyList focus={focus} onSelect={setFocus} />
      </aside>
      <aside className="right">
        <BodyPanel clock={clock} focus={focus} />
      </aside>
    </div>
  );
}
