/**
 * Seeded randomness. Everything the game generates -- the form, the vibe mix,
 * the belt sequence, the card draft -- comes through here, so a seed fully
 * determines a map and any run can be replayed or shared.
 */

/** xmur3: string -> 32-bit seed. */
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32: 32-bit seed -> uniform [0,1) generator. */
export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const seedStr = String(seed);
  const next = mulberry32(hashSeed(seedStr)());

  const rng = {
    seed: seedStr,
    next,
    /** Integer in [min, max). */
    int: (min, max) => min + Math.floor(next() * (max - min)),
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /**
     * Pick from `items` where `weightOf(item)` gives relative weight.
     * Zero-weight items are never drawn; all-zero falls back to uniform.
     */
    weighted: (items, weightOf) => {
      let total = 0;
      for (const item of items) total += Math.max(0, weightOf(item));
      if (total <= 0) return rng.pick(items);
      let roll = next() * total;
      for (const item of items) {
        roll -= Math.max(0, weightOf(item));
        if (roll < 0) return item;
      }
      return items[items.length - 1];
    },
    /** Fisher-Yates, returns a new array. */
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}

/** A short human-typable seed, e.g. "tidal-moth-417". */
export function randomSeedWord() {
  const a = ['tidal', 'rust', 'hollow', 'salt', 'ember', 'pale', 'slow', 'low'];
  const b = ['moth', 'rung', 'shore', 'hinge', 'ghost', 'wire', 'dune', 'bell'];
  const r = Math.floor(Math.random() * 1e9);
  return `${a[r % a.length]}-${b[(r >> 4) % b.length]}-${r % 1000}`;
}
