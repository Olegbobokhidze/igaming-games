/**
 * Generic object pool.
 *
 * Crash rounds spawn particles and explosion sprites in bursts; allocating
 * them per frame is what produces GC sawtooth and dropped frames mid-flight.
 * The pool keeps a free list so steady-state allocation is zero.
 */

export interface PoolOptions<T> {
  /** Build a brand new instance when the free list is empty. */
  readonly create: () => T;
  /** Return an instance to a neutral state before reuse. */
  readonly reset?: (item: T) => void;
  /** Release native resources when the pool is dropped. */
  readonly dispose?: (item: T) => void;
  /** Instances to build up front, avoiding a first-use hitch. */
  readonly initialSize?: number;
  /** Upper bound on retained free instances. 0 means unbounded. */
  readonly maxSize?: number;
}

export class ObjectPool<T> {
  readonly #free: T[] = [];
  readonly #options: PoolOptions<T>;
  #createdCount = 0;

  constructor(options: PoolOptions<T>) {
    this.#options = options;
    const initial = options.initialSize ?? 0;
    for (let i = 0; i < initial; i += 1) {
      this.#free.push(this.#instantiate());
    }
  }

  /** Instances handed out and not yet returned. */
  get activeCount(): number {
    return this.#createdCount - this.#free.length;
  }

  get freeCount(): number {
    return this.#free.length;
  }

  acquire(): T {
    const pooled = this.#free.pop();
    if (pooled !== undefined) return pooled;
    return this.#instantiate();
  }

  release(item: T): void {
    this.#options.reset?.(item);
    const max = this.#options.maxSize ?? 0;
    if (max > 0 && this.#free.length >= max) {
      // Over budget: drop it instead of growing the free list forever.
      this.#options.dispose?.(item);
      this.#createdCount -= 1;
      return;
    }
    this.#free.push(item);
  }

  /** Dispose every free instance. Active instances are the caller's problem. */
  clear(): void {
    for (const item of this.#free) {
      this.#options.dispose?.(item);
    }
    this.#free.length = 0;
    this.#createdCount = 0;
  }

  #instantiate(): T {
    this.#createdCount += 1;
    return this.#options.create();
  }
}

// TODO(stage-2): add a ParticlePool built on this that also parents/unparents
// the sprite from its Container on acquire/release, plus a per-round
// high-water-mark log so pool sizes can be tuned against real traffic.
