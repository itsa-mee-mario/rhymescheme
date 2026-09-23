/**
 * The theme map.
 *
 * Every theme is a blend of vibes, so a theme's position can be derived from
 * that blend rather than invented: give each vibe an anchor on a circle and put
 * the theme at the weighted centroid of the vibes it uses. Themes that lean on
 * one vibe sit out near its anchor; blends fall between them; the
 * everything-at-once themes land in the middle.
 *
 * That makes the layout meaningful — neighbours on the map really are
 * neighbours in register — and stable, since it is a function of the data.
 */

import { hashSeed } from './rng.js';

/** One anchor per vibe, evenly spaced, starting at the top. */
export function vibeAnchors(banks, radius = 1) {
  const n = banks.length;
  return banks.map((bank, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return {
      id: bank.id,
      name: bank.name,
      colour: bank.colour,
      angle,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
}

/** Weighted centroid of the theme's vibes, in the anchors' coordinate space. */
export function projectTheme(theme, anchors) {
  let x = 0;
  let y = 0;
  let total = 0;
  for (const anchor of anchors) {
    const weight = theme.weights[anchor.id] ?? 0;
    if (weight <= 0) continue;
    x += anchor.x * weight;
    y += anchor.y * weight;
    total += weight;
  }
  if (!total) return { x: 0, y: 0 };
  return { x: x / total, y: y / total };
}

/**
 * The vibe a theme is mostly made of, or null when it has no clear lead.
 *
 * Returning the first-listed vibe for an even seven-way blend would colour it
 * as though it were a Rust theme, which is a lie the map would tell at a
 * glance. A tie across three or more vibes is a blend, and gets no colour.
 */
export function dominantVibe(theme) {
  const live = Object.entries(theme.weights).filter(([, w]) => w > 0);
  if (!live.length) return null;
  const top = Math.max(...live.map(([, w]) => w));
  const leaders = live.filter(([, w]) => w === top);
  return leaders.length >= 3 ? null : leaders[0][0];
}

/** Vibes a theme uses, heaviest first. */
export function themeVibes(theme) {
  return Object.entries(theme.weights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([vibe, weight]) => ({ vibe, weight }));
}

/** A small, stable offset so themes with identical blends do not stack. */
function jitter(id) {
  const next = hashSeed(id);
  const a = (next() / 4294967296) * Math.PI * 2;
  const r = (next() / 4294967296) * 0.5 + 0.5;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/**
 * Place every theme, then push overlapping ones apart.
 *
 * Relaxation rather than a fixed grid: the projection is the thing worth
 * preserving, and nudging collisions apart distorts it far less than snapping
 * everything to cells would.
 */
export function layoutAtlas(themes, banks, {
  width = 900, height = 620, padding = 74, minDist = 62, passes = 220,
} = {}) {
  const anchors = vibeAnchors(banks);
  const cx = width / 2;
  const cy = height / 2;
  const rx = (width - padding * 2) / 2;
  const ry = (height - padding * 2) / 2;

  const nodes = themes.map((theme) => {
    const p = projectTheme(theme, anchors);
    const j = jitter(theme.id);
    return {
      theme,
      vibe: dominantVibe(theme),
      x: cx + p.x * rx + j.x * 14,
      y: cy + p.y * ry + j.y * 14,
    };
  });

  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let k = i + 1; k < nodes.length; k++) {
        const a = nodes[i];
        const b = nodes[k];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        if (dist < 0.001) {   // exactly coincident: pick a direction
          dx = Math.cos(i * 2.399);
          dy = Math.sin(i * 2.399);
          dist = 1;
        }
        const push = (minDist - dist) / 2;
        const ux = (dx / dist) * push;
        const uy = (dy / dist) * push;
        a.x -= ux; a.y -= uy;
        b.x += ux; b.y += uy;
        moved = true;
      }
    }
    for (const node of nodes) {
      node.x = Math.min(width - padding / 2, Math.max(padding / 2, node.x));
      node.y = Math.min(height - padding / 2, Math.max(padding / 2, node.y));
    }
    if (!moved) break;
  }

  return {
    width,
    height,
    nodes,
    anchors: anchors.map((a) => ({
      ...a,
      px: cx + a.x * rx,
      py: cy + a.y * ry,
    })),
    centre: { x: cx, y: cy },
  };
}

/** What the atlas knows about one theme. */
export function themeStatus(theme, { seen, unlockedVibes }) {
  const unlocked = new Set(unlockedVibes);
  const missing = themeVibes(theme)
    .map((v) => v.vibe)
    .filter((v) => !unlocked.has(v));
  const record = seen?.[theme.id] ?? null;
  return {
    locked: missing.length > 0,
    missing,
    explored: !!record,
    plays: record?.plays ?? 0,
    bestInk: record?.bestInk ?? 0,
    line: record?.line ?? null,
    lastSeed: record?.lastSeed ?? null,
  };
}

export function atlasSummary(themes, { seen, unlockedVibes }) {
  let explored = 0;
  let available = 0;
  for (const theme of themes) {
    const status = themeStatus(theme, { seen, unlockedVibes });
    if (status.explored) explored++;
    if (!status.locked) available++;
  }
  return { explored, available, total: themes.length };
}
