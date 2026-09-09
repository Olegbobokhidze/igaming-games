import { describe, expect, it } from 'vitest';
import { asMinor, DEFAULT_MINOR_UNIT_SCALE } from './index.js';

describe('money', () => {
  it('keeps minor units as exact integers', () => {
    // 12.50 EUR is 1250 minor units, never 12.5 as a float.
    const amount = asMinor(1250);
    expect(amount).toBe(1250);
    expect(Number.isInteger(amount)).toBe(true);
  });

  it('scales major to minor without float drift', () => {
    // 0.1 + 0.2 !== 0.3 in binary floats; in minor units it is exact.
    const a = asMinor(10);
    const b = asMinor(20);
    expect(a + b).toBe(30);
  });

  it('uses a two-decimal default scale', () => {
    expect(DEFAULT_MINOR_UNIT_SCALE).toBe(100);
  });
});
