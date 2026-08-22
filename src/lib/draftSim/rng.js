/**
 * Seeded PRNG for the Draft Simulator.
 *
 * Hand-rolled (mulberry32, ~10 lines) rather than a dependency: the 250 KiB
 * initial-JS budget leaves no room for a random package, and a seeded generator
 * is what makes a sim reproducible. The seed lives in the persisted state, so a
 * mid-draft refresh replays the CPU decisions it already made rather than
 * silently re-rolling them; starting a NEW sim draws a fresh seed.
 */

/** A uint32 seed derived from the clock plus jitter. */
export function newSeed() {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

/**
 * mulberry32: returns a function producing floats in [0, 1). Identical seeds
 * produce identical sequences in every JS engine (all arithmetic is on
 * explicitly coerced 32-bit integers).
 */
export function mulberry32(seed) {
  let a = Number(seed) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A generator positioned `skip` draws into the sequence for `seed`. Used to
 * derive a per-pick generator from the sim's single stored seed, so replaying a
 * resumed draft reproduces the same CPU choices without storing a cursor.
 */
export function rngForPick(seed, skip = 0) {
  const rng = mulberry32(seed);
  for (let i = 0; i < skip; i++) rng();
  return rng;
}

export default mulberry32;
