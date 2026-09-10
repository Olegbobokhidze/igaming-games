/**
 * Translation between the wire protocol and the state machine's vocabulary.
 *
 * This is the only place that knows both languages. Keeping it in one
 * function means a protocol change touches one file instead of every case
 * in the transition table, and it is where wire representations are
 * converted once — fixed-point multipliers to floats, raw numbers to
 * branded `Minor` amounts — so nothing downstream has to remember.
 */

import { asMinor } from '../money/index.js';
import { toMultiplier, type ServerMessage } from '../protocol/index.js';
import type { RoundEvent, RoundState } from './index.js';

/**
 * Convert a server frame into a machine event.
 *
 * Returns `null` for frames the machine does not model — heartbeats,
 * command rejections and bet acceptances that belong to other concerns.
 * A `null` here is normal, not an error.
 *
 * `state` is needed to drop frames for a round that is no longer current:
 * after a reconnect the server may replay the tail of a finished round,
 * and feeding those into a fresh round would rewind it.
 */
export function toRoundEvent(
  message: ServerMessage,
  state: RoundState,
): RoundEvent | null {
  switch (message.type) {
    case 'round_opened':
      // Always accepted: this is what establishes the current round id.
      return {
        type: 'ROUND_OPENED',
        roundId: message.roundId,
        betsCloseAt: message.betsCloseAt,
      };

    case 'bets_closed':
      if (!isCurrentRound(message.roundId, state)) return null;
      return { type: 'BETS_CLOSED' };

    case 'launched':
      if (!isCurrentRound(message.roundId, state)) return null;
      return { type: 'LAUNCHED', startedAt: message.startedAt };

    case 'tick':
      if (!isCurrentRound(message.roundId, state)) return null;
      return {
        type: 'TICK',
        multiplier: toMultiplier(message.multiplier),
        elapsedMs: message.elapsedMs,
      };

    case 'crashed':
      if (!isCurrentRound(message.roundId, state)) return null;
      return { type: 'CRASHED', multiplier: toMultiplier(message.multiplier) };

    case 'settled':
      if (!isCurrentRound(message.roundId, state)) return null;
      return {
        type: 'SETTLED',
        payout: asMinor(message.payout),
        cashedOutAt:
          message.cashedOutAt === null ? null : toMultiplier(message.cashedOutAt),
      };

    case 'bet_accepted':
      if (!isCurrentRound(message.roundId, state)) return null;
      return { type: 'BET_ACCEPTED', stake: asMinor(message.stake) };

    // Not part of the round lifecycle: handled by the transport and UI.
    case 'heartbeat':
    case 'command_rejected':
      return null;

    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}

/**
 * Whether a frame belongs to the round the machine is currently tracking.
 *
 * Before the first `round_opened` there is no current round, so nothing
 * else can be accepted — a stray tick without a round would otherwise start
 * a phantom flight.
 */
function isCurrentRound(roundId: string, state: RoundState): boolean {
  return state.roundId !== null && state.roundId === roundId;
}
