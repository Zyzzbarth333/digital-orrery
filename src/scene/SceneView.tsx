// src/scene/SceneView.tsx
//
// Hosts the imperative three.js scene in React. The scene owns its render
// loop; React only mounts it and passes focus changes both ways.

import { useEffect, useRef, useState } from 'react';
import type { SimClock } from '../app/clock';
import { OrreryScene } from './OrreryScene';
import type { BodyKey } from './catalogue';

interface Props {
  clock: SimClock;
  focus: BodyKey;
  onFocusChange: (key: BodyKey) => void;
  onReady?: (scene: OrreryScene) => void;
  onFrame?: (timeMs: number, jumps: number) => void;   // used only without WebGL
}

export function SceneView({ clock, focus, onFocusChange, onReady, onFrame }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OrreryScene | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

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

  return (
    <div className="scene-host" ref={hostRef}>
      <div className="scene-overlay" ref={overlayRef} />
      {failed && (
        <div className="scene-error caution" role="alert">
          The 3D view needs WebGL, which this browser could not start. The data panels still work.
          <small>{failed}</small>
        </div>
      )}
    </div>
  );
}
