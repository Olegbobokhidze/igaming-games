import { describe, expect, it } from 'vitest';
import { MAX_RESOLUTION, resolveResolution } from './bootstrap.js';

describe('resolveResolution', () => {
  it('passes through a standard-density display', () => {
    expect(resolveResolution(1)).toBe(1);
  });

  it('caps a high-density display at MAX_RESOLUTION', () => {
    expect(resolveResolution(3)).toBe(MAX_RESOLUTION);
    expect(resolveResolution(4)).toBe(MAX_RESOLUTION);
  });

  it('keeps a fractional ratio below the cap', () => {
    expect(resolveResolution(1.5)).toBe(1.5);
  });
});
