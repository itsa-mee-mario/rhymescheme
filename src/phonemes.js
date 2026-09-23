/**
 * Rhyme, syllable and stress lookup over the table built by
 * tools/build_phonemes.py. Environment-free: the caller loads the JSON (fetch
 * in the browser, fs in tests) and hands it to setTable.
 *
 * A "text" here may be a single word or a phrase tile. A phrase's syllable
 * count is the sum over its words; its rhyme key comes from its last word,
 * since that is what sits at the line end.
 */

let TABLE = {};

export function setTable(table) {
  TABLE = table || {};
}

export function has(word) {
  return Object.prototype.hasOwnProperty.call(TABLE, word.toLowerCase());
}

export function lookup(word) {
  return TABLE[word.toLowerCase()] || null;
}

function words(text) {
  return String(text).toLowerCase().split(/\s+/).filter(Boolean);
}

export function lastWord(text) {
  const parts = words(text);
  return parts.length ? parts[parts.length - 1] : '';
}

export function rhymeKey(text) {
  const entry = lookup(lastWord(text));
  return entry ? entry.r : '';
}

export function syllables(text) {
  let total = 0;
  for (const word of words(text)) {
    const entry = lookup(word);
    if (entry) total += entry.s;
  }
  return total;
}

export function stressPattern(text) {
  return words(text).map((w) => (lookup(w) || { m: '' }).m).join('');
}

/** Split a rhyme key into [nucleus, coda]: "UW N" -> ["UW", "N"]. */
export function splitKey(key) {
  const parts = String(key).split(' ').filter(Boolean);
  if (!parts.length) return ['', ''];
  return [parts[0], parts.slice(1).join(' ')];
}

export const RHYME = {
  NONE: 0,
  CODA: 0.35,    // moon / mean  -- shared coda, different vowel
  NUCLEUS: 0.55, // moon / mood  -- shared vowel, different coda
  FULL: 1,
};

/**
 * How well two line-endings rhyme, in [0,1].
 *
 * Slant rhyme earns partial credit deliberately: full-credit-or-nothing makes
 * the score feel binary and punishes the near-misses that are the interesting
 * part of writing to a scheme. A word never rhymes with itself -- repeating a
 * word is not a rhyme, and scoring it as one would make the optimal play
 * boring.
 */
export function rhymeGrade(textA, textB) {
  const a = lastWord(textA);
  const b = lastWord(textB);
  if (!a || !b) return RHYME.NONE;
  if (a === b) return RHYME.NONE;

  const keyA = rhymeKey(textA);
  const keyB = rhymeKey(textB);
  if (!keyA || !keyB) return RHYME.NONE;
  if (keyA === keyB) return RHYME.FULL;

  const [nucA, codaA] = splitKey(keyA);
  const [nucB, codaB] = splitKey(keyB);
  if (nucA === nucB) return RHYME.NUCLEUS;
  if (codaA && codaA === codaB) return RHYME.CODA;
  return RHYME.NONE;
}
