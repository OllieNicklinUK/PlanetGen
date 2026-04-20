// rng.js — Seeded RNG helpers for the creature system.
//
// Re-exports SeededRNG from noise.js and provides a makeRNG factory that
// returns a plain () => number closure, matching the spec's mulberry32 interface.

import { SeededRNG } from '../noise.js';

export { SeededRNG };

/**
 * Create a seeded RNG function.
 * @param {number} seed
 * @returns {() => number}  Returns values in [0, 1)
 */
export function makeRNG(seed) {
  const rng = new SeededRNG(seed);
  return () => rng.next();
}

/**
 * Return a random value in [min, max) using the given rng function.
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function rngRange(rng, min, max) {
  return min + rng() * (max - min);
}

/**
 * Return a random integer in [min, max] inclusive.
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function rngInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Pick a random element from an array.
 * @param {() => number} rng
 * @param {any[]} arr
 * @returns {any}
 */
export function rngPick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
