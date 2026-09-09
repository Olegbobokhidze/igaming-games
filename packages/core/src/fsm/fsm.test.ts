import { describe, expect, it } from 'vitest';
import { INITIAL_ROUND_STATE, multiplierToProgress } from './index.js';

describe('INITIAL_ROUND_STATE', () => {
  it('starts idle at 1x with no round', () => {
    expect(INITIAL_ROUND_STATE).toEqual({
      phase: 'idle',
      roundId: null,
      multiplier: 1,
    });
  });
});

describe('multiplierToProgress', () => {
  it('parks on the launch pad at or below 1x', () => {
    expect(multiplierToProgress(1)).toBe(0);
    expect(multiplierToProgress(0.5)).toBe(0);
  });

  it('reaches the top exactly at the apex multiplier', () => {
    expect(multiplierToProgress(20, 20)).toBeCloseTo(1, 10);
  });

  it('clamps beyond the apex rather than overshooting', () => {
    expect(multiplierToProgress(1000, 20)).toBe(1);
  });

  it('spends equal travel on each doubling', () => {
    // log scale: 2x -> 4x should cover the same distance as 4x -> 8x.
    const a = multiplierToProgress(4) - multiplierToProgress(2);
    const b = multiplierToProgress(8) - multiplierToProgress(4);
    expect(a).toBeCloseTo(b, 10);
  });

  it('increases monotonically across the range', () => {
    const points = [1.1, 1.5, 2, 5, 10, 19].map((m) => multiplierToProgress(m));
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i] ?? 0).toBeGreaterThan(points[i - 1] ?? 0);
    }
  });

  it('survives non-finite input instead of producing NaN', () => {
    expect(multiplierToProgress(Number.NaN)).toBe(0);
    expect(multiplierToProgress(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
