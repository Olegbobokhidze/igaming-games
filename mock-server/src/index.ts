import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createRoundEngine,
  parseClientMessage,
  toMultiplier,
  type BetEntry,
  type Outbound,
  type ServerMessage,
} from '@igaming/core';
import { createBotPool } from './bots.js';

/**
 * Mock game server.
 *
 * All the round logic lives in `@igaming/core`'s round engine, which is
 * clock-free and unit-tested. This file is only the parts a test cannot
 * cover: a socket, a timer and player identity.
 *
 * It is a mock in one important sense — the crash point comes from
 * `Math.random` and is not provably fair. A production server derives it
 * from a pre-committed server seed plus a client seed so a player can
 * verify afterwards that the house did not choose the number once it knew
 * their bet.
 */

const PORT = Number(process.env['MOCK_SERVER_PORT'] ?? 8080);

/** How often the engine's clock is advanced. */
const LOOP_INTERVAL_MS = 50;

/** Keepalive cadence, independent of the round loop. */
const HEARTBEAT_INTERVAL_MS = 1000;

/** How often the shared bet list is rebroadcast while a round runs. */
const BOARD_INTERVAL_MS = 400;

/** Finished rounds kept in memory for the history and leaderboard tabs. */
const HISTORY_LIMIT = 60;

const server = new WebSocketServer({ port: PORT });
const engine = createRoundEngine();
const bots = createBotPool(engine);

/** Socket for each connected player. */
const sockets = new Map<string, WebSocket>();

/** Display name for each human player. Bots carry their own. */
const humanNames = new Map<string, string>();

/** Finished rounds, newest first. */
const history: Extract<ServerMessage, { type: 'round_result' }>[] = [];

const displayName = (playerId: string): string =>
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
      name: displayName(seat.playerId),
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

const broadcastBoard = (): void => {
  const { entries, totalStake, totalPayout } = buildEntries();
  const frame: ServerMessage = {
    type: 'bet_board',
    roundId: engine.roundId(),
    entries,
    totalStake,
    totalPayout,
  };
  for (const socket of sockets.values()) send(socket, frame);
};

const send = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
};

/**
 * Deliver what the engine produced.
 *
 * `to === null` is a broadcast; anything else is addressed to one player.
 * The engine never touches a socket itself, which is what lets it run
 * against a fake clock in tests.
 */
const deliver = (frames: readonly Outbound[]): void => {
  for (const frame of frames) {
    if (frame.to === null) {
      for (const socket of sockets.values()) send(socket, frame.message);
      continue;
    }
    const socket = sockets.get(frame.to);
    if (socket !== undefined) send(socket, frame.message);
  }
};

/** Log the round's shape so the terminal shows what the browser is seeing. */
const logFrame = (message: ServerMessage): void => {
  switch (message.type) {
    case 'round_opened':
      console.log(`[mock] ${message.roundId} betting open`);
      break;
    case 'launched':
      console.log(`[mock] ${message.roundId} launched`);
      break;
    case 'crashed':
      console.log(
        `[mock] ${message.roundId} crashed at ${toMultiplier(message.multiplier).toFixed(2)}x`,
      );
      break;
    default:
      break;
  }
};

let lastBoardAt = 0;

const loop = setInterval(() => {
  const now = Date.now();
  const frames = engine.advance(now);
  for (const frame of frames) {
    if (frame.to === null) logFrame(frame.message);
  }
  deliver(frames);

  for (const frame of frames) {
    if (frame.to !== null) continue;

    // Bots join the round the moment it opens, through the same engine
    // calls a human uses — nothing downstream can tell them apart.
    if (frame.message.type === 'round_opened') {
      bots.placeBets(now);
      broadcastBoard();
    }

    // The crash is the last moment the seats still hold this round's
    // outcome, so the history entry is captured here before they reset.
    if (frame.message.type === 'crashed') {
      const { entries, totalStake, totalPayout } = buildEntries();
      const result: Extract<ServerMessage, { type: 'round_result' }> = {
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
      for (const socket of sockets.values()) send(socket, result);
    }
  }

  // Refresh the board on a slower cadence than the tick loop: it changes
  // only when someone cashes out, and 20Hz of list churn helps nobody.
  if (now - lastBoardAt >= BOARD_INTERVAL_MS && engine.phase() === 'flying') {
    lastBoardAt = now;
    broadcastBoard();
  }
}, LOOP_INTERVAL_MS);

let seq = 0;
const heartbeat = setInterval(() => {
  seq += 1;
  const frame: ServerMessage = { type: 'heartbeat', ts: Date.now(), seq };
  for (const socket of sockets.values()) send(socket, frame);
}, HEARTBEAT_INTERVAL_MS);

server.on('connection', (socket, request) => {
  // One anonymous seat per connection. A real server would authenticate
  // and look up an existing wallet instead.
  const playerId = randomUUID();
  sockets.set(playerId, socket);
  humanNames.set(playerId, `You`);
  const balance = engine.join(playerId);
  console.log(
    `[mock] player ${playerId.slice(0, 8)} joined from ${request.socket.remoteAddress ?? 'unknown'} with ${String(balance)}`,
  );

  // Catch the new arrival up with the round already in progress.
  deliver(engine.snapshotFor(playerId, Date.now()));

  // Replay recent history so the side panel is populated immediately
  // rather than filling in one round at a time.
  for (const result of [...history].reverse()) send(socket, result);
  broadcastBoard();

  socket.on('message', (raw: Buffer) => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw.toString('utf8'));
    } catch {
      console.warn('[mock] dropped unparseable frame');
      return;
    }

    // The socket is untrusted input even here: validate before acting.
    const command = parseClientMessage(decoded);
    if (command === null) {
      console.warn('[mock] dropped invalid command');
      return;
    }

    const now = Date.now();
    switch (command.type) {
      case 'place_bet':
        deliver(engine.placeBet(playerId, command.stake, command.autoCashoutAt, now));
        broadcastBoard();
        break;
      case 'cashout':
        deliver(engine.cashout(playerId, now));
        broadcastBoard();
        break;
    }
  });

  socket.on('close', () => {
    sockets.delete(playerId);
    humanNames.delete(playerId);
    engine.leave(playerId);
    console.log(`[mock] player ${playerId.slice(0, 8)} left`);
  });

  socket.on('error', (error) => {
    console.error('[mock] socket error:', error);
  });
});

server.on('listening', () => {
  console.log(`[mock] websocket server listening on ws://localhost:${String(PORT)}`);
});

server.on('error', (error) => {
  console.error('[mock] server error:', error);
});

const shutdown = (): void => {
  clearInterval(loop);
  clearInterval(heartbeat);
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
