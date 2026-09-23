/**
 * Map generation and the single game-state object.
 *
 * A map is derived entirely from its seed, so the same seed always produces the
 * same form, vibe mix, belt speed and tile sequence. That is what makes runs
 * shareable and replayable.
 */

import { makeRng } from './rng.js';
import { FORMS, formById } from './forms.js';
import { makeSampler } from './sampler.js';
import { makeBelt } from './belt.js';
import {
  makePoem, placeActive, removeAt, poemFull, hasRoom, addGlue, removeGlue,
} from './poem.js';
import { scorePoem } from './scoring.js';
import { composeMods, offerDraft, inkFrom, emptyMods } from './cards.js';
import { pickTheme, mixFromTheme } from './themes.js';
import { applyOffer, affordable } from './wildcards.js';
import { makeTile } from './sampler.js';

/** How many tiles the belt offers per scoring slot. Scarcity is the pressure. */
const SUPPLY_PER_SLOT = 4.5;

/** How many single-use bonus words a map starts you with. */
const BONUS_WORDS = 4;

export function generateMap(seed, { banks, themes = [], forms = FORMS }) {
  const rng = makeRng(seed);
  const form = rng.pick(forms);

  // The theme is the map's weather. Picking it from a library rather than
  // shuffling raw weights means every run opens on something with a name and a
  // character, and a different one each time.
  const theme = pickTheme(themes, banks.map((b) => b.id), rng);
  const vibeMix = mixFromTheme(theme, banks);

  const slots = form.lines * form.slots;
  return {
    seed: String(seed),
    formId: form.id,
    theme,
    vibeMix,
    supply: Math.round(slots * SUPPLY_PER_SLOT),
    speed: Math.round(rng.float(52, 78)),
    phraseChance: rng.float(0.08, 0.18),
    rng,
  };
}

/**
 * The single-use words waiting in the tray at the start of a map.
 *
 * They are drawn from the vibes the theme does NOT favour, so they are a way
 * into a register the belt will never offer you -- a small, spendable escape
 * from the map's own weather.
 */
export function rollBonusWords(map, banks, rng, count = BONUS_WORDS) {
  const offTheme = banks.filter((b) => (map.vibeMix[b.id] ?? 0) === 0);
  const pool = offTheme.length ? offTheme : banks;
  const words = [];
  const seen = new Set();
  for (let i = 0; i < count * 6 && words.length < count; i++) {
    const bank = rng.pick(pool);
    const entry = rng.pick(bank.words);
    if (seen.has(entry.w)) continue;
    seen.add(entry.w);
    words.push({ ...makeTile(entry, bank), bonus: true });
  }
  return words;
}

export function describeMix(vibeMix, banks) {
  return banks
    .filter((b) => (vibeMix[b.id] ?? 0) > 0)
    .sort((a, b) => vibeMix[b.id] - vibeMix[a.id])
    .map((b) => b.name);
}

/** Fractions of the belt at which a draft interrupts play. */
const DRAFT_POINTS = [1, 0.66, 0.33];

export function makeGame({
  seed, banks, width, glueWords = [], cardData = null, onOver = null,
  themes = [], rhyme = true, wildcards = null, allBanks = null,
}) {
  const map = generateMap(seed, { banks, themes });

  // The rhyme toggle works by masking the scheme rather than branching through
  // the scoring and rendering code: an all-"-" scheme already means "unrhymed"
  // everywhere downstream, so turning rhyme off needs no special cases.
  const baseForm = formById(map.formId);
  const form = rhyme
    ? baseForm
    : { ...baseForm, scheme: '-'.repeat(baseForm.lines) };
  const cardPool = cardData?.cards ?? [];
  const cardConfig = cardData ?? { startingInk: 0, inkPerPoint: 0 };

  const sampler = makeSampler({
    banks, vibeMix: map.vibeMix, rng: map.rng, phraseChance: map.phraseChance,
    mods: emptyMods(),
  });
  const belt = makeBelt({
    sampler, width, speed: map.speed, supply: map.supply,
    wildcards, rng: map.rng,
  });

  const game = {
    map, form, banks, belt, sampler, glueWords, cardPool, cardConfig,
    rhyme,
    theme: map.theme,
    bonus: rollBonusWords(map, banks, map.rng),
    lastPlacedId: null,    // the tile that just landed, for its one animation
    wildcard: null,        // the offer currently on screen, if any
    wildcardLog: [],       // what past offers actually did, for the HUD
    poem: makePoem(form),
    score: null,
    running: true,
    over: false,
    dirty: true,
    held: [],            // cards taken this map
    inkSpent: 0,
    offer: null,         // the draft currently on screen, if any
    draftsLeft: DRAFT_POINTS.slice(),

    get ink() {
      return inkFrom(game.score?.total ?? 0, cardConfig) - game.inkSpent;
    },

    get drafting() {
      return game.offer !== null;
    },

    /** Recompose every held card into one modifier set and push it out. */
    refreshMods() {
      const mods = composeMods(game.held);
      sampler.setMods(mods);
      belt.applyMods(mods);
    },

    openDraft() {
      if (!cardPool.length) return false;
      const taken = new Set(game.held.map((c) => c.id));
      const pool = cardPool.filter((c) => !taken.has(c.id));
      if (!pool.length) return false;
      game.offer = offerDraft(pool, map.rng);
      game.running = false;
      game.dirty = true;
      return true;
    },

    takeCard(id) {
      const card = (game.offer || []).find((c) => c.id === id);
      if (!card || card.cost > game.ink) return false;
      game.held.push(card);
      game.inkSpent += card.cost;
      if (card.effect?.supplyBonus) belt.addSupply(card.effect.supplyBonus);
      game.refreshMods();
      game.closeDraft();
      return true;
    },

    closeDraft() {
      game.offer = null;
      if (!game.over) game.running = true;
      game.dirty = true;
    },

    recall() {
      const tile = belt.recall();
      if (tile) game.dirty = true;
      return tile;
    },

    get finished() {
      return poemFull(game.poem, form) || belt.drained;
    },

    tick(dt) {
      if (!game.running || game.over || game.drafting || game.wildcard) return;
      const fallen = belt.update(dt);
      if (fallen.length) game.dirty = true;

      // A draft interrupts play as the belt empties, so a card earned late
      // still has belt left to act on.
      const remaining = belt.supply / Math.max(1, map.supply);
      while (game.draftsLeft.length && remaining <= game.draftsLeft[0]) {
        game.draftsLeft.shift();
        if (game.openDraft()) return;
      }
      if (game.finished) {
        game.over = true;
        game.running = false;
        game.dirty = true;
        // Rescore BEFORE announcing. `score` is otherwise only refreshed by the
        // renderer's sync, which runs after this tick -- so a listener would be
        // handed a score that predates the final tile and its completion bonus.
        game.rescore();
        // Announce the ending rather than making the caller poll for it: the
        // map has to be recorded exactly once, at the moment it finishes.
        onOver?.(game);
      }
    },

    selectLine(index) {
      if (index >= 0 && index < game.poem.lines.length) {
        game.poem.activeLine = index;
        game.dirty = true;
      }
    },

    /** Two more bonus words from off-theme vibes. */
    addBonusWords(count) {
      const added = rollBonusWords(map, banks, map.rng, count);
      game.bonus.push(...added);
      game.dirty = true;
      return added;
    },

    /**
     * A word from a vibe this map has none of -- including, deliberately, one
     * that is still locked. Seeing a register you have not earned yet is the
     * point: it is a glimpse, not a grant.
     */
    addStrangerWords(count) {
      const pool = (allBanks ?? banks).filter((b) => (map.vibeMix[b.id] ?? 0) === 0);
      if (!pool.length) return [];
      const added = [];
      for (let i = 0; i < count * 8 && added.length < count; i++) {
        const bank = map.rng.pick(pool);
        const entry = map.rng.pick(bank.words);
        if (game.bonus.some((t) => t.text === entry.w)) continue;
        added.push({ ...makeTile(entry, bank), bonus: true, stranger: true });
      }
      game.bonus.push(...added);
      game.dirty = true;
      return added;
    },

    /** Throw the unspent bonus words away and draw fresh ones. */
    rerollBonus() {
      const spent = game.bonus.filter((t) => t.used);
      const fresh = rollBonusWords(map, banks, map.rng, Math.max(1, game.bonus.length - spent.length));
      game.bonus = [...spent, ...fresh];
      game.dirty = true;
      return fresh;
    },

    /** Reveal a wildcard's offer. Nothing is committed until you take it. */
    openWildcard(id) {
      const tile = belt.take(id);
      if (!tile?.wildcard) return false;
      game.wildcard = tile;
      game.running = false;
      game.dirty = true;
      return true;
    },

    canAffordWildcard() {
      return game.wildcard ? affordable(game.wildcard.offer, game) : false;
    },

    takeWildcard() {
      if (!game.wildcard || !game.canAffordWildcard()) return false;
      const done = applyOffer(game.wildcard.offer, game);
      game.wildcardLog.push({ name: game.wildcard.offer.name, done });
      game.wildcard = null;
      if (!game.over) game.running = true;
      game.dirty = true;
      return true;
    },

    leaveWildcard() {
      game.wildcard = null;
      if (!game.over) game.running = true;
      game.dirty = true;
    },

    /** Spend one of the map's single-use bonus words. */
    takeBonus(id) {
      const index = game.bonus.findIndex((t) => t.id === id && !t.used);
      if (index < 0) return false;
      if (!hasRoom(game.poem, form)) return false;
      const tile = game.bonus[index];
      if (!placeActive(game.poem, form, tile)) return false;
      tile.used = true;
      game.lastPlacedId = tile.id;
      game.dirty = true;
      return true;
    },

    takeTile(id) {
      // Check for room BEFORE pulling the tile off the belt. Taking first and
      // asking later would delete the word from the belt and put it nowhere.
      if (!hasRoom(game.poem, form)) return false;
      const tile = belt.take(id);
      if (!tile) return false;
      const placed = placeActive(game.poem, form, tile);
      if (placed) game.lastPlacedId = tile.id;
      game.dirty = true;
      return placed;
    },

    addGlue(word) {
      const ok = addGlue(game.poem, form, game.poem.activeLine, word);
      if (ok) game.dirty = true;
      return ok;
    },

    removeGlue(lineIndex, gap, index) {
      const removed = removeGlue(game.poem, lineIndex, gap, index);
      if (removed) game.dirty = true;
      return removed;
    },

    removeTile(lineIndex, slotIndex) {
      const removed = removeAt(game.poem, lineIndex, slotIndex);
      if (removed) game.dirty = true;
      return removed;
    },

    rescore() {
      game.score = scorePoem(game.poem, form);
      return game.score;
    },
  };

  game.rescore();
  game.refreshMods();
  belt.prefill();
  return game;
}
