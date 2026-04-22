import { describe, it, expect } from 'vitest';
import { makeRNG, rngRange, rngInt, rngPick } from './rng.js';

describe('makeRNG', () => {
  it('returns values in [0, 1)', () => {
    const rng = makeRNG(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces deterministic sequences for the same seed', () => {
    const a = makeRNG(12345);
    const b = makeRNG(12345);
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = makeRNG(1);
    const b = makeRNG(2);
    const valuesA = Array.from({ length: 10 }, () => a());
    const valuesB = Array.from({ length: 10 }, () => b());
    expect(valuesA).not.toEqual(valuesB);
  });
});

describe('rngRange', () => {
  it('returns values within [min, max)', () => {
    const rng = makeRNG(99);
    for (let i = 0; i < 500; i++) {
      const v = rngRange(rng, -5, 10);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(10);
    }
  });
});

describe('rngInt', () => {
  it('returns integers within [min, max] inclusive', () => {
    const rng = makeRNG(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rngInt(rng, 0, 5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    // All values in range should appear with enough iterations
    expect(seen.size).toBe(6);
  });
});

describe('rngPick', () => {
  it('always picks an element from the array', () => {
    const rng = makeRNG(3);
    const arr = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(rngPick(rng, arr));
    }
  });

  it('eventually picks every element', () => {
    const rng = makeRNG(5);
    const arr = [10, 20, 30];
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      seen.add(rngPick(rng, arr) as number);
    }
    expect(seen.size).toBe(3);
  });
});
