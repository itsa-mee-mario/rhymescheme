/**
 * The conveyor. Tiles enter at the right, slide left, and are gone once they
 * pass the left edge -- letting one go is the redaction, and is the only way
 * the player "removes" a word from the source.
 *
 * Positions are in px and the belt owns them; the renderer only reads x.
 */

import { makeWildcard, rollWildcard } from './wildcards.js';

const CHAR_PX = 11;   // rough advance width, refined by the renderer's measure
const PAD_PX = 28;
const GAP_PX = 18;

/**
 * Empty rail to the left of the first tile when a map opens, as a fraction of
 * the rail. Without it the prefill packs words right up to the vanishing edge
 * and the first thing that happens is losing one before you have read anything.
 */
const LEAD_IN_FRACTION = 0.34;
const LEAD_IN_MIN_PX = 240;
/* Capped as well as floored: a third of a very wide rail is a long wait before
   anything is at stake. */
const LEAD_IN_MAX_PX = 420;

export function tileWidth(tile) {
  if (tile.wildcard) return 58;
  return Math.round(tile.text.length * CHAR_PX + PAD_PX);
}

export function makeBelt({
  sampler, width, speed = 62, supply = Infinity, wildcards = null, rng = null,
}) {
  const belt = {
    tiles: [],
    width,
    speed,
    baseSpeed: speed,
    supply,          // tiles left to spawn; the map ends when it hits 0 and the belt drains
    spawned: 0,
    missed: 0,
    leadIn: 0,       // empty rail ahead of the first tile at map start
    queue: [],       // pre-drawn tiles, revealed by the Foresight card
    foresight: 0,
    fallen: [],      // what scrolled off, for the Dredge card
    rewinds: 0,
    wildsSpawned: 0,

    get drained() {
      return belt.supply <= 0 && belt.tiles.length === 0;
    },

    /** Direction cards act here: speed, extra supply, foresight, dredges. */
    applyMods(mods) {
      belt.speed = belt.baseSpeed * (mods.speedMultiplier || 1);
      belt.foresight = mods.foresight || 0;
      belt.rewinds = mods.rewind || 0;
      belt.fillQueue();
    },

    addSupply(n) {
      belt.supply += n;
    },

    /** Keep the reveal queue topped up without spending supply early. */
    fillQueue() {
      while (belt.queue.length < belt.foresight
             && belt.supply - belt.queue.length > 0) {
        belt.queue.push(sampler.draw());
      }
      belt.queue.length = Math.min(belt.queue.length, Math.max(belt.foresight, 0));
    },

    /** Next tile to enter, taken from the reveal queue when there is one. */
    nextTile() {
      // A wildcard replaces a word rather than being added alongside one, so
      // taking the gamble always costs you a word you could have had.
      if (wildcards && rng && rollWildcard(wildcards, rng, belt.wildsSpawned)) {
        belt.wildsSpawned++;
        return makeWildcard(wildcards.offers, rng);
      }
      const tile = belt.queue.length ? belt.queue.shift() : sampler.draw();
      belt.fillQueue();
      return tile;
    },

    /** Dredge: bring the most recent lost tile back on at the right edge. */
    recall() {
      if (belt.rewinds <= 0 || !belt.fallen.length) return null;
      const tile = belt.fallen.pop();
      const last = belt.tiles[belt.tiles.length - 1];
      tile.x = Math.max(belt.width, last ? last.x + tileWidth(last) + GAP_PX : belt.width);
      belt.tiles.push(tile);
      belt.rewinds--;
      return tile;
    },

    resize(newWidth) {
      belt.width = newWidth;
    },

    /**
     * Fill the rail before the first frame. Without this the player starts at
     * an empty belt and gets one word every couple of seconds -- no choice to
     * make, which is the whole game. A full rail means there is always a
     * decision on screen.
     *
     * The fill starts a little way in rather than at zero, so the opening words
     * ride towards you instead of already being on top of the edge. At the
     * default speed that buys roughly four seconds before anything can be lost.
     */
    prefill() {
      let x = Math.min(
        LEAD_IN_MAX_PX,
        Math.max(LEAD_IN_MIN_PX, belt.width * LEAD_IN_FRACTION));
      belt.leadIn = x;
      while (belt.supply > 0 && x < belt.width) {
        const tile = belt.nextTile();
        tile.x = x;
        belt.tiles.push(tile);
        belt.spawned++;
        belt.supply--;
        x += tileWidth(tile) + GAP_PX;
      }
    },

    /** Advance by dt seconds. Returns tiles that fell off this frame. */
    update(dt) {
      for (const tile of belt.tiles) tile.x -= belt.speed * dt;

      const fallen = [];
      belt.tiles = belt.tiles.filter((tile) => {
        if (tile.x + tileWidth(tile) < 0) {
          fallen.push(tile);
          belt.fallen.push(tile);
          if (belt.fallen.length > 40) belt.fallen.shift();
          return false;
        }
        return true;
      });
      belt.missed += fallen.length;

      // Spawn only once the previous tile has cleared enough room, so tiles
      // never overlap regardless of how wide a phrase tile turns out to be.
      if (belt.supply > 0) {
        const last = belt.tiles[belt.tiles.length - 1];
        const clear = !last || last.x + tileWidth(last) + GAP_PX <= belt.width;
        if (clear) {
          const tile = belt.nextTile();
          tile.x = belt.width;
          belt.tiles.push(tile);
          belt.spawned++;
          belt.supply--;
        }
      }
      return fallen;
    },

    /** Remove a tile from the belt and hand it over. */
    take(id) {
      const index = belt.tiles.findIndex((t) => t.id === id);
      if (index < 0) return null;
      return belt.tiles.splice(index, 1)[0];
    },
  };
  return belt;
}
