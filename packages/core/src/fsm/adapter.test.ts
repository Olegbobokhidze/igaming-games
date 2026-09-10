import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../protocol/index.js';
import { toRoundEvent } from './adapter.js';
import { applyEvents, INITIAL_ROUND_STATE, transition } from './index.js';

/** State tracking round 'r1' in the betting phase. */
const inRound = applyEvents(INITIAL_ROUND_STATE, [
  { type: 'ROUND_OPENED', roundId: 'r1', betsCloseAt: 5_000 },
]);

describe('toRoundEvent', () => {
  it('accepts round_opened with no current round', () => {
    const event = toRoundEvent(
      { type: 'round_opened', roundId: 'r1', betsCloseAt: 5_000 },
      INITIAL_ROUND_STATE,
    );
    expect(event).toEqual({
      type: 'ROUND_OPENED',
      roundId: 'r1',
      betsCloseAt: 5_000,
    });
  });

  it('converts fixed-point multipliers to floats', () => {
    const event = toRoundEvent(
      { type: 'tick', roundId: 'r1', multiplier: 275, elapsedMs: 1400 },
      inRound,
    );
    expect(event).toEqual({ type: 'TICK', multiplier: 2.75, elapsedMs: 1400 });
  });

  it('converts a crash multiplier', () => {
    const event = toRoundEvent(
      { type: 'crashed', roundId: 'r1', multiplier: 1043 },
      inRound,
    );
    expect(event).toEqual({ type: 'CRASHED', multiplier: 10.43 });
  });

  it('passes settlement amounts through as minor units', () => {
    const event = toRoundEvent(
      {
        type: 'settled',
        roundId: 'r1',
        payout: 2750,
        cashedOutAt: 275,
        balance: 12_750,
      },
      inRound,
    );
    expect(event).toEqual({
      type: 'SETTLED',
      payout: 2750,
      cashedOutAt: 2.75,
    });
  });

  it('keeps a null cashout as null rather than converting it to 0', () => {
    const event = toRoundEvent(
      {
        type: 'settled',
        roundId: 'r1',
        payout: 0,
        cashedOutAt: null,
        balance: 9000,
      },
      inRound,
    );
    expect(event).toMatchObject({ cashedOutAt: null });
  });

  it('drops frames belonging to a different round', () => {
    // After a reconnect the server may replay the tail of a finished round.
    const stale: ServerMessage = {
      type: 'tick',
      roundId: 'r0',
      multiplier: 500,
      elapsedMs: 8000,
    };
    expect(toRoundEvent(stale, inRound)).toBeNull();
  });

  it('drops round frames when no round is current', () => {
    // A stray tick with no round would otherwise start a phantom flight.
    const orphan: ServerMessage = {
      type: 'tick',
      roundId: 'r1',
      multiplier: 200,
      elapsedMs: 500,
    };
    expect(toRoundEvent(orphan, INITIAL_ROUND_STATE)).toBeNull();
  });

  it('returns null for frames outside the round lifecycle', () => {
    expect(toRoundEvent({ type: 'heartbeat', ts: 1, seq: 1 }, inRound)).toBeNull();
    expect(
      toRoundEvent({ type: 'command_rejected', reason: 'bets_closed' }, inRound),
    ).toBeNull();
  });

  it('feeds a full round through adapter and machine together', () => {
    const frames: ServerMessage[] = [
      { type: 'round_opened', roundId: 'r9', betsCloseAt: 5_000 },
      { type: 'bet_accepted', roundId: 'r9', stake: 1000, balance: 9000 },
      { type: 'bets_closed', roundId: 'r9' },
      { type: 'launched', roundId: 'r9', startedAt: 1_000 },
      { type: 'tick', roundId: 'r9', multiplier: 150, elapsedMs: 600 },
      { type: 'tick', roundId: 'r9', multiplier: 220, elapsedMs: 1200 },
      { type: 'crashed', roundId: 'r9', multiplier: 235 },
      {
        type: 'settled',
        roundId: 'r9',
        payout: 0,
        cashedOutAt: null,
        balance: 9000,
      },
    ];

    let state = INITIAL_ROUND_STATE;
    for (const frame of frames) {
      const event = toRoundEvent(frame, state);
      if (event !== null) state = transition(state, event);
    }

    expect(state.phase).toBe('settled');
    expect(state.roundId).toBe('r9');
    expect(state.multiplier).toBe(2.35);
    expect(state.bet).toEqual({ kind: 'lost', stake: 1000 });
    expect(state.lastPayout).toBe(0);
  });
});

describe('cashed_out frame', () => {
  it('becomes a CASHED_OUT event with a float multiplier', () => {
    const event = toRoundEvent(
      { type: 'cashed_out', roundId: 'r1', multiplier: 275, payout: 2750 },
      inRound,
    );
    expect(event).toEqual({ type: 'CASHED_OUT', multiplier: 2.75 });
  });

  it('is dropped for a stale round', () => {
    expect(
      toRoundEvent(
        { type: 'cashed_out', roundId: 'r0', multiplier: 200, payout: 2000 },
        inRound,
      ),
    ).toBeNull();
  });

  it('marks the bet cashed out through to settlement', () => {
    // The player must see they are out before the round ends, and that
    // status has to survive the crash that follows.
    const frames: ServerMessage[] = [
      { type: 'round_opened', roundId: 'rc', betsCloseAt: 5_000 },
      { type: 'bet_accepted', roundId: 'rc', stake: 1000, balance: 9000 },
      { type: 'bets_closed', roundId: 'rc' },
      { type: 'launched', roundId: 'rc', startedAt: 0 },
      { type: 'cashed_out', roundId: 'rc', multiplier: 200, payout: 2000 },
      { type: 'crashed', roundId: 'rc', multiplier: 500 },
    ];
    let state = INITIAL_ROUND_STATE;
    for (const frame of frames) {
      const event = toRoundEvent(frame, state);
      if (event !== null) state = transition(state, event);
    }
    expect(state.bet).toEqual({ kind: 'cashed_out', stake: 1000, at: 2 });
    expect(state.phase).toBe('crashed');
  });
});
