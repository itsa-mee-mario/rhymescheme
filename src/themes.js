/**
 * Themes. Every map opens on one, chosen at random from those whose vibes are
 * all unlocked, so the character of a run changes each time you play.
 *
 * A theme sets the BASELINE vibe mix. Theme cards drafted mid-map multiply on
 * top of it -- the two are different layers, not competing systems.
 */

/** Themes playable with the given set of unlocked vibe ids. */
export function availableThemes(themes, unlockedVibes) {
  const unlocked = new Set(unlockedVibes);
  return themes.filter((theme) =>
    Object.entries(theme.weights)
      .filter(([, weight]) => weight > 0)
      .every(([vibe]) => unlocked.has(vibe)));
}

/**
 * Pick a theme for a map. Seeded, so a seed always reproduces its theme.
 * Falls back to an even mix over whatever is unlocked if no theme fits.
 */
export function pickTheme(themes, unlockedVibes, rng) {
  const pool = availableThemes(themes, unlockedVibes);
  if (!pool.length) {
    return {
      id: 'open-field',
      name: 'Open Field',
      blurb: 'No particular weather.',
      weights: Object.fromEntries(unlockedVibes.map((v) => [v, 1])),
    };
  }
  return rng.pick(pool);
}

/** The theme's weights as a full mix over every bank, zeros included. */
export function mixFromTheme(theme, banks) {
  return Object.fromEntries(banks.map((b) => [b.id, theme.weights[b.id] ?? 0]));
}

export function describeTheme(theme, banks) {
  return banks
    .filter((b) => (theme.weights[b.id] ?? 0) > 0)
    .sort((a, b) => theme.weights[b.id] - theme.weights[a.id])
    .map((b) => b.name);
}
