// src/app/App.tsx

import { useEffect, useMemo, useState } from 'react';
import { SimClock } from './clock';
import { SceneView } from '../scene/SceneView';
import { BodyRail, DataPlate, RATES, TimeBand } from './panels';
import { BODIES, BODY_BY_KEY, type BodyKey } from '../scene/catalogue';

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

  // Keyboard: Space runs or pauses, left/right step the rate, up/down move
  // through the bodies, N jumps to now. Ignored while a form control has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.altKey || e.ctrlKey || e.metaKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const s = clock.snapshot;
      const ri = Math.max(0, RATES.findIndex((r) => r.rate === s.rate));
      const bi = BODIES.findIndex((b) => b.key === focus);
      if (e.key === ' ') clock.setPlaying(!s.playing);
      else if (e.key === 'ArrowRight') clock.setRate(RATES[Math.min(RATES.length - 1, ri + 1)].rate);
      else if (e.key === 'ArrowLeft') clock.setRate(RATES[Math.max(0, ri - 1)].rate);
      else if (e.key === 'ArrowDown') setFocus(BODIES[Math.min(BODIES.length - 1, bi + 1)].key);
      else if (e.key === 'ArrowUp') setFocus(BODIES[Math.max(0, bi - 1)].key);
      else if (e.key === 'n' || e.key === 'N') clock.setTime(Date.now());
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock, focus]);

  return (
    <div className="app">
      <SceneView clock={clock} focus={focus} onFocusChange={setFocus}
        onReady={init.sunView ? (scene) => scene.viewFromSun((init.phaseDeg * Math.PI) / 180) : undefined} />
      <TimeBand clock={clock} />
      <BodyRail clock={clock} focus={focus} onSelect={setFocus} />
      <DataPlate clock={clock} focus={focus} />
    </div>
  );
}
