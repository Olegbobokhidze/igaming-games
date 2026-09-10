/**
 * Server-side round engine.
 *
 * Owns the authoritative state of one round: when it opens, when it
 * launches, where it crashes and what each player is paid. The mock server
 * wraps this in a socket and a timer; putting the logic here means it can
 * be driven by a fake clock in a test and reused by a real server later.
 *
 * The engine is deliberately clock-free. `advance(now)` is called with the
 * current time and returns the frames to broadcast, so a test can step
 * through a whole round in microseconds and get byte-identical output.
 */

import { drawCrashPoint } from './crash-point.js';
import { scaledMultiplierAt, timeToReach } from './curve.js';
import { asMinor, canAfford, payoutFor, type Minor } from '../money/index.js';
import {
  fromMultiplier,
  toMultiplier,
  type CommandRejected,
  type ServerMessage,
} from '../protocol/index.js';

/** Timing of a round, in milliseconds. */
export interface RoundTiming {
  /** How long bets stay open. */
  readonly bettingMs: number;
  /** Pause between bets closing and launch, for the countdown to land. */
  readonly launchDelayMs: number;
  /** How often a tick frame goes out while flying. */
  readonly tickIntervalMs: number;
  /** Pause after settlement before the next round opens. */
  readonly intermissionMs: number;
}

export const DEFAULT_TIMING: RoundTiming = {
  bettingMs: 6_000,
  launchDelayMs: 1_500,
  tickIntervalMs: 100,
  intermissionMs: 4_000,
};

/** A player's position in the current round. */
interface Seat {
  balance: Minor;
  stake: Minor | null;
  /** Wire multiplier the player asked to be cashed out at, if any. */
  autoCashoutAt: number | null;
  /** Wire multiplier they actually cashed out at, once they have. */
  cashedOutAt: number | null;
  /** Set once settlement has been sent, so it is not sent twice. */
  settled: boolean;
}

/** Internal phase, mirroring the client machine but server-owned. */
type EnginePhase = 'betting' | 'launching' | 'flying' | 'crashed' | 'intermission';

/** A frame plus who should receive it. */
export interface Outbound {
  /** null means broadcast to everyone. */
  readonly to: string | null;
  readonly message: ServerMessage;
}

export interface RoundEngineOptions {
  readonly timing?: Partial<RoundTiming>;
  /** Injected so a seeded generator can replay a session. */
  readonly random?: () => number;
  /** Starting balance handed to each new player, in minor units. */
  readonly startingBalance?: number;
}

export interface RoundEngine {
  /** Register a player and return their opening balance. */
  join: (playerId: string) => Minor;
  leave: (playerId: string) => void;
  /** Frames a joining player needs to catch up with the round in progress. */
  snapshotFor: (playerId: string, now: number) => Outbound[];
  placeBet: (
    playerId: string,
    stake: number,
    autoCashoutAt: number | null,
    now: number,
  ) => Outbound[];
  cashout: (playerId: string, now: number) => Outbound[];
  /** Drive the clock forward. Returns frames to send, possibly empty. */
  advance: (now: number) => Outbound[];
  /** Current round id, for logging. */
  readonly roundId: () => string;
  readonly phase: () => EnginePhase;
}

const reject = (to: string, reason: CommandRejected['reason']): Outbound => ({
  to,
  message: { type: 'command_rejected', reason },
});

export function createRoundEngine(options: RoundEngineOptions = {}): RoundEngine {
  const timing: RoundTiming = { ...DEFAULT_TIMING, ...options.timing };
  const random = options.random ?? Math.random;
  const startingBalance = options.startingBalance ?? 100_000;

  const seats = new Map<string, Seat>();

  let phase: EnginePhase = 'intermission';
  let roundCounter = 0;
  let roundId = 'r0';
  /** Absolute time at which the current phase should end. */
  let phaseEndsAt = 0;
  /** Time the rocket launched; only meaningful while flying. */
  let launchedAt = 0;
  /** Crash point for the current round, as a float multiplier. */
  let crashPoint = 1;
  /** When the curve reaches `crashPoint`. */
  let crashAt = 0;
  /** Last tick already emitted, so ticks are not duplicated. */
  let lastTickAt = 0;

  const openRound = (now: number): Outbound[] => {
    roundCounter += 1;
    roundId = `r${String(roundCounter)}`;
    phase = 'betting';
    phaseEndsAt = now + timing.bettingMs;
    crashPoint = drawCrashPoint(random);
    crashAt = 0;
    launchedAt = 0;
    lastTickAt = 0;

    // Clear every seat's round-specific state, keeping balances.
    for (const seat of seats.values()) {
      seat.stake = null;
      seat.autoCashoutAt = null;
      seat.cashedOutAt = null;
      seat.settled = false;
    }

    return [
      {
        to: null,
        message: {
          type: 'round_opened',
          roundId,
          betsCloseAt: phaseEndsAt,
        },
      },
    ];
  };

  /**
   * Settle every seat that has not been settled yet.
   *
   * Runs once the round has crashed. A seat that cashed out is paid at its
   * recorded multiplier; one that did not gets nothing. Balances were
   * already debited at bet time, so only the payout is credited here.
   */
  const settleAll = (): Outbound[] => {
    const out: Outbound[] = [];
    for (const [playerId, seat] of seats) {
      if (seat.settled) continue;
      seat.settled = true;
      if (seat.stake === null) continue;

      const payout =
        seat.cashedOutAt === null
          ? asMinor(0)
          : payoutFor(seat.stake, toMultiplier(seat.cashedOutAt));

      seat.balance = asMinor(seat.balance + payout);
      out.push({
        to: playerId,
        message: {
          type: 'settled',
          roundId,
          payout,
          cashedOutAt: seat.cashedOutAt,
          balance: seat.balance,
        },
      });
    }
    return out;
  };

  /**
   * Cash out anyone whose auto-cashout threshold the curve has passed.
   *
   * Evaluated server-side against the same curve the crash uses, so an
   * auto-cashout at exactly the crash point resolves consistently: the
   * threshold must be strictly below the crash to pay.
   */
  const runAutoCashouts = (scaled: number): Outbound[] => {
    const out: Outbound[] = [];
    for (const [playerId, seat] of seats) {
      if (seat.stake === null || seat.cashedOutAt !== null) continue;
      if (seat.autoCashoutAt === null) continue;
      if (scaled < seat.autoCashoutAt) continue;

      // Pay at the requested threshold, not the current tick: the player
      // asked for exactly this multiplier, and tick granularity should not
      // hand them a better price than they chose.
      //
      seat.cashedOutAt = seat.autoCashoutAt;

      // Tell the player straight away. Waiting for settlement would leave
      // them watching the rocket climb with no idea they were already out.
      out.push({
        to: playerId,
        message: {
          type: 'cashed_out',
          roundId,
          multiplier: seat.cashedOutAt,
          payout: payoutFor(seat.stake, toMultiplier(seat.cashedOutAt)),
        },
      });
    }
    return out;
  };

  const advance = (now: number): Outbound[] => {
    switch (phase) {
      case 'intermission':
        if (now < phaseEndsAt) return [];
        return openRound(now);

      case 'betting': {
        if (now < phaseEndsAt) return [];
        phase = 'launching';
        phaseEndsAt = now + timing.launchDelayMs;
        return [{ to: null, message: { type: 'bets_closed', roundId } }];
      }

      case 'launching': {
        if (now < phaseEndsAt) return [];
        phase = 'flying';
        launchedAt = now;
        crashAt = now + timeToReach(crashPoint);
        lastTickAt = now;
        return [{ to: null, message: { type: 'launched', roundId, startedAt: now } }];
      }

      case 'flying': {
        const out: Outbound[] = [];

        // Crash first: if this frame is past the crash time, no tick beyond
        // the crash point may be emitted.
        if (now >= crashAt) {
          phase = 'crashed';
          const scaled = fromMultiplier(crashPoint);
          out.push({
            to: null,
            message: { type: 'crashed', roundId, multiplier: scaled },
          });
          out.push(...settleAll());
          phaseEndsAt = now + timing.intermissionMs;
          phase = 'intermission';
          return out;
        }

        if (now - lastTickAt < timing.tickIntervalMs) return out;
        lastTickAt = now;
        const elapsedMs = now - launchedAt;
        const scaled = scaledMultiplierAt(elapsedMs);
        out.push({
          to: null,
          message: { type: 'tick', roundId, multiplier: scaled, elapsedMs },
        });
        out.push(...runAutoCashouts(scaled));
        return out;
      }

      case 'crashed':
        // Transient: `flying` moves straight through to intermission.
        return [];
    }
  };

  return {
    join: (playerId) => {
      const existing = seats.get(playerId);
      if (existing !== undefined) return existing.balance;
      const seat: Seat = {
        balance: asMinor(startingBalance),
        stake: null,
        autoCashoutAt: null,
        cashedOutAt: null,
        settled: true,
      };
      seats.set(playerId, seat);
      return seat.balance;
    },

    leave: (playerId) => {
      seats.delete(playerId);
    },

    snapshotFor: (playerId, now) => {
      // Bring a late joiner up to date with the round already in progress.
      //
      // Every phase is handled. An earlier version covered only 'betting'
      // and 'flying', which left a client that connected during the launch
      // delay with no round at all: it then had to wait for the next
      // round_opened, and any bet it sent meanwhile was rejected.
      const out: Outbound[] = [];

      // Intermission has no round to describe — the next round_opened
      // broadcast will arrive on its own, and inventing a round here would
      // give the client a phantom to reconcile.
      if (phase === 'intermission') return out;

      // Always establish the round id first: the client's adapter drops
      // every other frame until it knows which round is current.
      out.push({
        to: playerId,
        message: {
          type: 'round_opened',
          roundId,
          // Only meaningful while betting is genuinely open; past that,
          // report a window that has already closed rather than a future
          // one the player cannot actually use.
          betsCloseAt: phase === 'betting' ? phaseEndsAt : now,
        },
      });

      if (phase === 'betting') return out;

      // Betting is over in every remaining phase.
      out.push({ to: playerId, message: { type: 'bets_closed', roundId } });

      // 'launching' stops here: the rocket has not left the pad, so the
      // client should show the pre-launch state and wait for the broadcast.
      if (phase === 'launching') return out;

      out.push({
        to: playerId,
        message: { type: 'launched', roundId, startedAt: launchedAt },
      });

      // A spectator joining mid-flight needs the current multiplier
      // immediately, not on the next tick boundary.
      if (phase === 'flying') {
        const elapsedMs = now - launchedAt;
        out.push({
          to: playerId,
          message: {
            type: 'tick',
            roundId,
            multiplier: scaledMultiplierAt(elapsedMs),
            elapsedMs,
          },
        });
      }

      return out;
    },

    placeBet: (playerId, stake, autoCashoutAt, _now) => {
      const seat = seats.get(playerId);
      if (seat === undefined) return [];
      if (phase !== 'betting') return [reject(playerId, 'bets_closed')];
      if (seat.stake !== null) return [reject(playerId, 'already_bet')];

      const amount = asMinor(stake);
      if (!canAfford(seat.balance, amount)) {
        return [reject(playerId, 'insufficient_funds')];
      }

      // Debit immediately: the stake is committed the moment it is accepted,
      // and settlement only ever credits.
      seat.balance = asMinor(seat.balance - amount);
      seat.stake = amount;
      seat.autoCashoutAt = autoCashoutAt;
      seat.settled = false;

      return [
        {
          to: playerId,
          message: {
            type: 'bet_accepted',
            roundId,
            stake: amount,
            balance: seat.balance,
          },
        },
      ];
    },

    cashout: (playerId, now) => {
      const seat = seats.get(playerId);
      if (seat === undefined) return [];
      if (phase !== 'flying') return [reject(playerId, 'not_flying')];
      if (seat.stake === null) return [reject(playerId, 'no_active_bet')];
      if (seat.cashedOutAt !== null) return [reject(playerId, 'already_cashed_out')];

      // Price at the server's clock, never the client's claim.
      const scaled = scaledMultiplierAt(now - launchedAt);
      seat.cashedOutAt = scaled;
      return [
        {
          to: playerId,
          message: {
            type: 'cashed_out',
            roundId,
            multiplier: scaled,
            payout: payoutFor(seat.stake, toMultiplier(scaled)),
          },
        },
      ];
    },

    advance,
    roundId: () => roundId,
    phase: () => phase,
  };
}
