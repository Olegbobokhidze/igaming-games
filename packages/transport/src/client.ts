import {
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@igaming/core';
import { Emitter } from './emitter.js';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'reconnecting';

/** Events the client emits. Payloads are already validated where applicable. */
export interface TransportEvents extends Record<string, unknown> {
  open: void;
  close: { readonly code: number; readonly reason: string };
  message: ServerMessage;
  /** A frame that arrived but failed schema validation. */
  invalid: { readonly raw: string };
  error: { readonly error: unknown };
  status: ConnectionStatus;
}

/** Knobs for the backoff policy. Consumed in stage 2. */
export interface ReconnectOptions {
  readonly enabled: boolean;
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  /** Multiplier applied to the delay after each failed attempt. */
  readonly backoffFactor: number;
}

export const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true,
  maxRetries: 10,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  backoffFactor: 2,
};

export interface TransportOptions {
  readonly url: string;
  readonly reconnect?: Partial<ReconnectOptions>;
}

export class TransportClient {
  readonly #events = new Emitter<TransportEvents>();
  readonly #url: string;
  readonly #reconnect: ReconnectOptions;

  #socket: WebSocket | null = null;
  #status: ConnectionStatus = 'idle';
  /** Attempts since the last successful open; reset on `open`. */
  #retries = 0;

  constructor(options: TransportOptions) {
    this.#url = options.url;
    this.#reconnect = { ...DEFAULT_RECONNECT, ...options.reconnect };
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  get reconnectOptions(): ReconnectOptions {
    return this.#reconnect;
  }

  readonly on = <K extends keyof TransportEvents>(
    event: K,
    listener: (payload: TransportEvents[K]) => void,
  ): (() => void) => this.#events.on(event, listener);

  readonly off = <K extends keyof TransportEvents>(
    event: K,
    listener: (payload: TransportEvents[K]) => void,
  ): void => this.#events.off(event, listener);

  connect(): void {
    // Guard against double-connect: React Strict Mode mounts effects twice.
    if (this.#socket !== null) return;

    this.#setStatus('connecting');
    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#retries = 0;
      this.#setStatus('open');
      this.#events.emit('open', undefined);
    });

    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      const raw = typeof event.data === 'string' ? event.data : null;
      if (raw === null) return; // binary frames are unused for now

      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        this.#events.emit('invalid', { raw });
        return;
      }

      const message = parseServerMessage(decoded);
      if (message === null) {
        this.#events.emit('invalid', { raw });
        return;
      }
      this.#events.emit('message', message);
    });

    socket.addEventListener('error', (error: Event) => {
      this.#events.emit('error', { error });
    });

    socket.addEventListener('close', (event: CloseEvent) => {
      this.#socket = null;
      this.#setStatus('closed');
      this.#events.emit('close', { code: event.code, reason: event.reason });
      // TODO(stage-2): if `#reconnect.enabled` and `#retries < maxRetries`,
      // schedule a retry after `nextDelay()` and transition to 'reconnecting'
      // instead of settling on 'closed'.
    });
  }

  /** Close the socket and drop every listener. Safe to call when idle. */
  disconnect(): void {
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      // Detach before closing so the close handler cannot re-enter.
      socket.onclose = null;
      socket.close(1000, 'client disconnect');
    }
    this.#setStatus('closed');
    this.#events.removeAll();
  }

  /** Serialise and send. Returns false when the socket is not open. */
  send(message: ClientMessage): boolean {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  /**
   * Backoff delay that the (not yet implemented) reconnect loop will use
   * for the current attempt. Exposed so the policy is unit-testable before
   * the loop itself exists. TODO(stage-2): add jitter.
   */
  nextDelayMs(): number {
    const { initialDelayMs, backoffFactor, maxDelayMs } = this.#reconnect;
    return Math.min(initialDelayMs * backoffFactor ** this.#retries, maxDelayMs);
  }

  #setStatus(status: ConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#events.emit('status', status);
  }
}
