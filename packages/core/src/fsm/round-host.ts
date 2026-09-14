import { createBotPool, type BotPool } from './bots.js';
import { createRoundEngine, type Outbound, type RoundEngine } from './round-engine.js';
import type { BetEntry, ServerMessage } from '../protocol/index.js';

/**
 * The parts of a game server that are not the transport.
 *
 * The round engine is clock-free and knows nothing about players' names,
 * bots, history or broadcasting. Wiring those together used to live in the
 * mock WebSocket server, which meant a browser-only build had no way to run
 * a round without reimplementing it — and two copies of a payout loop is
 * exactly the kind of duplication that drifts into a real discrepancy.
 *
 * So it lives here instead, with the transport left to the caller: feed it a
 * clock with `advance`, hand it commands, and take the frames it returns.
 * A WebSocket server sends them over a socket; an in-browser host delivers
 * them straight to the client. Neither contains any round logic.
 */

/** Finished rounds kept for the history and leaderboard tabs. */
const HISTORY_LIMIT = 60;

/** How often the shared bet list is rebuilt while a round runs. */
const BOARD_INTERVAL_MS = 400;

export type RoundResultFrame = Extract<ServerMessage, { type: 'round_result' }>;

export interface RoundHostOptions {
  /** How many synthetic players populate the table. */
  readonly botCount?: number;
  /** Display name for the local player. */
  readonly playerName?: string;
}

export interface RoundHost {
  /** The engine, for callers that need to inspect the round directly. */
  readonly engine: RoundEngine;
  readonly bots: BotPool;
  /**
   * Seat the local player and return the frames that catch them up with
   * whatever round is already in progress, plus recent history.
   */
  join: (playerId: string, now: number) => readonly Outbound[];
  leave: (playerId: string) => void;
  /**
   * Advance the clock. Returns everything that should reach clients,
   * including the board refreshes and history entries the engine itself
   * does not produce.
   */
  advance: (now: number) => readonly Outbound[];
  placeBet: (
    playerId: string,
    stake: number,
    autoCashoutAt: number | null,
    now: number,
  ) => readonly Outbound[];
  cashout: (playerId: string, now: number) => readonly Outbound[];
  /** Display name for a seat, bots included. */
  nameOf: (playerId: string) => string;
  /** Finished rounds, newest first. */
  readonly history: () => readonly RoundResultFrame[];
}

export function createRoundHost(options: RoundHostOptions = {}): RoundHost {
  const { botCount = 25, playerName = 'You' } = options;

  const engine = createRoundEngine();
  const bots = createBotPool(engine, botCount);
  const humanNames = new Map<string, string>();
  const history: RoundResultFrame[] = [];
  let lastBoardAt = 0;

  const nameOf = (playerId: string): string =>
    bots.nameOf(playerId) ?? humanNames.get(playerId) ?? 'Player';

  /** Build the public bet list from the engine's seats. */
  const buildEntries = (): {
    entries: BetEntry[];
    totalStake: number;
    totalPayout: number;
  } => {
    const entries: BetEntry[] = [];
    let totalStake = 0;
    let totalPayout = 0;
    for (const seat of engine.seatViews()) {
      entries.push({
        name: nameOf(seat.playerId),
        stake: seat.stake,
        cashedOutAt: seat.cashedOutAt,
        payout: seat.payout,
      });
      totalStake += seat.stake;
      totalPayout += seat.payout ?? 0;
    }
    // Cashed-out players first, then by stake: the interesting rows are the
    // ones that resolved, and a list that reorders every tick is unreadable.
    entries.sort((a, b) => {
      if ((a.payout ?? 0) !== (b.payout ?? 0)) return (b.payout ?? 0) - (a.payout ?? 0);
      return b.stake - a.stake;
    });
    return { entries, totalStake, totalPayout };
  };

  const boardFrame = (): Outbound => {
    const { entries, totalStake, totalPayout } = buildEntries();
    return {
      to: null,
      message: {
        type: 'bet_board',
        roundId: engine.roundId(),
        entries,
        totalStake,
        totalPayout,
      },
    };
  };

  const join = (playerId: string, now: number): readonly Outbound[] => {
    humanNames.set(playerId, playerName);
    const balance = engine.join(playerId);
    const frames: Outbound[] = [
      // Lead with the balance: every other frame that carries one is the
      // result of an action, so without this a player who has not yet bet
      // sees a blank figure where their money should be.
      { to: playerId, message: { type: 'balance', balance } },
      ...engine.snapshotFor(playerId, now),
    ];
    // Replay recent history so the side panel is populated immediately
    // rather than filling in one round at a time.
    for (const result of [...history].reverse()) {
      frames.push({ to: playerId, message: result });
    }
    frames.push(boardFrame());
    return frames;
  };

  const leave = (playerId: string): void => {
    humanNames.delete(playerId);
    engine.leave(playerId);
  };

  const advance = (now: number): readonly Outbound[] => {
    const produced = engine.advance(now);
    const frames: Outbound[] = [...produced];

    for (const frame of produced) {
      if (frame.to !== null) continue;

      // Bots join the round the moment it opens, through the same engine
      // calls a human uses — nothing downstream can tell them apart.
      if (frame.message.type === 'round_opened') {
        bots.placeBets(now);
        frames.push(boardFrame());
      }

      // The crash is the last moment the seats still hold this round's
      // outcome, so the history entry is captured here before they reset.
      if (frame.message.type === 'crashed') {
        const { entries, totalStake, totalPayout } = buildEntries();
        const result: RoundResultFrame = {
          type: 'round_result',
          roundId: frame.message.roundId,
          multiplier: frame.message.multiplier,
          entries,
          totalStake,
          totalPayout,
          endedAt: now,
        };
        history.unshift(result);
        if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
        frames.push({ to: null, message: result });
      }
    }

    // Refresh the board on a slower cadence than the tick loop: it changes
    // only when someone cashes out, and 20Hz of list churn helps nobody.
    if (now - lastBoardAt >= BOARD_INTERVAL_MS && engine.phase() === 'flying') {
      lastBoardAt = now;
      frames.push(boardFrame());
    }

    return frames;
  };

  const placeBet = (
    playerId: string,
    stake: number,
    autoCashoutAt: number | null,
    now: number,
  ): readonly Outbound[] => [
    ...engine.placeBet(playerId, stake, autoCashoutAt, now),
    boardFrame(),
  ];

  const cashout = (playerId: string, now: number): readonly Outbound[] => [
    ...engine.cashout(playerId, now),
    boardFrame(),
  ];

  return {
    engine,
    bots,
    join,
    leave,
    advance,
    placeBet,
    cashout,
    nameOf,
    history: () => history,
  };
}
