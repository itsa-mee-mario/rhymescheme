/**
 * What survives between sessions: which vibes you have unlocked, what you have
 * scored, and the poems you finished.
 *
 * Every localStorage access is wrapped. A private window, cleared site data or
 * a browser set to block storage all throw or return null, and none of those
 * should stop the game from starting -- they just mean this run is not recorded.
 */

const KEY = 'swiftadrift.save.v2';
const LEGACY_KEYS = ['rhymescheme.save.v1'];

/** Used only to convert an older score-based save into ink. */
const LEGACY_INK_PER_POINT = 0.025;
const MAX_POEMS = 60;

/** The three banks you begin with. The rest are earned. */
/**
 * Four to start, not three. Rust, Tide and Hollow are all one mood -- decay,
 * longing, absence -- so a game that opened on only those three had no tonal
 * range at all, and every theme built from them read the same. Plenty is the
 * counterweight, and it has to be there from the first map rather than earned.
 */
export const STARTING_VIBES = ['rust', 'tide', 'hollow', 'plenty'];

/**
 * Unlocks are keyed on LIFETIME INK EARNED, not on ink you currently hold --
 * spending ink on cards must never cost you progress towards a vibe.
 */
export const UNLOCKS = [
  // Fluke comes first so surprise arrives early; the bleaker registers are the
  // ones that can afford to wait.
  { vibe: 'fluke', at: 15, name: 'Fluke', blurb: 'chance, surprise, mischief' },
  { vibe: 'ember', at: 35, name: 'Ember', blurb: 'heat, anger, appetite' },
  { vibe: 'bloom', at: 60, name: 'Bloom', blurb: 'growth, sweetness, body' },
  { vibe: 'static', at: 95, name: 'Static', blurb: 'signal, machinery, noise' },
  { vibe: 'vellum', at: 130, name: 'Vellum', blurb: 'archaic, liturgical, vowed' },
];

export const DEFAULT_SETTINGS = { rhyme: true };

export function emptySave() {
  return {
    version: 2,
    totalInk: 0,
    mapsPlayed: 0,
    bestByForm: {},
    themesSeen: {},
    poems: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function storage() {
  try {
    const s = globalThis.localStorage;
    // Touch it: some browsers expose the object but throw on use.
    s.getItem(KEY);
    return s;
  } catch {
    return null;
  }
}

export function load() {
  const store = storage();
  if (!store) return emptySave();
  try {
    const raw = store.getItem(KEY)
      ?? LEGACY_KEYS.map((k) => store.getItem(k)).find(Boolean);
    if (!raw) return emptySave();
    return migrate(JSON.parse(raw));
  } catch {
    // A corrupt or foreign save is not worth crashing over; start fresh.
    return emptySave();
  }
}

export function save(state) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;   // quota, or storage disabled mid-session
  }
}

export function clear() {
  const store = storage();
  try { store?.removeItem(KEY); } catch { /* nothing to do */ }
  return emptySave();
}

/** Bring an older or partial save up to the current shape. */
export function migrate(parsed) {
  const base = emptySave();
  if (!parsed || typeof parsed !== 'object') return base;

  // A v1 save counted raw score. Convert it at the rate score used to earn ink
  // so an existing player keeps the vibes they had already unlocked.
  const totalInk = parsed.totalInk !== undefined
    ? Number(parsed.totalInk) || 0
    : Math.floor((Number(parsed.totalScore) || 0) * LEGACY_INK_PER_POINT);

  return {
    ...base,
    ...parsed,
    version: base.version,
    totalInk,
    mapsPlayed: Number(parsed.mapsPlayed) || 0,
    bestByForm: parsed.bestByForm && typeof parsed.bestByForm === 'object'
      ? parsed.bestByForm : {},
    poems: Array.isArray(parsed.poems) ? parsed.poems.slice(0, MAX_POEMS) : [],
    themesSeen: parsed.themesSeen && typeof parsed.themesSeen === 'object'
      ? parsed.themesSeen : {},
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
  };
}

/**
 * The ink a finished map earned, which is what counts towards unlocks.
 *
 * Deliberately excludes the small stipend every map starts you with -- that is
 * a loan for the first draft, not something you produced -- and ignores
 * anything spent, so buying cards never slows your progress towards a vibe.
 */
export function inkEarnedFor(game) {
  const rate = game?.cardConfig?.inkPerPoint ?? 0;
  return Math.floor(Math.max(0, game?.score?.total ?? 0) * rate);
}

export function setSetting(state, key, value) {
  return { ...state, settings: { ...state.settings, [key]: value } };
}

/** Vibe ids unlocked at a given lifetime ink total. */
export function unlockedVibes(state) {
  const total = state?.totalInk ?? 0;
  return [
    ...STARTING_VIBES,
    ...UNLOCKS.filter((u) => total >= u.at).map((u) => u.vibe),
  ];
}

/** The next unlock still ahead, or null once everything is earned. */
export function nextUnlock(state) {
  const total = state?.totalInk ?? 0;
  return UNLOCKS.find((u) => total < u.at) || null;
}

/**
 * Fold a finished map into the save.
 * Returns the new state plus whatever it just unlocked, so the UI can announce it.
 */
export function recordMap(state, entry) {
  const before = new Set(unlockedVibes(state));
  const next = {
    ...state,
    totalInk: state.totalInk + Math.max(0, entry.ink),
    mapsPlayed: state.mapsPlayed + 1,
    bestByForm: { ...state.bestByForm },
    themesSeen: { ...state.themesSeen },
    poems: state.poems.slice(),
  };

  // Log the visit on the theme map. The kept line is the longest one you
  // actually wrote under this theme -- the atlas shows it back to you, so it
  // should be the most substantial thing the map produced, not the first.
  if (entry.themeId) {
    const before = next.themesSeen[entry.themeId] ?? { plays: 0, bestInk: 0, line: null };
    const longest = (entry.lines || [])
      .map((l) => l.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] ?? null;
    next.themesSeen[entry.themeId] = {
      plays: before.plays + 1,
      bestInk: Math.max(before.bestInk, Math.max(0, entry.ink)),
      line: entry.ink >= before.bestInk && longest ? longest : before.line,
      lastSeed: entry.seed,
      name: entry.themeName ?? before.name ?? null,
    };
  }

  const best = next.bestByForm[entry.formId] ?? 0;
  if (entry.ink > best) next.bestByForm[entry.formId] = entry.ink;

  // Only keep poems with something in them.
  if (entry.lines.some((line) => line.trim())) {
    next.poems.unshift({
      seed: entry.seed,
      formId: entry.formId,
      formName: entry.formName,
      scheme: entry.scheme,
      lines: entry.lines,
      ink: entry.ink,
      themeName: entry.themeName || null,
      complete: !!entry.complete,
      vibes: entry.vibes || [],
      at: entry.at ?? Date.now(),
    });
    next.poems.length = Math.min(next.poems.length, MAX_POEMS);
  }

  const unlocked = UNLOCKS.filter((u) => !before.has(u.vibe) && next.totalInk >= u.at);
  return { state: next, unlocked };
}
