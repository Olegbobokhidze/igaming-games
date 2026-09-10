/**
 * Wire protocol between client and game server.
 *
 * Every inbound frame is parsed through Zod before it reaches game code:
 * the socket is untrusted input, even in development. A malformed frame
 * must never reach the state machine, and must never throw — one bad
 * packet cannot be allowed to tear down a live round.
 *
 * The server is the single source of truth. The client never decides when a
 * round crashes or what a cashout pays; it renders what it is told. Any
 * number the client computes locally (the multiplier between ticks, say) is
 * presentation only and is corrected by the next authoritative frame.
 */

import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

/**
 * Multipliers are sent as fixed-point hundredths (250 === 2.50x) rather
 * than floats.
 *
 * A float multiplier would be compared against the player's auto-cashout
 * threshold and multiplied into a balance, and 2.5 is exactly representable
 * while 2.33 is not. Sending integers means client and server agree on the
 * value bit for bit, and the only place a decimal appears is the display
 * layer.
 */
export const MULTIPLIER_SCALE = 100;

/** Convert a wire multiplier to a display float. 250 -> 2.5 */
export const toMultiplier = (scaled: number): number => scaled / MULTIPLIER_SCALE;

/** Convert a display float to the wire representation. 2.5 -> 250 */
export const fromMultiplier = (value: number): number =>
  Math.round(value * MULTIPLIER_SCALE);

/** A round identifier. Opaque to the client — never parsed or ordered. */
const roundId = z.string().min(1).max(64);

/** Epoch milliseconds on the server's clock. */
const timestamp = z.number().int().nonnegative();

/** An amount in integer minor units (cents). Never a float. */
const minorAmount = z.number().int();

/** A wire multiplier: hundredths, never below 1.00x. */
const scaledMultiplier = z.number().int().min(MULTIPLIER_SCALE);

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

/** Keepalive, emitted once per second regardless of round state. */
export const heartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  ts: timestamp,
  /** Monotonic counter, useful for spotting dropped frames. */
  seq: z.number().int().nonnegative(),
});

/** A new round is accepting bets. */
export const roundOpenedSchema = z.object({
  type: z.literal('round_opened'),
  roundId,
  /** Server time at which betting closes, so the client can show a timer. */
  betsCloseAt: timestamp,
});

/** Betting is closed; the round is about to launch. */
export const betsClosedSchema = z.object({
  type: z.literal('bets_closed'),
  roundId,
});

/** The rocket has left the pad and the multiplier is now climbing. */
export const launchedSchema = z.object({
  type: z.literal('launched'),
  roundId,
  startedAt: timestamp,
});

/**
 * Periodic multiplier update while flying.
 *
 * `elapsedMs` is included alongside the multiplier even though one implies
 * the other: it lets the client re-derive the curve locally between ticks
 * without guessing how long ago this frame was produced.
 */
export const tickSchema = z.object({
  type: z.literal('tick'),
  roundId,
  multiplier: scaledMultiplier,
  elapsedMs: z.number().int().nonnegative(),
});

/** The round is over. This multiplier is final and authoritative. */
export const crashedSchema = z.object({
  type: z.literal('crashed'),
  roundId,
  multiplier: scaledMultiplier,
});

/**
 * Settlement for this player's bet in the round.
 *
 * `payout` is 0 for a loss. `cashedOutAt` is null when the player never
 * cashed out — the two together say what happened without the client
 * having to infer it.
 */
export const settledSchema = z.object({
  type: z.literal('settled'),
  roundId,
  payout: minorAmount,
  cashedOutAt: scaledMultiplier.nullable(),
  /** Player balance after settlement, so the client never has to compute it. */
  balance: minorAmount,
});

/** A bet was accepted. Echoes the stake so the client can reconcile. */
export const betAcceptedSchema = z.object({
  type: z.literal('bet_accepted'),
  roundId,
  stake: minorAmount,
  balance: minorAmount,
});

/**
 * A command was refused. `reason` is a stable machine-readable code; any
 * player-facing wording is the client's business, not the server's.
 */
export const commandRejectedSchema = z.object({
  type: z.literal('command_rejected'),
  reason: z.enum([
    'bets_closed',
    'insufficient_funds',
    'already_bet',
    'no_active_bet',
    'not_flying',
    'already_cashed_out',
  ]),
});

/**
 * Everything the server can send.
 *
 * A discriminated union on `type` means Zod picks exactly one schema by the
 * tag instead of trying each in turn, so an unknown `type` fails fast and
 * the resulting TypeScript union narrows properly in a switch.
 */
export const serverMessageSchema = z.discriminatedUnion('type', [
  heartbeatSchema,
  roundOpenedSchema,
  betsClosedSchema,
  launchedSchema,
  tickSchema,
  crashedSchema,
  settledSchema,
  betAcceptedSchema,
  commandRejectedSchema,
]);

export type Heartbeat = z.infer<typeof heartbeatSchema>;
export type RoundOpened = z.infer<typeof roundOpenedSchema>;
export type BetsClosed = z.infer<typeof betsClosedSchema>;
export type Launched = z.infer<typeof launchedSchema>;
export type Tick = z.infer<typeof tickSchema>;
export type Crashed = z.infer<typeof crashedSchema>;
export type Settled = z.infer<typeof settledSchema>;
export type BetAccepted = z.infer<typeof betAcceptedSchema>;
export type CommandRejected = z.infer<typeof commandRejectedSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

/**
 * Place a stake on the open round.
 *
 * `autoCashoutAt` is sent with the bet rather than applied client-side.
 * A client-side auto-cashout would fire late by exactly the network
 * round-trip, which on a fast crash is the difference between winning and
 * losing — so the authority for it has to sit next to the curve.
 */
export const placeBetSchema = z.object({
  type: z.literal('place_bet'),
  stake: minorAmount.positive(),
  autoCashoutAt: scaledMultiplier.nullable(),
});

/** Cash out the active bet right now, at whatever the server's clock says. */
export const cashoutSchema = z.object({
  type: z.literal('cashout'),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  placeBetSchema,
  cashoutSchema,
]);

export type PlaceBet = z.infer<typeof placeBetSchema>;
export type Cashout = z.infer<typeof cashoutSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse an untrusted server frame. Returns `null` rather than throwing so a
 * single malformed frame cannot tear down the socket loop.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  const result = serverMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Same, for frames arriving at the server from a client. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  const result = clientMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
