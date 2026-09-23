/**
 * Bootstrap: load data, build a map from the seed in the URL (or a fresh one),
 * and run the frame loop.
 */

import { setTable } from './phonemes.js';
import { makeGame } from './state.js';
import { lineParts } from './poem.js';
import { describeMix } from './state.js';
import { randomSeedWord } from './rng.js';
import { makeRenderer, applyVibeColours } from './render/dom.js';
import * as progression from './progression.js';
import * as share from './share.js';

const VIBE_FILES = [
  'rust.json', 'tide.json', 'hollow.json', 'plenty.json',
  'fluke.json', 'ember.json', 'bloom.json', 'static.json', 'vellum.json',
];
const GLUE_FILE = 'data/function_words.json';
const CARD_FILE = 'data/cards.json';
const THEME_FILE = 'data/themes.json';
const WILD_FILE = 'data/wildcards.json';

const els = {
  poem: document.getElementById('poem'),
  belt: document.getElementById('belt'),
  beltRail: document.getElementById('belt-rail'),
  themeName: document.getElementById('theme-name'),
  themeBlurb: document.getElementById('theme-blurb'),
  formScheme: document.getElementById('form-scheme'),
  inkTotal: document.getElementById('ink-total'),
  rhymeToggle: document.getElementById('rhyme-toggle'),
  seedInput: document.getElementById('seed-input'),
  newMap: document.getElementById('new-map'),
  how: document.getElementById('how'),
  beltSupply: document.getElementById('belt-supply'),
  beltVibes: document.getElementById('belt-vibes'),
  banner: document.getElementById('banner'),
  glueTray: document.getElementById('glue-tray'),
  glueCount: document.getElementById('glue-count'),
  bonusTray: document.getElementById('bonus-tray'),
  draft: document.getElementById('draft'),
  held: document.getElementById('held'),
  foresight: document.getElementById('foresight'),
  dredge: document.getElementById('dredge'),
  archive: document.getElementById('archive'),
  atlas: document.getElementById('atlas'),
  atlasPanel: document.getElementById('atlas-panel'),
  wildcard: document.getElementById('wildcard'),
  archivePanel: document.getElementById('archive-panel'),
  sharePanel: document.getElementById('share-panel'),
  tutorial: document.getElementById('tutorial'),
  progress: document.getElementById('progress'),
};

/**
 * Load a data file.
 *
 * The single-file build has no server to fetch from -- and over file:// a fetch
 * fails outright -- so `tools/bundle.py` embeds every data file up front and
 * this reads from there when it is present. In development the map is absent
 * and it falls through to the network as normal.
 */
async function loadJson(path) {
  const embedded = globalThis.__SWIFTADRIFT_DATA__;
  if (embedded && Object.prototype.hasOwnProperty.call(embedded, path)) {
    return embedded[path];
  }
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

let banks = [];
let glueWords = [];
let cardData = null;
let themes = [];
let sharingPoem = null;
let tutorialOpen = false;
let atlasOpen = false;
let wildcards = null;
let allBanks = [];
let saveState = progression.emptySave();
let recorded = false;      // guards against recording one map twice

/** Only the vibes earned so far, and only cards that can act on them. */
function unlockedBanks() {
  const unlocked = new Set(progression.unlockedVibes(saveState));
  return allBanks.filter((b) => unlocked.has(b.id));
}

function playableCards() {
  if (!cardData) return null;
  const unlocked = new Set(progression.unlockedVibes(saveState));
  return {
    ...cardData,
    // A theme card naming a locked vibe would be silently inert, so keep it
    // out of the draft entirely rather than offering a card that does nothing.
    cards: cardData.cards.filter((card) => {
      const named = Object.keys(card.effect?.vibeWeights || {});
      return named.every((v) => unlocked.has(v));
    }),
  };
}

/** Fold the finished map into the save and announce anything it unlocked. */
function recordFinishedMap(game) {
  if (recorded || !game?.over) return;
  recorded = true;
  // Ink EARNED is what the poem was worth, independent of anything spent on
  // cards during the map -- spending must never cost progress towards a vibe.
  const inkEarned = Math.max(0, progression.inkEarnedFor(game));
  game.inkEarned = inkEarned;
  game.finishedPoem = {
    seed: game.map.seed,
    formId: game.form.id,
    formName: game.form.name,
    scheme: game.form.scheme,
    themeId: game.theme?.id ?? null,
    themeName: game.theme?.name ?? null,
    lines: game.poem.lines.map((l) =>
      lineParts(l).map((p) => (p.kind === 'glue' ? p.text : p.tile.text)).join(' ')),
    ink: inkEarned,
    complete: game.score.complete,
    vibes: [...new Set(game.poem.lines.flatMap((l) => l.tiles.map((t) => t.vibe)))],
  };
  const result = progression.recordMap(saveState, game.finishedPoem);
  saveState = result.state;
  progression.save(saveState);
  game.unlocked = result.unlocked;
  game.progress = saveState;
  game.unlockedVibeIds = progression.unlockedVibes(saveState);

  // The poem IS the result, so show it rather than a score card you have to
  // click through. Closing it falls back to the end-of-map banner.
  openShare(game.finishedPoem);
  game.dirty = true;
}
let game = null;
let renderer = null;
let raf = 0;
let last = 0;

let archiveOpen = false;

function seedFromUrl() {
  return new URLSearchParams(location.search).get('seed');
}

function start(seed) {
  cancelAnimationFrame(raf);
  els.belt.replaceChildren();

  banks = unlockedBanks();
  recorded = false;
  game = makeGame({
    seed, banks, width: els.beltRail.clientWidth, glueWords,
    cardData: playableCards(),
    themes,
    wildcards,
    allBanks,
    rhyme: saveState.settings?.rhyme !== false,
    onOver: recordFinishedMap,
  });
  game.progress = saveState;
  game.unlocked = [];
  // The atlas shows every theme and vibe, including the ones still locked, so
  // it needs the full sets rather than the playable subset the map was built from.
  game.allBanks = allBanks;
  game.allThemes = themes;
  game.unlockedVibeIds = progression.unlockedVibes(saveState);
  els.seedInput.value = game.map.seed;
  els.beltVibes.textContent = describeMix(game.map.vibeMix, banks).join(' · ');
  if (els.rhymeToggle) els.rhymeToggle.checked = game.rhyme;

  const url = new URL(location.href);
  url.searchParams.set('seed', game.map.seed);
  history.replaceState(null, '', url);

  renderer = makeRenderer({
    game, els,
    handlers: {
      onTake: (id) => game.takeTile(id),
      onSelectLine: (i) => { game.selectLine(i); },
      onRemove: (line, slot) => { game.removeTile(line, slot); },
      onAddGlue: (word) => game.addGlue(word),
      onRemoveGlue: (line, gap, index) => { game.removeGlue(line, gap, index); },
      onTakeCard: (id) => game.takeCard(id),
      onSkipDraft: () => game.closeDraft(),
      onDredge: () => game.recall(),
      onNewMap: () => start(randomSeedWord()),
      onTakeBonus: (id) => game.takeBonus(id),
      onOpenWildcard: (id) => game.openWildcard(id),
      onTakeWildcard: () => game.takeWildcard(),
      onLeaveWildcard: () => game.leaveWildcard(),
      onShareCurrent: () => openShare(game.finishedPoem),
      onSharePoem: (poem) => openShare(poem),
      onCloseShare: () => { sharingPoem = null; renderer.sync(); },
      sharingPoem: () => sharingPoem,
      // Only the poem you have just finished gets the end-of-map chrome;
      // reopening an old one from the archive is just a share sheet.
      isFinishedPoem: () => !!sharingPoem && sharingPoem === game?.finishedPoem,
      onSavePng: (poem, canvas) =>
        share.downloadCard(canvas, `swiftadrift-${poem.seed}.png`),
      onCopyText: (text, btn) => flash(btn, share.copyText(text)),
      onCopyImage: (canvas, btn) => flash(btn, share.copyImage(canvas)),
      onNativeShare: (poem, canvas) => share.nativeShare(poem, canvas),
      isAtlasOpen: () => atlasOpen,
      onCloseAtlas: () => { atlasOpen = false; renderer.sync(); },
      isTutorialOpen: () => tutorialOpen,
      onCloseTutorial: () => closeTutorial(),
      onOpenArchive: () => { archiveOpen = true; renderer.sync(); },
      onCloseArchive: () => { archiveOpen = false; renderer.sync(); },
      onReplaySeed: (seed) => { archiveOpen = false; atlasOpen = false; start(seed); },
      isArchiveOpen: () => archiveOpen,
    },
  });

  renderer.sync();
  last = performance.now();
  raf = requestAnimationFrame(loop);

  // Announce the live game so tooling (and the console) can drive it without
  // waiting on animation frames.
  window.swiftadrift = { game, renderer, start };
  window.dispatchEvent(new CustomEvent('swiftadrift:ready', {
    detail: { game, renderer },
  }));
}

function openShare(poem) {
  if (!poem) return;
  sharingPoem = poem;
  renderer.sync();
}

/** Momentary confirmation on a button whose action has no visible result. */
async function flash(btn, promise) {
  const was = btn.textContent;
  const ok = await promise;
  btn.textContent = ok ? 'copied' : 'press ctrl+c';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = was; btn.disabled = false; }, 1600);
}

function closeTutorial() {
  tutorialOpen = false;
  if (game && !game.over && !game.drafting && !game.wildcard) game.running = true;
  renderer.sync();
}

function openTutorial() {
  tutorialOpen = true;
  if (game) game.running = false;
  renderer.sync();
}

function loop(now) {
  // Clamp dt so a backgrounded tab does not teleport the whole belt off-screen.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  game.tick(dt);
  renderer.frame();
  if (game.dirty) { game.dirty = false; renderer.sync(); }

  raf = requestAnimationFrame(loop);
}

function wireControls() {
  els.newMap.addEventListener('click', () => start(randomSeedWord()));
  els.how?.addEventListener('click', () => {
    if (tutorialOpen) closeTutorial(); else openTutorial();
  });
  els.rhymeToggle?.addEventListener('change', () => {
    saveState = progression.setSetting(saveState, 'rhyme', els.rhymeToggle.checked);
    progression.save(saveState);
    start(game.map.seed);      // the scheme is baked in when the map is made
  });
  els.atlas?.addEventListener('click', () => {
    atlasOpen = !atlasOpen;
    renderer.sync();
  });
  els.archive?.addEventListener('click', () => {
    archiveOpen = !archiveOpen;
    renderer.sync();
  });
  els.seedInput.addEventListener('change', () => {
    const value = els.seedInput.value.trim();
    if (value) start(value);
  });
  window.addEventListener('resize', () => {
    if (game) game.belt.resize(els.beltRail.clientWidth);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    // Panels take the keyboard while they are open, apart from the ones that
    // dismiss them, handled below.
    const blocked = tutorialOpen || atlasOpen || archiveOpen
      || sharingPoem || game?.drafting || game?.wildcard;

    if (!blocked) {
      if (e.key === ' ') {
        // Catch whatever is closest to the vanishing edge -- the one you are
        // about to lose is the one worth a hotkey.
        e.preventDefault();
        const nearest = game.belt.tiles
          .filter((t) => !t.wildcard)
          .reduce((a, t) => (a && a.x <= t.x ? a : t), null);
        if (nearest) game.takeTile(nearest.id);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const n = game.poem.lines.length;
        game.selectLine((game.poem.activeLine + step + n) % n);
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        const line = game.poem.lines[game.poem.activeLine];
        if (line.tiles.length) game.removeTile(game.poem.activeLine, line.tiles.length - 1);
        return;
      }
      if (e.key === 's' && game.finishedPoem) { openShare(game.finishedPoem); return; }
    }
    if (e.key >= '1' && e.key <= '9') game.selectLine(Number(e.key) - 1);
    if (e.key === 'n') start(randomSeedWord());
    if (e.key === 'r') game.recall();
    if (e.key === 'p') { archiveOpen = !archiveOpen; renderer.sync(); }
    if (e.key === 'm') { atlasOpen = !atlasOpen; renderer.sync(); }
    if (e.key === '?') { tutorialOpen ? closeTutorial() : openTutorial(); }
    if (e.key === 'Escape') {
      if (sharingPoem) { sharingPoem = null; renderer.sync(); }
      else if (atlasOpen) { atlasOpen = false; renderer.sync(); }
      else if (archiveOpen) { archiveOpen = false; renderer.sync(); }
      else if (tutorialOpen) closeTutorial();
    }
  });
}

async function boot() {
  try {
    const [phonemes, glue, cards, themeData, wildData, ...loaded] = await Promise.all([
      loadJson('data/phonemes.json'),
      loadJson(GLUE_FILE),
      loadJson(CARD_FILE),
      loadJson(THEME_FILE),
      loadJson(WILD_FILE),
      ...VIBE_FILES.map((f) => loadJson(`data/vibes/${f}`)),
    ]);
    themes = themeData.themes;
    wildcards = wildData;
    setTable(phonemes);
    glueWords = glue.words.map((w) => w.w);
    cardData = cards;
    allBanks = loaded;
    saveState = progression.load();
    banks = unlockedBanks();
    applyVibeColours(allBanks);
    wireControls();
    start(seedFromUrl() || randomSeedWord());
    // Every load opens on the tutorial, not just the first. The belt is already
    // built and paused behind it, so pressing start drops you straight in.
    openTutorial();
  } catch (err) {
    document.body.innerHTML =
      `<pre class="boot-error">Could not start.\n\n${err.message}\n\n` +
      `ES modules and fetch need a real server:\n  python3 -m http.server 8000</pre>`;
    throw err;
  }
}

boot();
