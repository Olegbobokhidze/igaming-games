/**
 * The multiplier curve.
 *
 * This lives in core, not in the server or the renderer, because both must
 * compute exactly the same number. If the server's curve and the client's
 * drawing disagree, a player watching 2.40x can be settled at 2.38x, and
 * that is a payments dispute rather than a rendering glitch.
 *
 * The curve is deliberately pure and stateless: given elapsed time it
 * returns a multiplier, with no clock of its own.
 */

import { fromMultiplier, MULTIPLIER_SCALE } from '../protocol/index.js';

/**
 * Growth rate per second.
 *
 * The curve is exponential, not linear: at 1.07 the multiplier doubles
 * roughly every 10 seconds, so each doubling takes the same wall-clock time
 * whether it is 1x to 2x or 8x to 16x. A linear curve would make early
 * multipliers crawl and late ones sprint, which reads as the game speeding
 * up rather than the stake growing.
 */
export const GROWTH_PER_SECOND = 1.07;

/**
 * Multiplier at a given elapsed time, as a float.
 *
 * Starts at exactly 1 and rises from there; never returns less than 1.
 */
export function multiplierAt(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1;
  return GROWTH_PER_SECOND ** (elapsedMs / 1000);
}

/**
 * Multiplier at a given elapsed time, in wire units (hundredths).
 *
 * The server sends this, so it is what the client is settled against.
 * Rounding happens once, here, rather than independently on each side.
 */
export function scaledMultiplierAt(elapsedMs: number): number {
  return Math.max(MULTIPLIER_SCALE, fromMultiplier(multiplierAt(elapsedMs)));
}

/**
 * Inverse of {@link multiplierAt}: when does the curve reach this value?
 *
 * The server uses this to schedule the crash — it draws a crash point up
 * front and converts it into a duration, rather than sampling the curve
 * every tick and hoping to notice the crossing.
 */
export function timeToReach(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 1) return 0;
  return (Math.log(multiplier) / Math.log(GROWTH_PER_SECOND)) * 1000;
}
