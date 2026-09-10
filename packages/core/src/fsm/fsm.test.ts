import { describe, expect, it } from 'vitest';
import { asMinor } from '../money/index.js';
import {
  applyEvents,
  canCashOut,
  canPlaceBet,
  INITIAL_ROUND_STATE,
  multiplierToProgress,
  transition,
  type RoundEvent,
  type RoundState,
} from './index.js';

const open: RoundEvent = {
  type: 'ROUND_OPENED',
  roundId: 'r1',
  betsCloseAt: 5_000,
};
const bet: RoundEvent = { type: 'BET_ACCEPTED', stake: asMinor(1000) };
const closed: RoundEvent = { type: 'BETS_CLOSED' };
const launched: RoundEvent = { type: 'LAUNCHED', startedAt: 1_000 };
const tick = (multiplier: number, elapsedMs = 0): RoundEvent => ({
  type: 'TICK',
  multiplier,
  elapsedMs,
});
const crashed = (multiplier: number): RoundEvent => ({ type: 'CRASHED', multiplier });

/** Run a list of events from the initial state. */
const run = (...events: RoundEvent[]): RoundState =>
  applyEvents(INITIAL_ROUND_STATE, events);

describe('round machine — happy path', () => {
  it('starts idle with no round and no bet', () => {
    expect(INITIAL_ROUND_STATE.phase).toBe('idle');
    expect(INITIAL_ROUND_STATE.roundId).toBeNull();
    expect(INITIAL_ROUND_STATE.bet.kind).toBe('none');
  });

  it('walks idle -> betting -> launching -> flying -> crashed -> settled', () => {
    const phases: string[] = [];
    let state = INITIAL_ROUND_STATE;
    for (const event of [
      open,
      closed,
      launched,
      tick(1.5),
      crashed(2.4),
      { type: 'SETTLED', payout: asMinor(0), cashedOutAt: null } as RoundEvent,
    ]) {
      state = transition(state, event);
      phases.push(state.phase);
    }
    expect(phases).toEqual([
      'betting',
      'launching',
      'flying',
      'flying',
      'crashed',
      'settled',
    ]);
  });

  it('tracks the multiplier from authoritative ticks', () => {
    const state = run(open, closed, launched, tick(2.75, 1400));
    expect(state.multiplier).toBe(2.75);
    expect(state.elapsedMs).toBe(1400);
  });

  it('records a cashout and keeps it through the crash', () => {
    const state = run(
      open,
      bet,
      closed,
      launched,
      tick(2),
      { type: 'CASHED_OUT', multiplier: 2 },
      crashed(3.1),
    );
    expect(state.bet).toEqual({ kind: 'cashed_out', stake: 1000, at: 2 });
    expect(state.phase).toBe('crashed');
  });

  it('marks an open bet as lost when the round crashes', () => {
    const state = run(open, bet, closed, launched, crashed(1.2));
    expect(state.bet).toEqual({ kind: 'lost', stake: 1000 });
  });

  it('carries the payout into settled', () => {
    const state = run(
      open,
      bet,
      closed,
      launched,
      { type: 'CASHED_OUT', multiplier: 2 },
      crashed(3),
      { type: 'SETTLED', payout: asMinor(2000), cashedOutAt: 2 },
    );
    expect(state.phase).toBe('settled');
    expect(state.lastPayout).toBe(2000);
  });
});

describe('round machine — totality', () => {
  const everyEvent: RoundEvent[] = [
    open,
    bet,
    closed,
    launched,
    tick(2),
    { type: 'FRAME', multiplier: 2 },
    { type: 'CASHED_OUT', multiplier: 2 },
    crashed(2),
    { type: 'SETTLED', payout: asMinor(0), cashedOutAt: null },
  ];

  // Reachable states, one per phase.
  const states: readonly RoundState[] = [
    INITIAL_ROUND_STATE,
    run(open),
    run(open, closed),
    run(open, closed, launched),
    run(open, closed, launched, crashed(2)),
    run(open, closed, launched, crashed(2), {
      type: 'SETTLED',
      payout: asMinor(0),
      cashedOutAt: null,
    }),
  ];

  it('never throws for any (phase, event) pair', () => {
    for (const state of states) {
      for (const event of everyEvent) {
        expect(() => transition(state, event)).not.toThrow();
      }
    }
  });

  it('always returns a valid phase', () => {
    const valid = new Set([
      'idle',
      'betting',
      'launching',
      'flying',
      'crashed',
      'settled',
    ]);
    for (const state of states) {
      for (const event of everyEvent) {
        expect(valid.has(transition(state, event).phase)).toBe(true);
      }
    }
  });

  it('returns the same object when an event does not apply', () => {
    const flying = run(open, closed, launched);
    // BETS_CLOSED is meaningless mid-flight.
    expect(transition(flying, closed)).toBe(flying);
  });
});

describe('round machine — out-of-order and duplicate frames', () => {
  it('ignores a tick that arrives after the crash', () => {
    const afterCrash = run(open, closed, launched, crashed(2.4));
    const state = transition(afterCrash, tick(2.39, 9999));
    // The final multiplier must survive a stale in-flight frame.
    expect(state.multiplier).toBe(2.4);
    expect(state.phase).toBe('crashed');
  });

  it('ignores ticks before launch', () => {
    const betting = run(open);
    expect(transition(betting, tick(1.5)).multiplier).toBe(1);
  });

  it('does not stack duplicate bet acceptances', () => {
    const state = run(open, bet, bet);
    expect(state.bet).toEqual({ kind: 'placed', stake: 1000 });
  });

  it('ignores a bet accepted after betting closed', () => {
    const state = run(open, closed, bet);
    expect(state.bet.kind).toBe('none');
  });

  it('tolerates a missing BETS_CLOSED before launch', () => {
    // Dropping one frame should not strand the round in 'betting'.
    const state = run(open, launched);
    expect(state.phase).toBe('flying');
  });

  it('ignores a settle that is not preceded by a crash', () => {
    const flying = run(open, closed, launched);
    const state = transition(flying, {
      type: 'SETTLED',
      payout: asMinor(500),
      cashedOutAt: null,
    });
    expect(state.phase).toBe('flying');
    expect(state.lastPayout).toBeNull();
  });

  it('ignores a cashout with no active bet', () => {
    const state = run(open, closed, launched, {
      type: 'CASHED_OUT',
      multiplier: 2,
    });
    expect(state.bet.kind).toBe('none');
  });

  it('ignores a second cashout for the same bet', () => {
    const state = run(
      open,
      bet,
      closed,
      launched,
      { type: 'CASHED_OUT', multiplier: 2 },
      { type: 'CASHED_OUT', multiplier: 5 },
    );
    expect(state.bet).toEqual({ kind: 'cashed_out', stake: 1000, at: 2 });
  });

  it('resets bet and multiplier when the next round opens', () => {
    const state = run(
      open,
      bet,
      closed,
      launched,
      crashed(1.1),
      { type: 'SETTLED', payout: asMinor(0), cashedOutAt: null },
      { type: 'ROUND_OPENED', roundId: 'r2', betsCloseAt: 10_000 },
    );
    expect(state.roundId).toBe('r2');
    expect(state.phase).toBe('betting');
    expect(state.multiplier).toBe(1);
    expect(state.bet.kind).toBe('none');
  });
});

describe('FRAME smoothing', () => {
  it('advances the multiplier between ticks', () => {
    const state = run(open, closed, launched, tick(2), {
      type: 'FRAME',
      multiplier: 2.05,
    });
    expect(state.multiplier).toBe(2.05);
  });

  it('never moves the multiplier backwards', () => {
    // A late frame must not make the displayed number stutter.
    const state = run(open, closed, launched, tick(2.5), {
      type: 'FRAME',
      multiplier: 2.1,
    });
    expect(state.multiplier).toBe(2.5);
  });

  it('does nothing outside the flying phase', () => {
    const betting = run(open);
    expect(transition(betting, { type: 'FRAME', multiplier: 3 })).toBe(betting);
  });
});

describe('action guards', () => {
  it('allows a bet only while betting and with no bet placed', () => {
    expect(canPlaceBet(run(open))).toBe(true);
    expect(canPlaceBet(run(open, bet))).toBe(false);
    expect(canPlaceBet(run(open, closed))).toBe(false);
    expect(canPlaceBet(INITIAL_ROUND_STATE)).toBe(false);
  });

  it('allows a cashout only while flying with a placed bet', () => {
    expect(canCashOut(run(open, bet, closed, launched))).toBe(true);
    // No bet.
    expect(canCashOut(run(open, closed, launched))).toBe(false);
    // Already cashed out.
    expect(
      canCashOut(run(open, bet, closed, launched, { type: 'CASHED_OUT', multiplier: 2 })),
    ).toBe(false);
    // Round already over.
    expect(canCashOut(run(open, bet, closed, launched, crashed(2)))).toBe(false);
  });
});

describe('multiplierToProgress', () => {
  it('parks on the launch pad at or below 1x', () => {
    expect(multiplierToProgress(1)).toBe(0);
    expect(multiplierToProgress(0.5)).toBe(0);
  });

  it('reaches the top exactly at the apex multiplier', () => {
    expect(multiplierToProgress(20, 20)).toBeCloseTo(1, 10);
  });

  it('clamps beyond the apex rather than overshooting', () => {
    expect(multiplierToProgress(1000, 20)).toBe(1);
  });

  it('spends equal travel on each doubling', () => {
    const a = multiplierToProgress(4) - multiplierToProgress(2);
    const b = multiplierToProgress(8) - multiplierToProgress(4);
    expect(a).toBeCloseTo(b, 10);
  });

  it('survives non-finite input instead of producing NaN', () => {
    expect(multiplierToProgress(Number.NaN)).toBe(0);
    expect(multiplierToProgress(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
