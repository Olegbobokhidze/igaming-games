/**
 * Round lifecycle state machine.
 *
 * This module intentionally contains ONLY the vocabulary of the machine:
 * the states, the events and the shape of a transition table. The actual
 * transition rules and the runtime that applies them land in a later stage.
 */

/** Phases a crash round moves through, from lobby to settlement. */
export type RoundPhase =
  'idle' | 'betting' | 'launching' | 'flying' | 'crashed' | 'settled';

/** Events the machine may receive, from the server or from local input. */
export type RoundEvent =
  | { readonly type: 'ROUND_OPENED'; readonly roundId: string }
  | { readonly type: 'BETS_CLOSED' }
  | { readonly type: 'LAUNCHED'; readonly startedAt: number }
  | { readonly type: 'TICK'; readonly elapsedMs: number }
  | { readonly type: 'CRASHED'; readonly multiplier: number }
  | { readonly type: 'SETTLED' };

/** Immutable snapshot of where a round currently stands. */
export interface RoundState {
  readonly phase: RoundPhase;
  readonly roundId: string | null;
  /** Current multiplier, 1.0 before launch. */
  readonly multiplier: number;
}

/** A pure reducer: given a state and an event, produce the next state. */
export type Transition = (state: RoundState, event: RoundEvent) => RoundState;

export const INITIAL_ROUND_STATE: RoundState = {
  phase: 'idle',
  roundId: null,
  multiplier: 1,
};

// TODO(stage-2): implement the transition table and a `createRoundMachine`
// factory. Transitions must be pure and total — every (phase, event) pair
// either maps to a next state or is explicitly ignored, never throws.

/**
 * Map a round multiplier onto a normalised 0..1 climb, for anything that
 * visualises altitude (the backdrop today, a progress meter later).
 *
 * Multipliers are unbounded and grow exponentially, so a linear mapping
 * would burn through the whole range in the first second and then sit still.
 * A log curve gives each doubling roughly equal travel, which matches how
 * the climb actually feels to a player.
 *
 * @param apex Multiplier at which the climb reaches 1 and stops.
 */
export function multiplierToProgress(multiplier: number, apex = 20): number {
  if (!Number.isFinite(multiplier) || multiplier <= 1) return 0;
  if (apex <= 1) return 1;
  const progress = Math.log(multiplier) / Math.log(apex);
  return Math.min(Math.max(progress, 0), 1);
}
