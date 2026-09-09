/**
 * Wire protocol between client and game server.
 *
 * Every inbound frame is parsed through Zod before it reaches game code:
 * the socket is untrusted input. Only the heartbeat is modelled for now,
 * because that is the only frame the mock server actually sends.
 */

import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

/** Server -> client keepalive, emitted once per second by the mock server. */
export const heartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  /** Server clock in epoch milliseconds. */
  ts: z.number().int().nonnegative(),
  /** Monotonic counter, useful for spotting dropped frames. */
  seq: z.number().int().nonnegative(),
});

export type Heartbeat = z.infer<typeof heartbeatSchema>;

/**
 * Discriminated union of everything the server can send. Currently a union
 * of one; new frames get added as separate schemas and joined here.
 */
export const serverMessageSchema = z.discriminatedUnion('type', [heartbeatSchema]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Messages the client sends upstream. */
export type ClientMessage = { readonly type: 'ping' };

/**
 * Parse an untrusted frame. Returns `null` instead of throwing so a single
 * malformed frame cannot tear down the socket loop.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  const result = serverMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// TODO(stage-2): model round frames (round_opened, bets_closed, tick,
// crashed, settled) and the client commands (place_bet, cashout), then
// derive the FSM's RoundEvent from these schemas so the two cannot drift.
