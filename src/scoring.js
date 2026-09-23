/**
 * Scoring. Pure functions over (poem, form) -- no DOM, no state, no randomness
 * -- so this is the part that gets unit tested.
 *
 * A poem is { lines: [ { tiles: [tile,...] }, ... ] } where a tile is
 * { text, vibe, pos, ... }. Glue (function) words are held separately on the
 * line and never scored.
 */

import { rhymeGrade, syllables, stressPattern, RHYME } from './phonemes.js';
import { rhymeGroups } from './forms.js';
import { lineParts } from './poem.js';

export const POINTS = {
  RHYME_PAIR: 120,
  METER_LINE: 40,
  METER_CONSISTENT: 25,
  VIBE_LINE: 15,
  VIBE_MONO: 60,
  VIBE_CHORD: 45,
  ALLITERATION: 8,
  POS_PAIR: 6,
  COMPLETE: 100,
};

/** POS sequences that read as English rather than as a word list. */
const GOOD_POS_PAIRS = new Set([
  'adj>noun', 'noun>verb', 'verb>noun', 'adv>verb',
  'noun>noun', 'adj>adj', 'verb>adv',
]);

/** Scoring tiles only -- what rhyme and vibe judge. */
function lineText(line) {
  return line.tiles.map((t) => t.text).join(' ');
}

/**
 * The line as actually read, glue included. Metre has to count glue: "the" is a
 * syllable whether or not it scores. Rhyme deliberately does not -- a line
 * ending in "of" still rhymes on its last content word.
 */
function spokenText(line) {
  return lineParts(line).map((p) => (p.kind === 'glue' ? p.text : p.tile.text)).join(' ');
}

function lastTile(line) {
  return line.tiles.length ? line.tiles[line.tiles.length - 1] : null;
}

export function scoreRhyme(poem, form) {
  const detail = [];
  let points = 0;
  for (const group of rhymeGroups(form)) {
    const pairs = [];
    for (let i = 0; i < group.indices.length; i++) {
      for (let j = i + 1; j < group.indices.length; j++) {
        const a = lastTile(poem.lines[group.indices[i]]);
        const b = lastTile(poem.lines[group.indices[j]]);
        const grade = a && b ? rhymeGrade(a.text, b.text) : RHYME.NONE;
        pairs.push({
          lineA: group.indices[i],
          lineB: group.indices[j],
          a: a ? a.text : null,
          b: b ? b.text : null,
          grade,
          points: Math.round(grade * POINTS.RHYME_PAIR),
        });
        points += Math.round(grade * POINTS.RHYME_PAIR);
      }
    }
    detail.push({ letter: group.letter, indices: group.indices, pairs });
  }
  return { points, detail };
}

export function scoreMeter(poem, form) {
  const lines = poem.lines.map((line, i) => {
    const target = form.sylTarget[i] ?? form.sylTarget[form.sylTarget.length - 1];
    const syl = syllables(spokenText(line));
    const delta = syl - target;
    const slack = Math.max(0, 1 - Math.abs(delta) / (form.tolerance + 1));
    const filled = line.tiles.length > 0;
    return {
      index: i, syl, target, delta,
      points: filled ? Math.round(POINTS.METER_LINE * slack) : 0,
    };
  });
  let points = lines.reduce((sum, l) => sum + l.points, 0);

  // Reward a repeated rhythm, not merely the right number of syllables.
  const patterns = poem.lines.filter((l) => l.tiles.length).map((l) => stressPattern(spokenText(l)));
  const counts = new Map();
  for (const p of patterns) counts.set(p, (counts.get(p) || 0) + 1);
  const repeated = [...counts.values()].some((n) => n > 1);
  if (repeated) points += POINTS.METER_CONSISTENT;

  return { points, lines, consistent: repeated };
}

export function scoreVibe(poem) {
  let points = 0;
  const lineVibes = [];
  for (const line of poem.lines) {
    if (!line.tiles.length) { lineVibes.push(null); continue; }
    const vibes = new Set(line.tiles.map((t) => t.vibe));
    if (vibes.size === 1) {
      points += POINTS.VIBE_LINE;
      lineVibes.push([...vibes][0]);
    } else {
      lineVibes.push(null);
    }
  }

  const all = new Set(poem.lines.flatMap((l) => l.tiles.map((t) => t.vibe)));
  const filledLines = poem.lines.filter((l) => l.tiles.length).length;
  let note = null;
  if (all.size === 1 && filledLines > 1) {
    points += POINTS.VIBE_MONO;
    note = `single vibe: ${[...all][0]}`;
  } else if (all.size === 2 && filledLines > 1 && lineVibes.filter(Boolean).length === filledLines) {
    // Every line internally pure, exactly two vibes in play: a deliberate
    // pairing rather than an accident.
    points += POINTS.VIBE_CHORD;
    note = `chord: ${[...all].join(' + ')}`;
  }
  return { points, note, lineVibes, vibes: [...all] };
}

export function scoreTexture(poem) {
  let points = 0;
  const notes = [];
  for (const [i, line] of poem.lines.entries()) {
    for (let k = 0; k + 1 < line.tiles.length; k++) {
      const a = line.tiles[k];
      const b = line.tiles[k + 1];
      const aInit = a.text.trim()[0]?.toLowerCase();
      const bInit = b.text.trim()[0]?.toLowerCase();
      if (aInit && aInit === bInit) {
        points += POINTS.ALLITERATION;
        notes.push({ line: i, kind: 'alliteration', text: `${a.text} ${b.text}` });
      }
      if (GOOD_POS_PAIRS.has(`${a.pos}>${b.pos}`)) {
        points += POINTS.POS_PAIR;
        notes.push({ line: i, kind: 'phrasing', text: `${a.text} ${b.text}` });
      }
    }
  }
  return { points, notes };
}

export function scorePoem(poem, form) {
  const rhyme = scoreRhyme(poem, form);
  const meter = scoreMeter(poem, form);
  const vibe = scoreVibe(poem);
  const texture = scoreTexture(poem);
  const complete = poem.lines.every((l) => l.tiles.length >= form.slots);
  const bonus = complete ? POINTS.COMPLETE : 0;
  return {
    rhyme, meter, vibe, texture, complete,
    completeBonus: bonus,
    total: rhyme.points + meter.points + vibe.points + texture.points + bonus,
  };
}
