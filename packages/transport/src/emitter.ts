/** Minimal typed event emitter — no dependency on Node's EventEmitter. */

export type Listener<T> = (payload: T) => void;

/** Maps event name to its payload type. */
export type EventMap = Record<string, unknown>;

export class Emitter<M extends EventMap> {
  readonly #listeners = new Map<keyof M, Set<Listener<never>>>();

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof M>(event: K, listener: Listener<M[K]>): () => void {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof M>(event: K, listener: Listener<M[K]>): void {
    this.#listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.#listeners.get(event);
    if (set === undefined) return;
    // Copy first: a listener may unsubscribe itself during dispatch.
    for (const listener of [...set]) {
      (listener as Listener<M[K]>)(payload);
    }
  }

  removeAll(): void {
    this.#listeners.clear();
  }
}
