/**
 * Where a round crashes.
 *
 * This is the game's entire economic model, so it lives in core where it
 * can be tested and audited rather than buried in the server loop.
 *
 * THIS IS NOT A PRODUCTION RNG. `Math.random` is not cryptographically
 * secure and the crash point here is not provably fair — a real deployment
 * derives it from a server seed committed in advance plus a client seed, so
 * a player can verify after the fact that the house did not pick the number
 * once it knew their bet. That machinery is out of scope for the mock
 * server; the distribution below is the part that stays.
 */

/**
 * The house's cut, as a fraction.
 *
 * With edge `e`, a player who always cashes out at multiplier `m` returns
 * `1 - e` of their stake on average, whatever `m` they pick. 1% is a
 * conventional starting point for this genre and is the single number to
 * change when product settles on the real figure.
 */
export const HOUSE_EDGE = 0.01;

/** Rounds that crash instantly at 1.00x, as a fraction of the edge. */
const INSTANT_CRASH_SHARE = HOUSE_EDGE;

/**
 * Draw a crash point from the standard crash distribution.
 *
 * The shape is `1 / (1 - u)`: mostly low multipliers with a long tail, so
 * 2x comes up about half the time and 10x about a tenth. That heavy tail is
 * the point of the genre — the rare big multiplier is what players
 * remember.
 *
 * The house edge is taken as a slice of rounds that crash immediately at
 * 1.00x rather than by shaving every payout. Players can then verify that
 * a 2x cashout really does pay exactly 2x, which is much easier to trust
 * than a curve quietly biased against them.
 *
 * @param random Source of uniform [0,1) values. Injected so tests and the
 *   mock server can supply a seeded generator and replay a session.
 */
export function drawCrashPoint(random: () => number = Math.random): number {
  const roll = random();

  // The instant-crash slice: these rounds end before anyone can cash out.
  if (roll < INSTANT_CRASH_SHARE) return 1;

  // Re-normalise the remaining probability mass back onto [0,1) so the
  // tail keeps its shape instead of being squashed by the slice above.
  const u = (roll - INSTANT_CRASH_SHARE) / (1 - INSTANT_CRASH_SHARE);

  // Guard the asymptote: u === 1 would divide by zero.
  const raw = 1 / (1 - Math.min(u, 0.999_999));

  // Two decimals, matching the wire representation, and never below 1.
  return Math.max(1, Math.floor(raw * 100) / 100);
}

/**
 * Deterministic uniform generator (mulberry32).
 *
 * Small, fast and good enough for replaying a session in a test or demo.
 * Not for anything a player's money depends on.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
