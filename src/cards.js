/**
 * Power cards. Three families, matching what a card is allowed to decide:
 *
 *   theme     -- WHICH vibes the belt draws from   (reweights the sampler)
 *   flavour   -- WHAT KIND of words those are      (biases the entry chosen)
 *   direction -- HOW the belt behaves              (speed, supply, foresight)
 *
 * A card is data. This module composes a set of held cards into one flat
 * modifier object that the sampler and belt read every draw, so cards stack
 * rather than overwrite each other.
 */

export const FAMILIES = ['theme', 'flavour', 'direction'];

export function emptyMods() {
  return {
    vibeWeights: {},        // multiplied into the map's vibe mix
    syllable: null,         // 'long' | 'short'
    phraseMultiplier: 1,
    posWeights: {},         // multiplied into the per-word draw weight
    speedMultiplier: 1,
    supplyBonus: 0,
    foresight: 0,
    rewind: 0,
  };
}

/** Fold a list of cards into one modifier set. Multipliers compose. */
export function composeMods(cards) {
  const mods = emptyMods();
  for (const card of cards) {
    const e = card.effect || {};
    for (const [vibe, weight] of Object.entries(e.vibeWeights || {})) {
      mods.vibeWeights[vibe] = (mods.vibeWeights[vibe] ?? 1) * weight;
    }
    for (const [pos, weight] of Object.entries(e.posWeights || {})) {
      mods.posWeights[pos] = (mods.posWeights[pos] ?? 1) * weight;
    }
    // Last syllable card wins: "long" and "short" cannot both be honoured.
    if (e.syllable) mods.syllable = e.syllable;
    if (e.phraseMultiplier) mods.phraseMultiplier *= e.phraseMultiplier;
    if (e.speedMultiplier) mods.speedMultiplier *= e.speedMultiplier;
    if (e.supplyBonus) mods.supplyBonus += e.supplyBonus;
    if (e.foresight) mods.foresight = Math.max(mods.foresight, e.foresight);
    if (e.rewind) mods.rewind += e.rewind;
  }
  return mods;
}

/**
 * Offer three cards, one per family where possible, so a draft is a choice
 * between different kinds of change rather than three shades of the same one.
 */
export function offerDraft(pool, rng, count = 3) {
  const byFamily = new Map(FAMILIES.map((f) => [f, []]));
  for (const card of pool) {
    if (byFamily.has(card.family)) byFamily.get(card.family).push(card);
  }
  const offer = [];
  for (const family of rng.shuffle(FAMILIES)) {
    const options = byFamily.get(family).filter((c) => !offer.includes(c));
    if (options.length) offer.push(rng.pick(options));
    if (offer.length >= count) break;
  }
  // Top up from anywhere if a family was empty.
  const rest = rng.shuffle(pool.filter((c) => !offer.includes(c)));
  while (offer.length < count && rest.length) offer.push(rest.pop());
  return offer;
}

export function inkFrom(score, config) {
  return Math.floor((config.startingInk ?? 0) + score * (config.inkPerPoint ?? 0));
}
