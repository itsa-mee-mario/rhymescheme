/**
 * Poem forms. A form is the win condition of a map: how many lines, which
 * rhyme scheme they must satisfy, and how long each line wants to be.
 *
 * `slots` is the number of *scoring* tiles a line holds. Function words from
 * the glue tray sit between slots and are not counted here.
 */

export const FORMS = [
  {
    id: 'quatrain',
    name: 'Quatrain',
    blurb: 'Four lines, alternating rhyme.',
    scheme: 'ABAB',
    lines: 4,
    slots: 4,
    sylTarget: [8, 8, 8, 8],
    tolerance: 2,
  },
  {
    id: 'couplets',
    name: 'Couplets',
    blurb: 'Two pairs, each rhyming with itself.',
    scheme: 'AABB',
    lines: 4,
    slots: 4,
    sylTarget: [8, 8, 8, 8],
    tolerance: 2,
  },
  {
    id: 'envelope',
    name: 'Envelope',
    blurb: 'The outer lines close around the inner.',
    scheme: 'ABBA',
    lines: 4,
    slots: 4,
    sylTarget: [8, 8, 8, 8],
    tolerance: 2,
  },
  {
    id: 'open',
    name: 'Open Form',
    blurb: 'No scheme. Shape is all yours.',
    scheme: '---',
    lines: 3,
    slots: 5,
    sylTarget: [7, 9, 5],
    tolerance: 3,
  },
];

export function formById(id) {
  return FORMS.find((f) => f.id === id) || FORMS[0];
}

/**
 * Group line indices by their scheme letter, skipping '-' (unrhymed).
 * "ABAB" -> [[0,2],[1,3]]
 */
export function rhymeGroups(form) {
  const groups = new Map();
  for (let i = 0; i < form.lines; i++) {
    const letter = form.scheme[i] || '-';
    if (letter === '-') continue;
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(i);
  }
  return [...groups.entries()]
    .map(([letter, indices]) => ({ letter, indices }))
    .filter((g) => g.indices.length > 1);
}
