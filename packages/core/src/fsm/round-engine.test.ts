import { describe, expect, it } from 'vitest';
import { seededRandom } from './crash-point.js';
import { timeToReach } from './curve.js';
import { createRoundEngine, type Outbound } from './round-engine.js';
import { toRoundEvent } from './adapter.js';
import { INITIAL_ROUND_STATE, transition } from './index.js';
import { fromMultiplier, toMultiplier, type ServerMessage } from '../protocol/index.js';

/** Always crash at exactly this multiplier, for deterministic tests. */
const fixedCrashAt = (multiplier: number): (() => number) => {
  // drawCrashPoint maps u -> 1/(1-u) after skipping the instant-crash
  // slice, so invert that to force a chosen crash point.
  const edge = 0.01;
  const u = 1 - 1 / multiplier;
  return () => edge + u * (1 - edge);
};

const types = (frames: Outbound[]): string[] => frames.map((f) => f.message.type);

const find = <T extends ServerMessage['type']>(
  frames: Outbound[],
  type: T,
): Extract<ServerMessage, { type: T }> | undefined =>
  frames.find((f) => f.message.type === type)?.message as
    Extract<ServerMessage, { type: T }> | undefined;

/**
 * Drive the engine from `start` to `until` in fixed steps, collecting
 * everything it emits. This is the fake clock the engine was built for.
 */
const runClock = (
  engine: ReturnType<typeof createRoundEngine>,
  start: number,
  until: number,
  stepMs = 50,
): Outbound[] => {
  const collected: Outbound[] = [];
  for (let now = start; now <= until; now += stepMs) {
    collected.push(...engine.advance(now));
  }
  return collected;
};

describe('round engine — lifecycle', () => {
  it('opens a round after the intermission and closes bets on time', () => {
    const engine = createRoundEngine({
      timing: { bettingMs: 1000, launchDelayMs: 500, intermissionMs: 0 },
      random: fixedCrashAt(3),
    });

    expect(engine.advance(0).map((f) => f.message.type)).toEqual(['round_opened']);
    expect(engine.phase()).toBe('betting');

    // Nothing happens until betting time is up.
    expect(engine.advance(500)).toEqual([]);
    expect(types(engine.advance(1000))).toEqual(['bets_closed']);
    expect(engine.phase()).toBe('launching');

    expect(types(engine.advance(1500))).toEqual(['launched']);
    expect(engine.phase()).toBe('flying');
  });

  it('emits ticks at the configured interval while flying', () => {
    const engine = createRoundEngine({
      timing: {
        bettingMs: 0,
        launchDelayMs: 0,
        tickIntervalMs: 100,
        intermissionMs: 0,
      },
      random: fixedCrashAt(5),
    });
    engine.advance(0);
    engine.advance(0);
    engine.advance(0);
    expect(engine.phase()).toBe('flying');

    const frames = runClock(engine, 0, 1000, 50);
    const ticks = frames.filter((f) => f.message.type === 'tick');
    // 1000ms at one tick per 100ms, allowing for step alignment.
    expect(ticks.length).toBeGreaterThanOrEqual(9);
    expect(ticks.length).toBeLessThanOrEqual(11);
  });

  it('crashes at the drawn multiplier and never ticks past it', () => {
    const target = 3;
    const engine = createRoundEngine({
      timing: { bettingMs: 0, launchDelayMs: 0, intermissionMs: 0 },
      random: fixedCrashAt(target),
    });
    engine.advance(0);
    engine.advance(0);
    engine.advance(0);

    const frames = runClock(engine, 0, timeToReach(target) + 500, 25);
    const crash = find(frames, 'crashed');
    expect(crash).toBeDefined();
    expect(toMultiplier(crash?.multiplier ?? 0)).toBeCloseTo(target, 2);

    // No tick may exceed the crash point — that would show the player a
    // multiplier they were never able to cash out at.
    for (const frame of frames) {
      if (frame.message.type === 'tick') {
        expect(frame.message.multiplier).toBeLessThanOrEqual(crash?.multiplier ?? 0);
      }
    }
  });

  it('cycles into a new round after the intermission', () => {
    const engine = createRoundEngine({
      timing: {
        bettingMs: 100,
        launchDelayMs: 0,
        intermissionMs: 200,
      },
      random: fixedCrashAt(1.5),
    });
    const frames = runClock(engine, 0, 5000, 25);
    const opens = frames.filter((f) => f.message.type === 'round_opened');
    expect(opens.length).toBeGreaterThan(1);

    // Round ids must advance, never repeat.
    const ids = opens.map((f) =>
      f.message.type === 'round_opened' ? f.message.roundId : '',
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('round engine — betting', () => {
  const newEngine = () =>
    createRoundEngine({
      timing: { bettingMs: 1000, launchDelayMs: 0, intermissionMs: 0 },
      random: fixedCrashAt(4),
      startingBalance: 10_000,
    });

  it('debits the stake as soon as the bet is accepted', () => {
    const engine = newEngine();
    engine.join('p1');
    engine.advance(0);

    const frames = engine.placeBet('p1', 2500, null, 10);
    const accepted = find(frames, 'bet_accepted');
    expect(accepted?.stake).toBe(2500);
    expect(accepted?.balance).toBe(7500);
  });

  it('refuses a stake larger than the balance', () => {
    const engine = newEngine();
    engine.join('p1');
    engine.advance(0);
    const frames = engine.placeBet('p1', 999_999, null, 10);
    expect(find(frames, 'command_rejected')?.reason).toBe('insufficient_funds');
  });

  it('refuses a second bet in the same round', () => {
    const engine = newEngine();
    engine.join('p1');
    engine.advance(0);
    engine.placeBet('p1', 1000, null, 10);
    const frames = engine.placeBet('p1', 1000, null, 20);
    expect(find(frames, 'command_rejected')?.reason).toBe('already_bet');
  });

  it('refuses a bet once betting has closed', () => {
    const engine = newEngine();
    engine.join('p1');
    engine.advance(0);
    engine.advance(1000);
    const frames = engine.placeBet('p1', 1000, null, 1100);
    expect(find(frames, 'command_rejected')?.reason).toBe('bets_closed');
  });
});

describe('round engine — cashout and settlement', () => {
  /** Engine parked in the flying phase at t=0. */
  const flyingEngine = (crashAt: number, startingBalance = 10_000) => {
    const engine = createRoundEngine({
      timing: { bettingMs: 0, launchDelayMs: 0, intermissionMs: 0 },
      random: fixedCrashAt(crashAt),
      startingBalance,
    });
    return engine;
  };

  it('pays a manual cashout at the server clock, not the client claim', () => {
    const engine = flyingEngine(10);
    engine.join('p1');
    engine.advance(0); // open
    engine.placeBet('p1', 1000, null, 0);
    engine.advance(0); // bets_closed
    engine.advance(0); // launched

    // Cash out at the moment the curve reads 2x.
    const at2x = timeToReach(2);
    engine.cashout('p1', at2x);

    const frames = runClock(engine, at2x, timeToReach(10) + 200, 25);
    const settled = find(frames, 'settled');
    expect(settled).toBeDefined();
    expect(toMultiplier(settled?.cashedOutAt ?? 0)).toBeCloseTo(2, 1);
    // 1000 staked at ~2x pays ~2000, and the balance returns to ~11000.
    expect(settled?.payout ?? 0).toBeGreaterThan(1900);
    expect(settled?.payout ?? 0).toBeLessThan(2100);
  });

  it('pays nothing when the round crashes with an open bet', () => {
    const engine = flyingEngine(1.5);
    engine.join('p1');
    engine.advance(0);
    engine.placeBet('p1', 1000, null, 0);
    engine.advance(0);
    engine.advance(0);

    const frames = runClock(engine, 0, timeToReach(1.5) + 200, 25);
    const settled = find(frames, 'settled');
    expect(settled?.payout).toBe(0);
    expect(settled?.cashedOutAt).toBeNull();
    // Balance stays debited: 10000 - 1000.
    expect(settled?.balance).toBe(9000);
  });

  it('honours an auto-cashout below the crash point', () => {
    const engine = flyingEngine(5);
    engine.join('p1');
    engine.advance(0);
    engine.placeBet('p1', 1000, fromMultiplier(2), 0);
    engine.advance(0);
    engine.advance(0);

    const frames = runClock(engine, 0, timeToReach(5) + 200, 25);
    const settled = find(frames, 'settled');
    // Paid at exactly the requested threshold, not the tick that crossed it.
    expect(settled?.cashedOutAt).toBe(fromMultiplier(2));
    expect(settled?.payout).toBe(2000);
  });

  it('does not fire an auto-cashout above the crash point', () => {
    const engine = flyingEngine(2);
    engine.join('p1');
    engine.advance(0);
    engine.placeBet('p1', 1000, fromMultiplier(5), 0);
    engine.advance(0);
    engine.advance(0);

    const frames = runClock(engine, 0, timeToReach(2) + 200, 25);
    const settled = find(frames, 'settled');
    expect(settled?.payout).toBe(0);
    expect(settled?.cashedOutAt).toBeNull();
  });

  it('refuses a cashout with no bet', () => {
    const engine = flyingEngine(5);
    engine.join('p1');
    engine.advance(0);
    engine.advance(0);
    engine.advance(0);
    const frames = engine.cashout('p1', 100);
    expect(find(frames, 'command_rejected')?.reason).toBe('no_active_bet');
  });

  it('refuses a second cashout', () => {
    const engine = flyingEngine(5);
    engine.join('p1');
    engine.advance(0);
    engine.placeBet('p1', 1000, null, 0);
    engine.advance(0);
    engine.advance(0);
    engine.cashout('p1', 100);
    const frames = engine.cashout('p1', 150);
    expect(find(frames, 'command_rejected')?.reason).toBe('already_cashed_out');
  });

  it('settles each player exactly once per round', () => {
    const engine = flyingEngine(3);
    engine.join('p1');
    engine.advance(0);
    engine.placeBet('p1', 1000, null, 0);
    engine.advance(0);
    engine.advance(0);

    const frames = runClock(engine, 0, timeToReach(3) + 2000, 25);
    const settlements = frames.filter((f) => f.message.type === 'settled');
    expect(settlements).toHaveLength(1);
  });
});

describe('round engine — money conservation', () => {
  it('never creates or destroys money across many rounds', () => {
    // The strongest invariant available: whatever the RNG does, the sum of
    // balance plus outstanding stake must only change by settled payouts.
    const engine = createRoundEngine({
      timing: {
        bettingMs: 100,
        launchDelayMs: 50,
        tickIntervalMs: 50,
        intermissionMs: 50,
      },
      random: seededRandom(12_345),
      startingBalance: 100_000,
    });
    engine.join('p1');

    let balance = 100_000;
    let settlements = 0;

    for (let now = 0; now < 60_000; now += 25) {
      const frames = engine.advance(now);

      // Bet whenever a round opens.
      if (frames.some((f) => f.message.type === 'round_opened')) {
        const bet = engine.placeBet('p1', 1000, null, now);
        const accepted = bet.find((f) => f.message.type === 'bet_accepted');
        if (accepted?.message.type === 'bet_accepted') {
          balance = accepted.message.balance;
        }
      }

      for (const frame of frames) {
        if (frame.message.type === 'settled') {
          const expected = balance + frame.message.payout;
          expect(frame.message.balance).toBe(expected);
          balance = frame.message.balance;
          settlements += 1;
        }
      }
    }

    // The loop may end mid-round with a live bet, so `staked` is not
    // necessarily zero; what must hold is that every settlement moved the
    // balance by exactly its payout, which is asserted above.
    expect(settlements).toBeGreaterThan(3);
    expect(balance).not.toBe(100_000);
  });
});

describe('round engine — late joiners', () => {
  /** Advance the engine into a chosen phase and snapshot a new player. */
  const snapshotIn = (
    phase: 'intermission' | 'betting' | 'launching' | 'flying',
  ): string[] => {
    const engine = createRoundEngine({
      timing: {
        bettingMs: 1000,
        launchDelayMs: 1000,
        tickIntervalMs: 100,
        intermissionMs: 1000,
      },
      random: fixedCrashAt(10),
    });
    let now = 0;
    if (phase !== 'intermission') {
      engine.advance(now); // -> betting
      if (phase !== 'betting') {
        now += 1000;
        engine.advance(now); // -> launching
        if (phase !== 'launching') {
          now += 1000;
          engine.advance(now); // -> flying
          now += 300;
          engine.advance(now);
        }
      }
    }
    engine.join('late');
    return types(engine.snapshotFor('late', now));
  };

  it('sends nothing during the intermission', () => {
    expect(snapshotIn('intermission')).toEqual([]);
  });

  it('sends just the open round while betting', () => {
    expect(snapshotIn('betting')).toEqual(['round_opened']);
  });

  it('covers the launch delay so the client is not left roundless', () => {
    // Regression: this phase used to produce an empty snapshot, stranding
    // a client that connected between bets closing and launch.
    expect(snapshotIn('launching')).toEqual(['round_opened', 'bets_closed']);
  });

  it('replays the flight and the current multiplier mid-round', () => {
    expect(snapshotIn('flying')).toEqual([
      'round_opened',
      'bets_closed',
      'launched',
      'tick',
    ]);
  });

  it('never advertises a betting window that has already closed', () => {
    const engine = createRoundEngine({
      timing: { bettingMs: 1000, launchDelayMs: 1000, intermissionMs: 0 },
      random: fixedCrashAt(5),
    });
    engine.advance(0);
    engine.advance(1000); // bets_closed -> launching
    engine.join('late');

    const now = 1200;
    const frames = engine.snapshotFor('late', now);
    const opened = find(frames, 'round_opened');
    // A future betsCloseAt here would show a countdown for a bet the
    // player can no longer place.
    expect(opened?.betsCloseAt).toBeLessThanOrEqual(now);
  });

  it('lets a snapshot feed the client machine into the right phase', () => {
    const engine = createRoundEngine({
      timing: { bettingMs: 0, launchDelayMs: 0, tickIntervalMs: 100 },
      random: fixedCrashAt(10),
    });
    engine.advance(0);
    engine.advance(0);
    engine.advance(0);
    engine.advance(500);
    engine.join('late');

    let state = INITIAL_ROUND_STATE;
    for (const frame of engine.snapshotFor('late', 500)) {
      const event = toRoundEvent(frame.message, state);
      if (event !== null) state = transition(state, event);
    }
    expect(state.phase).toBe('flying');
    expect(state.multiplier).toBeGreaterThan(1);
  });
});
