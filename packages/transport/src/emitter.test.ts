import { describe, expect, it, vi } from 'vitest';
import { Emitter } from './emitter.js';

interface TestEvents extends Record<string, unknown> {
  ping: number;
  done: void;
}

describe('Emitter', () => {
  it('delivers payloads to subscribers', () => {
    const emitter = new Emitter<TestEvents>();
    const listener = vi.fn();
    emitter.on('ping', listener);
    emitter.emit('ping', 42);
    expect(listener).toHaveBeenCalledWith(42);
  });

  it('stops delivering after the returned unsubscribe runs', () => {
    const emitter = new Emitter<TestEvents>();
    const listener = vi.fn();
    const off = emitter.on('ping', listener);
    off();
    emitter.emit('ping', 1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('tolerates a listener unsubscribing during dispatch', () => {
    const emitter = new Emitter<TestEvents>();
    const second = vi.fn();
    const off = emitter.on('ping', () => off());
    emitter.on('ping', second);
    expect(() => emitter.emit('ping', 1)).not.toThrow();
    // The second listener must still receive the event.
    expect(second).toHaveBeenCalledOnce();
  });

  it('emitting an event with no listeners is a no-op', () => {
    const emitter = new Emitter<TestEvents>();
    expect(() => emitter.emit('done', undefined)).not.toThrow();
  });
});
