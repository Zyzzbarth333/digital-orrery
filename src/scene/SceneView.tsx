// src/scene/SceneView.tsx
//
// Hosts the imperative three.js scene in React. The scene owns its render
// loop; React only mounts it and passes focus changes both ways.

import { useEffect, useRef, useState } from 'react';
import type { SimClock } from '../app/clock';
import { OrreryScene } from './OrreryScene';
import type { FocusKey } from './catalogue';
import type { Frame } from './OrreryScene';

interface Props {
  clock: SimClock;
  focus: FocusKey;
  onFocusChange: (key: FocusKey) => void;
  frame?: Frame;                                         // orbits about the Sun or the SSB
  onReady?: (scene: OrreryScene) => void;
  onFrame?: (timeMs: number, jumps: number) => void;   // used only without WebGL
  insetRight?: number;                                  // px of the sky covered on the right (the console)
  view: { kind: 'focus' | 'follow'; name: string };    // what the camera is on, for the view plate
  flying?: boolean;
}

// The view plate names what the camera is on, with two cues for the mode
// (word and glyph: a circle for a body, a diamond for a craft, as in the
// sky), and says when a flight is under way and how to stop it.
function ViewPlate({ view, flying }: { view: Props['view']; flying: boolean }) {
  return (
    <div className={`view-plate${flying ? ' flying' : ''}`} role="status" aria-live="polite">
      <span className={`mode m-${view.kind}`} aria-hidden="true" />
      <span className="engraved">{view.kind === 'focus' ? 'Focus' : 'Follow'}</span>
      <span className="name">{view.name}</span>
      {flying && <span className="enroute">En route · <kbd>Esc</kbd> stop</span>}
    </div>
  );
}

export function SceneView({ clock, focus, onFocusChange, onReady, onFrame, insetRight = 0, view, flying = false, frame = 'sun' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OrreryScene | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let scene: OrreryScene;
    try {
      scene = new OrreryScene(hostRef.current!, overlayRef.current!, clock);
    } catch (e) {
      // No WebGL (GPU off or blocked): keep the panels, explain the blank
      // view, and run the clock (and the mission) from a frame loop of our
      // own, since the scene's loop is what normally advances them.
      setFailed(e instanceof Error ? e.message : String(e));
      // A 100 ms timer, not animation frames: nothing is drawn, the panels
      // refresh ten times a second, and timers run where frames do not.
      let last = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        clock.tick((now - last) / 1000);
        last = now;
        onFrame?.(clock.snapshot.timeMs, clock.snapshot.jumps);
      }, 100);
      return () => clearInterval(timer);
    }
    scene.onFocusChange = onFocusChange;
    scene.onContextLost = setLost;
    sceneRef.current = scene;
    onReady?.(scene);
    return () => { scene.dispose(); sceneRef.current = null; };
    // The scene lives for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene && scene.focus !== focus) scene.focusOn(focus);
  }, [focus]);

  useEffect(() => { sceneRef.current?.setInsetRight(insetRight); }, [insetRight]);

  useEffect(() => { sceneRef.current?.setFrame(frame); }, [frame]);

  return (
    <div className="scene-host" ref={hostRef}>
      <div className="scene-overlay" ref={overlayRef} />
      {!failed && <ViewPlate view={view} flying={flying} />}
      {lost && !failed && (
        <div className="scene-error caution" role="alert">
          The graphics card dropped the 3D view (this happens after sleep or a driver reset). It comes back when the browser restores it; the panels and the clock keep running.
        </div>
      )}
      {failed && (
        <div className="scene-error caution" role="alert">
          The 3D view needs WebGL, which this browser could not start. The data panels still work.
          <small>{failed}</small>
        </div>
      )}
    </div>
  );
}
