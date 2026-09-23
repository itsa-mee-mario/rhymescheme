/**
 * Wildcards.
 *
 * A tile that rides the belt marked only with a star. Clicking it reveals an
 * offer; you take it or you leave it, and letting it scroll past declines it
 * for nothing.
 *
 * Every offer is a TRADE -- a gain paired with a cost -- because an offer that
 * is pure upside is not a decision, it is a button you always press. The cost
 * is what makes "take or leave" mean anything.
 */

let nextId = 1;

/** Turn a tile slot into a wildcard carrying a seeded offer. */
export function makeWildcard(offers, rng) {
  const offer = rng.pick(offers);
  return {
    id: `wild-${nextId++}`,
    wildcard: true,
    offer,
    text: '✦',
    vibe: 'wild',
    vibeName: 'Wildcard',
    pos: 'noun',
    syl: 0,
    rhyme: '',
    stress: '',
  };
}

/** Whether this draw should be a wildcard rather than a word. */
export function rollWildcard(config, rng, spawnedSoFar) {
  if (!config?.offers?.length) return false;
  if (spawnedSoFar >= (config.maxPerMap ?? 0)) return false;
  return rng.chance(config.chancePerTile ?? 0);
}

/**
 * Apply an accepted offer. Returns a plain summary of what actually changed so
 * the caller can show it -- the effect fields are declarative, and nothing here
 * reaches into the DOM.
 */
export function applyOffer(offer, game) {
  const e = offer.effect || {};
  const done = [];

  if (e.ink) {
    game.inkSpent -= e.ink;          // a negative spend is a grant
    done.push(e.ink > 0 ? `+${e.ink} ink` : `${e.ink} ink`);
  }
  if (e.supply) {
    game.belt.addSupply(e.supply);
    done.push(`${e.supply > 0 ? '+' : ''}${e.supply} words`);
  }
  if (e.speedMultiplier && e.speedMultiplier !== 1) {
    // Fold into the belt's base speed so later card mods still compose on top.
    game.belt.baseSpeed *= e.speedMultiplier;
    game.refreshMods();
    done.push(e.speedMultiplier > 1 ? 'belt faster' : 'belt slower');
  }
  if (e.foresight) {
    game.belt.foresight = Math.max(game.belt.foresight, e.foresight);
    game.belt.fillQueue();
    done.push(`see ${e.foresight} ahead`);
  }
  if (e.strangerWord) {
    const added = game.addStrangerWords(e.strangerWord);
    done.push(added.length ? `${added.map((t) => t.text).join(', ')}` : 'no stranger left');
  }
  if (e.extraBonus) {
    const added = game.addBonusWords(e.extraBonus);
    done.push(`${added.length} more bonus`);
  }
  if (e.rerollBonus) {
    const rolled = game.rerollBonus();
    done.push(`${rolled.length} new bonus words`);
  }
  return done;
}

/** Can the player afford this offer right now? */
export function affordable(offer, game) {
  const ink = offer.effect?.ink ?? 0;
  return ink >= 0 || game.ink >= -ink;
}
