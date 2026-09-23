/**
 * Draws tiles off the vibe banks. The only randomness the belt sees comes
 * through the map's seeded rng, so the same seed always yields the same
 * sequence of tiles.
 */

import { syllables, rhymeKey, stressPattern } from './phonemes.js';
import { emptyMods } from './cards.js';

let nextId = 1;

export function makeTile(entry, bank) {
  return {
    id: nextId++,
    text: entry.w,
    vibe: bank.id,
    vibeName: bank.name,
    pos: entry.pos || 'noun',
    syl: syllables(entry.w),
    rhyme: rhymeKey(entry.w),
    stress: stressPattern(entry.w),
    phrase: entry.w.includes(' '),
  };
}

/**
 * @param banks   loaded vibe banks
 * @param vibeMix { [vibeId]: weight } -- the map's theme, later reweighted by cards
 * @param rng     seeded rng from makeRng
 */
/** How many recent draws the part-of-speech balance looks back over. */
const POS_MEMORY = 3;
const POS_LIMIT = 2;      // a POS may fill at most this many of the last draws
const RETRIES = 4;

export function makeSampler({ banks, vibeMix, rng, phraseChance = 0.12, mods }) {
  // Every bank stays in the pool: a theme card can raise a vibe the map gave
  // zero weight, and excluding it here would make that card do nothing.
  const pool = banks;

  const recentPos = [];
  const usedPhrases = new Set();
  let live = mods || emptyMods();

  /**
   * The map's weight for a vibe, scaled by whatever theme cards are held.
   *
   * A card that raises a vibe has to be able to INTRODUCE one the map left out,
   * not merely amplify what is already there -- multiplying zero would make
   * Saltwater inert on a map with no Tide, which is exactly the map where a
   * player would want to play it. So a multiplier above 1 lifts an absent vibe
   * to a trace weight of 1 first, then scales. A multiplier of 0 still silences.
   */
  function vibeWeight(bank) {
    const base = vibeMix[bank.id] ?? 0;
    const mult = live.vibeWeights[bank.id];
    if (mult === undefined) return base;
    return Math.max(base, mult > 1 ? 1 : 0) * mult;
  }

  function wordWeight(entry) {
    let weight = live.posWeights[entry.pos || 'noun'] ?? 1;
    if (live.syllable) {
      // The banks are overwhelmingly one- and two-syllable words -- only a
      // handful reach three. A flat "4x anything over 3 syllables" therefore
      // barely moves the belt, so Latinate graduates its preference across the
      // range the vocabulary actually occupies.
      const syl = syllables(entry.w);
      if (live.syllable === 'long') weight *= syl >= 3 ? 10 : (syl === 2 ? 3 : 1);
      if (live.syllable === 'short') weight *= syl <= 1 ? 5 : 1;
    }
    return weight;
  }

  function crowded(pos) {
    return recentPos.filter((p) => p === pos).length >= POS_LIMIT;
  }

  function remember(pos) {
    recentPos.push(pos);
    if (recentPos.length > POS_MEMORY) recentPos.shift();
  }

  return {
    get vibeMix() { return vibeMix; },
    get mods() { return live; },
    setMods(next) { live = next || emptyMods(); },

    /** The vibe weights actually in force, for the HUD. */
    effectiveMix() {
      return Object.fromEntries(banks.map((b) => [b.id, vibeWeight(b)]));
    },

    draw() {
      const usable = pool.filter((b) => vibeWeight(b) > 0);
      const bank = rng.weighted(usable.length ? usable : pool, vibeWeight);
      const phrases = bank.phrases || [];

      // A phrase tile is distinctive enough that seeing it twice in one poem
      // reads as a bug, so phrases are drawn without replacement.
      const phraseOdds = Math.min(0.85, phraseChance * live.phraseMultiplier);
      if (phrases.length && rng.chance(phraseOdds)) {
        for (let i = 0; i < RETRIES; i++) {
          const entry = rng.pick(phrases);
          if (!usedPhrases.has(entry.w)) {
            usedPhrases.add(entry.w);
            remember(entry.pos || 'noun');
            return makeTile(entry, bank);
          }
        }
      }

      // Keep the belt from handing out four nouns in a row: a run of one part
      // of speech gives the player nothing to build a line out of. Flavour
      // cards bias the draw through wordWeight; the run guard still applies on
      // top, so "more verbs" never becomes "only verbs".
      let entry = rng.weighted(bank.words, wordWeight);
      for (let i = 0; i < RETRIES && crowded(entry.pos || 'noun'); i++) {
        entry = rng.weighted(bank.words, wordWeight);
      }
      remember(entry.pos || 'noun');
      return makeTile(entry, bank);
    },
  };
}
