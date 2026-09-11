import { useEffect, useRef } from 'react';
import { bootstrapEngine, createStatsOverlay } from '@igaming/engine';
import { createScene } from '../game/scene.js';
import { RoundResultModal } from './RoundResultModal.js';
import { useAppStore } from '../state/store.js';
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
      // Clear to the shell's card surface, not the engine's page-dark
      // default: the canvas is one card among several, and the default
      // showed as a darker rectangle for the frame before the backdrop's
      // ground rect painted over it.
      const engine = await bootstrapEngine({
        container: host,
        backgroundColor: 0x0b0f1c,
      });
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

      // Drive the backdrop from the store directly rather than through a
      // React prop. The multiplier changes every animation frame, and
      // re-rendering the component tree at that rate to move a Pixi sprite
      // would be pure overhead — the canvas is not React's to diff.
      let lastPhase = useAppStore.getState().round.phase;
      const unsubscribe = useAppStore.subscribe((state) => {
        scene.setMultiplier(state.round.multiplier);

        const phase = state.round.phase;
        if (phase === lastPhase) return;
        const previous = lastPhase;
        lastPhase = phase;
        // The explosion is an edge, not a state: fire it once on the
        // transition into 'crashed', and clear the wreck when the next
        // round opens rather than when this one settles, so the debris
        // is still on screen while the result is being read.
        if (phase === 'crashed') scene.crash();
        // 'launching' is the server's bets-closed-now-igniting phase, which
        // is exactly the entrance's window: it ends when the first tick
        // arrives and the climb takes over.
        if (phase === 'launching') scene.launch();
        // Joining a round already in flight skips 'launching' entirely, so
        // the rocket would sit below the bottom edge for the whole round.
        // Snap it into place instead of playing an entrance it has missed.
        if (phase === 'flying' && previous !== 'launching') scene.arrive();
        if (phase === 'betting') scene.reset();
      });

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
        unsubscribe();
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

  return (
    <div className="game-canvas app-card app-card--clip">
      {/* The Pixi host is left alone as its own node: the engine appends
          the canvas and the dev stats overlay to it, so React must not be
          diffing children in there. Overlays are siblings. */}
      <div className="game-canvas__host" ref={hostRef} />
      <RoundResultModal />
    </div>
  );
}
