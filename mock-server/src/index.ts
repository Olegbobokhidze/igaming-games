import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createRoundEngine,
  parseClientMessage,
  toMultiplier,
  type Outbound,
  type ServerMessage,
} from '@igaming/core';

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

const server = new WebSocketServer({ port: PORT });
const engine = createRoundEngine();

/** Socket for each connected player. */
const sockets = new Map<string, WebSocket>();

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

const loop = setInterval(() => {
  const frames = engine.advance(Date.now());
  for (const frame of frames) {
    if (frame.to === null) logFrame(frame.message);
  }
  deliver(frames);
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
  const balance = engine.join(playerId);
  console.log(
    `[mock] player ${playerId.slice(0, 8)} joined from ${request.socket.remoteAddress ?? 'unknown'} with ${String(balance)}`,
  );

  // Catch the new arrival up with the round already in progress.
  deliver(engine.snapshotFor(playerId, Date.now()));

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
        break;
      case 'cashout':
        deliver(engine.cashout(playerId, now));
        break;
    }
  });

  socket.on('close', () => {
    sockets.delete(playerId);
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
