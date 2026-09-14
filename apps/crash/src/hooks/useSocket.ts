import { useCallback, useEffect, useRef } from 'react';
import {
  asMinor,
  fromMultiplier,
  toMultiplier,
  toRoundEvent,
  type ClientMessage,
} from '@igaming/core';
import { LocalTransport, TransportClient } from '@igaming/transport';
import { useAppStore } from '../state/store.js';

const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL ?? 'ws://localhost:8080';

/**
 * Run the round in the page instead of talking to a server.
 *
 * On by default, and only turned off by setting VITE_SOCKET_URL, because the
 * deployed build is static hosting with no process to hold a WebSocket open.
 * Both transports implement the same interface and speak the same protocol
 * frames, so nothing below this hook knows which one it has.
 */
const USE_LOCAL_HOST: boolean = import.meta.env.VITE_SOCKET_URL === undefined;

/**
 * What this hook needs from a transport.
 *
 * Structural, so both classes satisfy it without either declaring it — and
 * narrow, so it names only what is used rather than restating either class's
 * full surface.
 */
interface Transport {
  readonly on: TransportClient['on'];
  connect: () => void;
  disconnect: () => void;
  send: (message: ClientMessage) => boolean;
}

/** Commands the UI can send. Null while the socket is down. */
export interface SocketCommands {
  placeBet: (stake: number, autoCashoutAt: number | null) => void;
  cashout: () => void;
}

/**
 * Owns the socket for the app's lifetime and feeds the round machine.
 *
 * Strict Mode double-mounts this, so the effect fully disconnects on
 * cleanup and builds a fresh client on the second mount rather than reusing
 * a half-torn-down one.
 */
export function useSocket(): SocketCommands {
  // Held in a ref so the returned commands keep a stable identity across
  // renders and do not re-trigger effects in the components using them.
  const clientRef = useRef<Transport | null>(null);

  useEffect(() => {
    const client: Transport = USE_LOCAL_HOST
      ? new LocalTransport()
      : new TransportClient({ url: SOCKET_URL });
    clientRef.current = client;

    const store = useAppStore.getState();

    const offStatus = client.on('status', store.setStatus);

    const offMessage = client.on('message', (message) => {
      // Frames that carry a balance update it directly: the server is the
      // only authority on what a player has, and the client never derives
      // it from a payout.
      if (
        message.type === 'balance' ||
        message.type === 'bet_accepted' ||
        message.type === 'settled'
      ) {
        store.setBalance(asMinor(message.balance));
        if (message.type === 'balance') return;
      }

      if (message.type === 'cashed_out') {
        store.setCashoutWin({
          payout: asMinor(message.payout),
          at: toMultiplier(message.multiplier),
        });
      }

      if (message.type === 'bet_board') {
        store.setBoard(message);
        return;
      }

      if (message.type === 'round_result') {
        store.addResult(message);
        return;
      }

      if (message.type === 'command_rejected') {
        store.setRejection(message.reason);
        console.warn('[socket] command rejected:', message.reason);
        return;
      }

      if (message.type === 'heartbeat') {
        store.setHeartbeat(message.seq);
        return;
      }

      // Everything else goes through the adapter, which drops frames for
      // rounds that are no longer current.
      const event = toRoundEvent(message, useAppStore.getState().round);
      if (event !== null) store.dispatch(event);
    });

    const offInvalid = client.on('invalid', ({ raw }) => {
      console.warn('[socket] dropped unparseable frame:', raw);
    });

    client.connect();

    return () => {
      offStatus();
      offMessage();
      offInvalid();
      client.disconnect();
      clientRef.current = null;
    };
  }, []);

  const placeBet = useCallback((stake: number, autoCashoutAt: number | null) => {
    // Clear any stale rejection so the UI does not show last round's error.
    useAppStore.getState().setRejection(null);
    clientRef.current?.send({
      type: 'place_bet',
      stake,
      // The UI works in display multipliers; the wire wants hundredths.
      autoCashoutAt: autoCashoutAt === null ? null : fromMultiplier(autoCashoutAt),
    });
  }, []);

  const cashout = useCallback(() => {
    useAppStore.getState().setRejection(null);
    clientRef.current?.send({ type: 'cashout' });
  }, []);

  return { placeBet, cashout };
}
