import { useEffect, useRef } from 'react';
import { bootstrapEngine, createStatsOverlay } from '@igaming/engine';
import { createScene } from '../game/scene.js';
import './GameCanvas.css';

/**
 * Mounts the Pixi application into a div.
 *
 * Everything created here is torn down in the effect's return. Under React
 * 18 Strict Mode this effect runs mount -> cleanup -> mount in development,
 * so a leaked canvas would be immediately visible as a doubled scene.
 */
export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const engine = await bootstrapEngine({ container: host });
      if (disposed) {
        engine.destroy();
        return;
      }

      const scene = await createScene(engine.app);
      if (disposed) {
        scene.destroy();
        engine.destroy();
        return;
      }

      const onResize = (): void => {
        scene.layout(engine.app.renderer.width, engine.app.renderer.height);
      };
      engine.app.renderer.on('resize', onResize);
      onResize();

      const overlay = import.meta.env.DEV ? createStatsOverlay(engine.app) : null;
      if (overlay !== null) host.appendChild(overlay.element);

      if (import.meta.env.DEV) {
        // Handle for the Pixi devtools extension and for poking at the scene
        // graph from the console. Dev-only: never expose internals in a build.
        Object.assign(globalThis, {
          __PIXI_APP__: engine.app,
          // Scrub the altitude backdrop by hand, e.g. __SCENE__.setProgress(0.5)
          __SCENE__: scene,
        });
      }

      cleanup = () => {
        engine.app.renderer.off('resize', onResize);
        overlay?.destroy();
        // Detach the scene's ticker callback before the app goes away.
        scene.destroy();
        engine.destroy();
        if (import.meta.env.DEV) {
          const dev = globalThis as { __PIXI_APP__?: unknown; __SCENE__?: unknown };
          delete dev.__PIXI_APP__;
          delete dev.__SCENE__;
        }
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
      cleanup = null;
    };
  }, []);

  return <div className="game-canvas" ref={hostRef} />;
}
