import { useEffect } from 'react';
import { multiplierAt } from '@igaming/core';
import { useAppStore } from '../state/store.js';

/**
 * Fill the gaps between server ticks.
 *
 * The server sends a multiplier ten times a second; the screen redraws
 * sixty. Rendering the raw ticks makes the number visibly step, so between
 * them the client re-derives the curve locally from the last authoritative
 * tick plus the time since it arrived.
 *
 * This is presentation only. The local value is always overwritten by the
 * next real tick, and the FRAME event it dispatches refuses to move the
 * multiplier backwards, so a slow frame can never make the number stutter
 * or show more than the server has authorised.
 */
export function useMultiplierInterpolation(): void {
  useEffect(() => {
    let raf = 0;
    /** Wall-clock time at which the last authoritative tick was applied. */
    let tickArrivedAt = performance.now();
    let lastElapsedMs = -1;

    const frame = (): void => {
      raf = requestAnimationFrame(frame);

      const state = useAppStore.getState();
      const round = state.round;
      if (round.phase !== 'flying') {
        lastElapsedMs = -1;
        return;
      }

      // A new authoritative tick resets the local clock.
      if (round.elapsedMs !== lastElapsedMs) {
        lastElapsedMs = round.elapsedMs;
        tickArrivedAt = performance.now();
        return;
      }

      // Project the curve forward by however long the tick has been stale.
      const sinceTick = performance.now() - tickArrivedAt;
      const projected = multiplierAt(round.elapsedMs + sinceTick);
      state.dispatch({ type: 'FRAME', multiplier: projected });
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);
}
