/**
 * The poem under construction: a fixed number of lines, each with a fixed
 * number of scoring slots.
 */

/** Glue words allowed in one gap, and in one line overall. */
export const GLUE_PER_GAP = 2;

export function makePoem(form) {
  return {
    formId: form.id,
    lines: Array.from({ length: form.lines }, () => ({
      tiles: [],
      // One gap before each scoring slot plus one after the last, so glue sits
      // BETWEEN scoring words rather than consuming a slot.
      glue: Array.from({ length: form.slots + 1 }, () => []),
    })),
    activeLine: 0,
  };
}

/**
 * A line read left to right: glue and scoring tiles interleaved.
 * Returns entries so callers can tell the two apart.
 */
export function lineParts(line) {
  const parts = [];
  const glue = line.glue || [];
  const span = Math.max(line.tiles.length, glue.length - 1);
  for (let i = 0; i <= span; i++) {
    for (const [k, word] of (glue[i] || []).entries()) {
      parts.push({ kind: 'glue', text: word, gap: i, index: k });
    }
    if (line.tiles[i]) {
      parts.push({ kind: 'tile', tile: line.tiles[i], slot: i });
    }
  }
  return parts;
}

export function glueCount(line) {
  return (line.glue || []).reduce((n, gap) => n + gap.length, 0);
}

/**
 * Add a glue word to the active composition point: the gap just after the last
 * scoring tile placed. Lines are built left to right, so that is always where
 * the writer is.
 */
export function addGlue(poem, form, lineIndex, word) {
  const line = poem.lines[lineIndex];
  if (!line) return false;
  const gap = Math.min(line.tiles.length, line.glue.length - 1);
  if (line.glue[gap].length >= GLUE_PER_GAP) return false;
  if (glueCount(line) >= form.slots) return false;
  line.glue[gap].push(word);
  return true;
}

export function removeGlue(poem, lineIndex, gap, index) {
  const line = poem.lines[lineIndex];
  if (!line || !line.glue[gap]) return null;
  const [removed] = line.glue[gap].splice(index, 1);
  return removed ?? null;
}

export function lineFull(poem, form, index) {
  return poem.lines[index].tiles.length >= form.slots;
}

export function poemFull(poem, form) {
  return poem.lines.every((_, i) => lineFull(poem, form, i));
}

/** Is there a scoring slot free anywhere? */
export function hasRoom(poem, form) {
  return poem.lines.some((_, i) => !lineFull(poem, form, i));
}

/** Append to a line if it has room. Returns true if placed. */
export function place(poem, form, lineIndex, tile) {
  const line = poem.lines[lineIndex];
  if (!line || line.tiles.length >= form.slots) return false;
  line.tiles.push(tile);
  return true;
}

/** Place into the active line, advancing to the next line with room. */
export function placeActive(poem, form, tile) {
  if (lineFull(poem, form, poem.activeLine)) {
    const next = poem.lines.findIndex((_, i) => !lineFull(poem, form, i));
    if (next < 0) return false;
    poem.activeLine = next;
  }
  return place(poem, form, poem.activeLine, tile);
}

/** Pull a tile back out of a line. The tile is discarded, not returned. */
export function removeAt(poem, lineIndex, slotIndex) {
  const line = poem.lines[lineIndex];
  if (!line || slotIndex < 0 || slotIndex >= line.tiles.length) return null;
  return line.tiles.splice(slotIndex, 1)[0];
}
