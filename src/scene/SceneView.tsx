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
}

export function SceneView({ clock, focus, onFocusChange, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OrreryScene | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let scene: OrreryScene;
    try {
      scene = new OrreryScene(hostRef.current!, overlayRef.current!, clock);
    } catch (e) {
      // No WebGL (GPU off or blocked): keep the panels, explain the blank view.
      setFailed(e instanceof Error ? e.message : String(e));
      return;
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
        <div className="scene-error" role="alert">
          The 3D view needs WebGL, which this browser could not start. The data panels still work.
          <small>{failed}</small>
        </div>
      )}
    </div>
  );
}
