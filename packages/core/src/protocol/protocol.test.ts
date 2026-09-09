import { describe, expect, it } from 'vitest';
import { parseServerMessage } from './index.js';

describe('parseServerMessage', () => {
  it('accepts a well-formed heartbeat', () => {
    const message = parseServerMessage({
      type: 'heartbeat',
      ts: 1_700_000_000_000,
      seq: 7,
    });
    expect(message).toEqual({ type: 'heartbeat', ts: 1_700_000_000_000, seq: 7 });
  });

  it('rejects an unknown frame type instead of throwing', () => {
    expect(parseServerMessage({ type: 'crashed', multiplier: 2 })).toBeNull();
  });

  it('rejects a heartbeat with a malformed field', () => {
    expect(parseServerMessage({ type: 'heartbeat', ts: 'now', seq: 1 })).toBeNull();
  });

  it('rejects non-object input', () => {
    expect(parseServerMessage('heartbeat')).toBeNull();
    expect(parseServerMessage(null)).toBeNull();
  });
});
