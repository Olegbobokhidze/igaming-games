import {
  createRoundHost,
  parseClientMessage,
  type ClientMessage,
  type Outbound,
  type RoundHostOptions,
} from '@igaming/core';
import { Emitter } from './emitter.js';
import type { ConnectionStatus, TransportEvents } from './client.js';

/**
 * An in-process game host that speaks the socket client's interface.
 *
 * The deployed build has no server: Vercel serves static files, and a
 * WebSocket needs a process that stays alive, which serverless hosting does
 * not provide. So the round runs in the page instead — same round host, same
 * bots, same protocol frames, delivered by a timer rather than a socket.
 *
 * It deliberately implements the same surface as `TransportClient` rather
 * than exposing a friendlier one. Everything downstream — the store, the
 * frame adapter, the components — is written against that surface, so
 * matching it means the app cannot tell which transport it is running on,
 * and neither path becomes the one that only works by accident.
 *
 * The frames still go through `parseClientMessage` on the way in. Validating
 * input we generated ourselves looks redundant, but it is what keeps the two
 * transports honest: a command the real server would reject must be rejected
 * here too, or the local build would quietly accept malformed input and hide
 * a bug that only appears in production.
 */

/** How often the host's clock is advanced, matching the mock server. */
const LOOP_INTERVAL_MS = 50;

/** Keepalive cadence, so the connection indicator behaves as it does live. */
const HEARTBEAT_INTERVAL_MS = 1000;

/**
 * Delay before the local host reports itself open.
 *
 * A real connection takes a moment, and code that happens to work only
 * because its transport was synchronous breaks the first time it is not.
 * Small enough not to be a wait, large enough to keep that honest.
 */
const CONNECT_DELAY_MS = 120;

export interface LocalTransportOptions extends RoundHostOptions {
  /** Seat id for the local player. */
  readonly playerId?: string;
}

export class LocalTransport {
  readonly #events = new Emitter<TransportEvents>();
  readonly #host: ReturnType<typeof createRoundHost>;
  readonly #playerId: string;

  #status: ConnectionStatus = 'idle';
  #loop: ReturnType<typeof setInterval> | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #openTimer: ReturnType<typeof setTimeout> | null = null;
  #seq = 0;

  constructor(options: LocalTransportOptions = {}) {
    const { playerId = 'local-player', ...hostOptions } = options;
    this.#playerId = playerId;
    this.#host = createRoundHost(hostOptions);
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  readonly on = <K extends keyof TransportEvents>(
    event: K,
    listener: (payload: TransportEvents[K]) => void,
  ): (() => void) => this.#events.on(event, listener);

  #setStatus(status: ConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#events.emit('status', status);
  }

  /** Hand the app whatever the host produced, one frame at a time. */
  #deliver(frames: readonly Outbound[]): void {
    for (const frame of frames) {
      // A frame addressed to another seat is not ours to see. Bots have
      // their own ids, so their private confirmations are dropped here
      // exactly as the network would drop them.
      if (frame.to !== null && frame.to !== this.#playerId) continue;
      this.#events.emit('message', frame.message);
    }
  }

  connect(): void {
    if (this.#loop !== null || this.#openTimer !== null) return;
    this.#setStatus('connecting');

    this.#openTimer = setTimeout(() => {
      this.#openTimer = null;
      this.#setStatus('open');
      this.#events.emit('open', undefined);

      const now = Date.now();
      this.#deliver(this.#host.join(this.#playerId, now));

      this.#loop = setInterval(() => {
        this.#deliver(this.#host.advance(Date.now()));
      }, LOOP_INTERVAL_MS);

      this.#heartbeat = setInterval(() => {
        this.#seq += 1;
        this.#events.emit('message', {
          type: 'heartbeat',
          ts: Date.now(),
          seq: this.#seq,
        });
      }, HEARTBEAT_INTERVAL_MS);
    }, CONNECT_DELAY_MS);
  }

  disconnect(): void {
    if (this.#openTimer !== null) {
      clearTimeout(this.#openTimer);
      this.#openTimer = null;
    }
    if (this.#loop !== null) {
      clearInterval(this.#loop);
      this.#loop = null;
    }
    if (this.#heartbeat !== null) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
    this.#host.leave(this.#playerId);
    this.#setStatus('closed');
    this.#events.emit('close', { code: 1000, reason: 'local transport closed' });
  }

  send(message: ClientMessage): boolean {
    if (this.#status !== 'open') return false;

    // Round-trip through the parser, as described above: the local host
    // must refuse anything the real server would refuse.
    const command = parseClientMessage(message);
    if (command === null) {
      this.#events.emit('invalid', { raw: JSON.stringify(message) });
      return false;
    }

    const now = Date.now();
    switch (command.type) {
      case 'place_bet':
        this.#deliver(
          this.#host.placeBet(this.#playerId, command.stake, command.autoCashoutAt, now),
        );
        return true;
      case 'cashout':
        this.#deliver(this.#host.cashout(this.#playerId, now));
        return true;
    }
  }
}
