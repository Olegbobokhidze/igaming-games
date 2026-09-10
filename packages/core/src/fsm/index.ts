/**
 * Round lifecycle state machine.
 *
 * The machine is a pure reducer: `(state, event) => state`. It holds no
 * timers, no socket and no rendering, which is what makes it testable
 * without a browser and reusable on the server.
 *
 * Two rules shape the whole design:
 *
 *  1. TOTALITY. Every (phase, event) pair either produces a next state or
 *     is explicitly ignored. It never throws. Out-of-order and duplicate
 *     frames are normal on a real socket — a late TICK arriving after
 *     CRASHED must be dropped, not treated as a bug.
 *  2. THE SERVER IS AUTHORITATIVE. The machine only ever mirrors what the
 *     server said. It does not decide when a round crashes, and it does not
 *     compute payouts. The one number it derives locally is the multiplier
 *     between ticks, which is presentation and is overwritten by the next
 *     authoritative frame.
 */

import type { Minor } from '../money/index.js';

/** Phases a crash round moves through, from lobby to settlement. */
export type RoundPhase =
  'idle' | 'betting' | 'launching' | 'flying' | 'crashed' | 'settled';

/**
 * The player's own position in the round.
 *
 * Kept separate from `phase`: the round advances the same way whether or
 * not this player has money on it, and folding the two together produces a
 * combinatorial mess of phases like 'flying-with-bet-not-cashed-out'.
 */
export type BetStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'placed'; readonly stake: Minor }
  | { readonly kind: 'cashed_out'; readonly stake: Minor; readonly at: number }
  | { readonly kind: 'lost'; readonly stake: Minor };

/**
 * Events the machine may receive.
 *
 * These are the machine's own vocabulary, deliberately not the wire format.
 * Server frames are translated into these by an adapter, so a protocol
 * change does not ripple into the transition table, and local-only events
 * (a button press that has not reached the server yet) can use the same
 * channel.
 */
export type RoundEvent =
  | {
      readonly type: 'ROUND_OPENED';
      readonly roundId: string;
      readonly betsCloseAt: number;
    }
  | { readonly type: 'BETS_CLOSED' }
  | { readonly type: 'LAUNCHED'; readonly startedAt: number }
  /** Authoritative multiplier from the server. */
  | { readonly type: 'TICK'; readonly multiplier: number; readonly elapsedMs: number }
  /** Local frame advance for smoothing between ticks — never from the wire. */
  | { readonly type: 'FRAME'; readonly multiplier: number }
  | { readonly type: 'CRASHED'; readonly multiplier: number }
  | {
      readonly type: 'SETTLED';
      readonly payout: Minor;
      readonly cashedOutAt: number | null;
    }
  | { readonly type: 'BET_ACCEPTED'; readonly stake: Minor }
  /** The player's cashout was confirmed by the server. */
  | { readonly type: 'CASHED_OUT'; readonly multiplier: number };

/** Immutable snapshot of where a round currently stands. */
export interface RoundState {
  readonly phase: RoundPhase;
  readonly roundId: string | null;
  /** Current multiplier as a float, 1.0 before launch. */
  readonly multiplier: number;
  /** Milliseconds since launch, per the last authoritative tick. */
  readonly elapsedMs: number;
  /** Server time at which betting closes; null outside the betting phase. */
  readonly betsCloseAt: number | null;
  readonly bet: BetStatus;
  /** Payout for the last settled round, for display after the fact. */
  readonly lastPayout: Minor | null;
}

/** A pure reducer: given a state and an event, produce the next state. */
export type Transition = (state: RoundState, event: RoundEvent) => RoundState;

const NO_BET: BetStatus = { kind: 'none' };

export const INITIAL_ROUND_STATE: RoundState = {
  phase: 'idle',
  roundId: null,
  multiplier: 1,
  elapsedMs: 0,
  betsCloseAt: null,
  bet: NO_BET,
  lastPayout: null,
};

/**
 * Phases in which the player may still place a bet.
 *
 * Only 'betting'. Exposed as a helper because the UI needs the same answer
 * to enable its button, and duplicating the rule there is how the two drift
 * apart.
 */
export const canPlaceBet = (state: RoundState): boolean =>
  state.phase === 'betting' && state.bet.kind === 'none';

/**
 * Whether a cashout would be accepted right now.
 *
 * The server decides for real; this is the client's optimistic read, used
 * to enable the button. It deliberately requires a placed bet and a flying
 * round, which is exactly what the server checks.
 */
export const canCashOut = (state: RoundState): boolean =>
  state.phase === 'flying' && state.bet.kind === 'placed';

/**
 * Apply one event.
 *
 * Written as a switch on the event rather than on the phase, because most
 * events are only legal in one or two phases and the guard reads better
 * next to the event it guards. Every branch returns `state` unchanged when
 * the event does not apply.
 */
export const transition: Transition = (state, event) => {
  switch (event.type) {
    case 'ROUND_OPENED':
      // A new round wipes the previous one's bet and multiplier. This is
      // also the only way back from 'settled' or 'crashed'.
      return {
        phase: 'betting',
        roundId: event.roundId,
        multiplier: 1,
        elapsedMs: 0,
        betsCloseAt: event.betsCloseAt,
        bet: NO_BET,
        lastPayout: state.lastPayout,
      };

    case 'BET_ACCEPTED':
      // Only meaningful while betting is open. A duplicate acceptance is
      // ignored rather than stacking stakes.
      if (state.phase !== 'betting' || state.bet.kind !== 'none') return state;
      return { ...state, bet: { kind: 'placed', stake: event.stake } };

    case 'BETS_CLOSED':
      if (state.phase !== 'betting') return state;
      return { ...state, phase: 'launching', betsCloseAt: null };

    case 'LAUNCHED':
      // Tolerate a missing BETS_CLOSED: the launch frame implies it, and
      // dropping one frame should not strand the round in 'betting'.
      if (state.phase !== 'launching' && state.phase !== 'betting') return state;
      return {
        ...state,
        phase: 'flying',
        betsCloseAt: null,
        multiplier: 1,
        elapsedMs: 0,
      };

    case 'TICK':
      // Late ticks after a crash are normal; ignore them so the final
      // multiplier is not overwritten by a stale in-flight value.
      if (state.phase !== 'flying') return state;
      return { ...state, multiplier: event.multiplier, elapsedMs: event.elapsedMs };

    case 'FRAME':
      // Local smoothing only. Never moves the multiplier backwards, so a
      // late frame cannot make the number visibly stutter.
      if (state.phase !== 'flying') return state;
      if (event.multiplier <= state.multiplier) return state;
      return { ...state, multiplier: event.multiplier };

    case 'CASHED_OUT':
      if (state.bet.kind !== 'placed') return state;
      return {
        ...state,
        bet: { kind: 'cashed_out', stake: state.bet.stake, at: event.multiplier },
      };

    case 'CRASHED': {
      if (state.phase !== 'flying' && state.phase !== 'launching') return state;
      // A bet still open at the crash is lost. One already cashed out keeps
      // its status — the player got out in time.
      const bet: BetStatus =
        state.bet.kind === 'placed'
          ? { kind: 'lost', stake: state.bet.stake }
          : state.bet;
      return { ...state, phase: 'crashed', multiplier: event.multiplier, bet };
    }

    case 'SETTLED':
      if (state.phase !== 'crashed') return state;
      return { ...state, phase: 'settled', lastPayout: event.payout };

    default: {
      // Exhaustiveness guard: if a new event type is added to RoundEvent
      // and not handled above, this fails to compile.
      const exhaustive: never = event;
      return exhaustive;
    }
  }
};

/**
 * Fold a sequence of events over a state. Handy in tests and for replaying
 * a buffered burst of frames after a reconnect.
 */
export const applyEvents = (
  state: RoundState,
  events: readonly RoundEvent[],
): RoundState => events.reduce(transition, state);

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
