/**
 * Turning a finished poem into something you can post.
 *
 * Two artefacts: a plain-text version (with the seed, so anyone can play the
 * same map) and a rendered PNG card. The card is drawn on a canvas rather than
 * screenshotted so it is legible at social-media sizes -- the playing board is
 * far too dense and dark to post as-is.
 */

const CARD_W = 1200;
const CARD_H = 675;   // 16:9, the shape every timeline crops to

const PALETTE = {
  bg: '#12110f',
  wash: '#1b1917',
  ink: '#ece5dc',
  dim: '#9c938a',
  faint: '#6b635b',
  accent: '#e0b25c',
};

export const SITE = 'swiftadrift';

export function poemText(poem) {
  return poem.lines.filter((l) => l.trim()).join('\n');
}

/** What goes in a post: the poem, its theme, and the seed to replay it. */
export function shareText(poem, { url } = {}) {
  const parts = [poemText(poem)];
  const tags = [poem.themeName, poem.formName].filter(Boolean).join(' · ');
  if (tags) parts.push(`— ${tags}`);
  if (url) parts.push(url);
  return parts.join('\n\n');
}

export function shareUrl(poem, origin = globalThis.location?.origin ?? '') {
  const path = globalThis.location?.pathname ?? '/';
  return `${origin}${path}?seed=${encodeURIComponent(poem.seed)}`;
}

export const INTENTS = [
  {
    id: 'bluesky',
    name: 'Bluesky',
    build: (text) => `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`,
  },
  {
    id: 'mastodon',
    name: 'Mastodon',
    build: (text) => `https://mastodon.social/share?text=${encodeURIComponent(text)}`,
  },
  {
    id: 'x',
    name: 'X',
    build: (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
  },
];

/** Fit `text` to `maxWidth`, breaking on spaces. Returns the lines. */
function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  return lines;
}

const SERIF = 'Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif';
const MONO = 'ui-monospace, SF Mono, Menlo, Consolas, monospace';

/**
 * Draw the poem onto a canvas. Returns the canvas so the caller can turn it
 * into a blob, a data URL, or put it straight on the page as a preview.
 */
export function renderCard(poem, { scale = 1 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // A soft wash behind the text so the card is not a flat rectangle.
  const glow = ctx.createRadialGradient(CARD_W * 0.3, CARD_H * 0.3, 40,
    CARD_W * 0.3, CARD_H * 0.3, CARD_W * 0.8);
  glow.addColorStop(0, PALETTE.wash);
  glow.addColorStop(1, PALETTE.bg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const pad = 84;
  const maxWidth = CARD_W - pad * 2;

  // Lines, sized down until the whole poem fits the card.
  const lines = poem.lines.filter((l) => l.trim());
  let size = 46;
  let laid = [];
  for (; size >= 22; size -= 2) {
    ctx.font = `${size}px ${SERIF}`;
    laid = lines.flatMap((line) => wrap(ctx, line, maxWidth));
    if (laid.length * size * 1.5 <= CARD_H - pad * 2 - 90) break;
  }

  ctx.font = `${size}px ${SERIF}`;
  ctx.fillStyle = PALETTE.ink;
  ctx.textBaseline = 'alphabetic';
  const lead = size * 1.5;
  const blockH = laid.length * lead;
  // Centre within the area ABOVE the footer, not the whole card -- otherwise
  // the poem floats high and the card looks bottom-heavy.
  const top = pad;
  const bottom = CARD_H - pad - 50;
  let y = top + (bottom - top - blockH) / 2 + size * 0.6;
  for (const line of laid) {
    ctx.fillText(line, pad, y);
    y += lead;
  }

  // Footer: what made it, and the seed that reproduces it.
  ctx.font = `20px ${MONO}`;
  ctx.fillStyle = PALETTE.accent;
  ctx.fillText(SITE, pad, CARD_H - pad + 6);

  const meta = [poem.themeName, poem.formName, poem.seed].filter(Boolean).join('  ·  ');
  ctx.fillStyle = PALETTE.faint;
  ctx.font = `17px ${MONO}`;
  const metaW = ctx.measureText(meta).width;
  ctx.fillText(meta, CARD_W - pad - metaW, CARD_H - pad + 6);

  // A hairline rule above the footer.
  ctx.strokeStyle = '#2e2a26';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, CARD_H - pad - 26);
  ctx.lineTo(CARD_W - pad, CARD_H - pad - 26);
  ctx.stroke();

  return canvas;
}

export function cardBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy the rendered card itself, where the browser allows it. */
export async function copyImage(canvas) {
  try {
    const blob = await cardBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function downloadCard(canvas, filename) {
  const blob = await cardBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The OS share sheet, when the browser has one and can take a file. */
export async function nativeShare(poem, canvas) {
  if (!navigator.share) return false;
  const text = shareText(poem, { url: shareUrl(poem) });
  try {
    const blob = canvas ? await cardBlob(canvas) : null;
    const file = blob ? new File([blob], `${poem.seed}.png`, { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ text, files: [file] });
    } else {
      await navigator.share({ text });
    }
    return true;
  } catch {
    return false;   // the user dismissed the sheet, or sharing is unavailable
  }
}
