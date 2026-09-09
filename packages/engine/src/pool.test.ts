import { describe, expect, it, vi } from 'vitest';
import { ObjectPool } from './pool.js';

describe('ObjectPool', () => {
  it('prebuilds initialSize instances', () => {
    const pool = new ObjectPool({ create: () => ({ id: 0 }), initialSize: 3 });
    expect(pool.freeCount).toBe(3);
    expect(pool.activeCount).toBe(0);
  });

  it('reuses a released instance rather than creating a new one', () => {
    const create = vi.fn(() => ({ id: 0 }));
    const pool = new ObjectPool({ create });
    const first = pool.acquire();
    pool.release(first);
    expect(pool.acquire()).toBe(first);
    expect(create).toHaveBeenCalledOnce();
  });

  it('resets an instance on release', () => {
    const pool = new ObjectPool<{ used: boolean }>({
      create: () => ({ used: false }),
      reset: (item) => {
        item.used = false;
      },
    });
    const item = pool.acquire();
    item.used = true;
    pool.release(item);
    expect(pool.acquire().used).toBe(false);
  });

  it('disposes instead of growing past maxSize', () => {
    const dispose = vi.fn();
    const pool = new ObjectPool({ create: () => ({}), maxSize: 1, dispose });
    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b); // over budget
    expect(dispose).toHaveBeenCalledOnce();
    expect(pool.freeCount).toBe(1);
  });

  it('tracks activeCount across acquire and release', () => {
    const pool = new ObjectPool({ create: () => ({}) });
    const a = pool.acquire();
    pool.acquire();
    expect(pool.activeCount).toBe(2);
    pool.release(a);
    expect(pool.activeCount).toBe(1);
  });

  it('clear disposes every free instance', () => {
    const dispose = vi.fn();
    const pool = new ObjectPool({ create: () => ({}), initialSize: 2, dispose });
    pool.clear();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(pool.freeCount).toBe(0);
  });
});
