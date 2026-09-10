import { describe, expect, it } from 'vitest';
import { MULTIPLIER_SCALE, toMultiplier } from '../protocol/index.js';
import {
  multiplierAt,
  scaledMultiplierAt,
  SECONDS_PER_DOUBLING,
  timeToReach,
} from './curve.js';

describe('multiplierAt', () => {
  it('starts at exactly 1x', () => {
    expect(multiplierAt(0)).toBe(1);
  });

  it('never dips below 1x for negative or bogus input', () => {
    expect(multiplierAt(-500)).toBe(1);
    expect(multiplierAt(Number.NaN)).toBe(1);
  });

  it('rises monotonically', () => {
    let previous = 0;
    for (let ms = 0; ms <= 20_000; ms += 250) {
      const value = multiplierAt(ms);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('doubles on the configured schedule', () => {
    // Pins the pacing decision: the median round crashes near 2x, so this
    // is roughly how long a typical round lasts.
    expect(timeToReach(2)).toBeCloseTo(SECONDS_PER_DOUBLING * 1000, 6);
    expect(multiplierAt(SECONDS_PER_DOUBLING * 1000)).toBeCloseTo(2, 9);
  });

  it('takes the same time for each doubling', () => {
    // The defining property of an exponential curve: 1x->2x costs the same
    // wall clock as 2x->4x. This is what keeps late multipliers from
    // feeling like the game sped up.
    const to2 = timeToReach(2);
    const to4 = timeToReach(4);
    const to8 = timeToReach(8);
    expect(to4 - to2).toBeCloseTo(to2, 6);
    expect(to8 - to4).toBeCloseTo(to2, 6);
  });
});

describe('timeToReach', () => {
  it('is the inverse of multiplierAt', () => {
    for (const target of [1.5, 2, 3.7, 10, 100]) {
      expect(multiplierAt(timeToReach(target))).toBeCloseTo(target, 9);
    }
  });

  it('returns 0 at or below 1x', () => {
    expect(timeToReach(1)).toBe(0);
    expect(timeToReach(0.2)).toBe(0);
  });
});

describe('scaledMultiplierAt', () => {
  it('produces integer wire units', () => {
    for (const ms of [0, 100, 1234, 9999]) {
      expect(Number.isInteger(scaledMultiplierAt(ms))).toBe(true);
    }
  });

  it('never goes below 1.00x in wire units', () => {
    expect(scaledMultiplierAt(0)).toBe(MULTIPLIER_SCALE);
    expect(scaledMultiplierAt(-10)).toBe(MULTIPLIER_SCALE);
  });

  it('agrees with the float curve to two decimals', () => {
    // Client and server must land on the same number; this is the contract
    // that keeps a rendered 2.40x from being settled as 2.38x.
    for (const ms of [500, 1500, 5000, 12_000]) {
      expect(toMultiplier(scaledMultiplierAt(ms))).toBeCloseTo(multiplierAt(ms), 2);
    }
  });
});
