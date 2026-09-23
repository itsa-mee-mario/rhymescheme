/**
 * Renders game state into the DOM.
 *
 * Two update paths, because they run at different rates: `frame()` only writes
 * belt tile transforms and runs every animation frame; `sync()` rebuilds the
 * poem and the score readout, and runs only when state actually changed.
 *
 * Colour channels are kept apart on purpose -- vibe is the tile FILL, rhyme
 * group is the line BADGE and slot outline. Using colour for both would make
 * the two languages unreadable against each other.
 */

import { tileWidth } from '../belt.js';
import { rhymeGroups } from '../forms.js';
import { lineParts, glueCount } from '../poem.js';
import { nextUnlock, UNLOCKS, STARTING_VIBES } from '../progression.js';
import { INTENTS, renderCard, shareText, shareUrl } from '../share.js';
import {
  layoutAtlas, themeStatus, themeVibes, atlasSummary,
} from '../atlas.js';

const SCHEME_LETTERS = ['A', 'B', 'C', 'D'];

export function applyVibeColours(banks) {
  const root = document.documentElement;
  for (const bank of banks) {
    const c = bank.colour || {};
    root.style.setProperty(`--vibe-${bank.id}-fill`, c.fill || '#555');
    root.style.setProperty(`--vibe-${bank.id}-ink`, c.ink || '#fff');
    root.style.setProperty(`--vibe-${bank.id}-edge`, c.edge || '#888');
  }
}

export function makeRenderer({ game, els, handlers }) {
  const tileEls = new Map();
  let animatedPlacement = null;

  function frame() {
    const seen = new Set();
    for (const tile of game.belt.tiles) {
      seen.add(tile.id);
      let el = tileEls.get(tile.id);
      if (!el) {
        el = document.createElement('button');
        el.className = `tile${tile.phrase ? ' tile-phrase' : ''}`
          + (tile.wildcard ? ' tile-wild' : '');
        el.dataset.vibe = tile.vibe;
        el.dataset.pos = tile.pos;
        el.innerHTML =
          `<span class="tile-text"></span><span class="tile-syl"></span>`;
        el.querySelector('.tile-text').textContent = tile.text;
        el.querySelector('.tile-syl').textContent = '•'.repeat(Math.min(tile.syl, 6));
        el.title = tile.wildcard
          ? 'A wildcard. Click to see the offer — you can still walk away.'
          : `${tile.vibeName} · ${tile.pos} · ${tile.syl} syl · rhymes on ${tile.rhyme || '?'}`;
        el.addEventListener('click', () => {
          if (tile.wildcard) {
            if (handlers.onOpenWildcard(tile.id)) { el.remove(); tileEls.delete(tile.id); }
            return;
          }
          // Drop the element the moment the take succeeds rather than waiting
          // for the next frame's reconcile: otherwise a fast second click lands
          // on a tile that is already off the belt.
          if (handlers.onTake(tile.id)) {
            // Drop it from the live map at once so a fast second click cannot
            // land on a tile that has already left the belt, but let the
            // element play its exit before it goes.
            tileEls.delete(tile.id);
            el.disabled = true;
            el.classList.add('tile-taken');
            el.addEventListener('animationend', () => el.remove(), { once: true });
            // Reduced motion means no animationend ever fires.
            setTimeout(() => el.remove(), 420);
          }
        });
        els.belt.appendChild(el);
        tileEls.set(tile.id, el);
      }
      const x = `${Math.round(tile.x)}px`;
      el.style.transform = `translateX(${x})`;
      el.style.setProperty('--x', x);
      // Fade as a tile nears the edge: the last chance to grab it.
      const fade = Math.min(1, Math.max(0.15, (tile.x + tileWidth(tile)) / 140));
      el.style.opacity = fade < 1 ? String(fade) : '';
    }
    for (const [id, el] of tileEls) {
      if (!seen.has(id)) { el.remove(); tileEls.delete(id); }
    }
  }

  function renderPoem() {
    const { poem, form } = game;
    const groupOf = new Map();
    for (const group of rhymeGroups(form)) {
      for (const i of group.indices) groupOf.set(i, group.letter);
    }
    const score = game.score;

    els.poem.replaceChildren(...poem.lines.map((line, i) => {
      const row = document.createElement('div');
      row.className = 'line';
      if (i === poem.activeLine && !game.over) row.classList.add('active');

      const letter = form.scheme[i] || '-';
      const badge = document.createElement('button');
      badge.className = 'line-badge';
      badge.dataset.scheme = letter === '-' ? 'none' : letter;
      badge.textContent = letter === '-' ? '·' : letter;
      badge.title = letter === '-' ? 'unrhymed line' : `rhyme group ${letter}`;
      badge.addEventListener('click', () => handlers.onSelectLine(i));
      row.appendChild(badge);

      const slots = document.createElement('div');
      slots.className = 'slots';

      // Glue chips sit between scoring slots rather than in them, so the line
      // reads as written while the scheme still judges the words that matter.
      for (const part of lineParts(line)) {
        if (part.kind === 'glue') {
          const chip = document.createElement('button');
          chip.className = 'glue-chip';
          chip.textContent = part.text;
          chip.title = 'click to remove';
          chip.addEventListener('click',
            () => handlers.onRemoveGlue(i, part.gap, part.index));
          slots.appendChild(chip);
        } else {
          slots.appendChild(buildSlot(i, part.slot, part.tile));
        }
      }
      // Empty scoring slots after whatever has been placed.
      for (let s = line.tiles.length; s < form.slots; s++) {
        slots.appendChild(buildSlot(i, s, null));
      }
      row.appendChild(slots);

      function buildSlot(lineIndex, slotIndex, tile) {
        const slot = document.createElement('button');
        slot.className = 'slot';
        if (tile) {
          slot.classList.add('filled');
          // The poem is rebuilt on every sync, so without this guard every slot
          // would replay its landing animation each time the belt moved.
          if (tile.id === game.lastPlacedId && animatedPlacement !== tile.id) {
            slot.classList.add('just-placed');
            animatedPlacement = tile.id;
          }
          slot.dataset.vibe = tile.vibe;
          slot.textContent = tile.text;
          slot.title = `${tile.vibeName} · ${tile.syl} syl — click to remove`;
          slot.addEventListener('click', () => handlers.onRemove(lineIndex, slotIndex));
        } else {
          slot.addEventListener('click', () => handlers.onSelectLine(lineIndex));
        }
        // The last scoring slot is what the rhyme scheme actually judges.
        if (slotIndex === form.slots - 1 && groupOf.has(lineIndex)) {
          slot.classList.add('rhyme-slot');
          slot.dataset.scheme = groupOf.get(lineIndex);
        }
        return slot;
      }

      const meta = document.createElement('span');
      meta.className = 'line-meta';
      const m = score?.meter.lines[i];
      if (m) {
        const off = m.delta === 0 ? 'on' : (m.delta > 0 ? `+${m.delta}` : `${m.delta}`);
        meta.textContent = `${m.syl}/${m.target}`;
        meta.dataset.state = m.delta === 0 ? 'exact'
          : Math.abs(m.delta) <= form.tolerance ? 'near' : 'off';
        meta.title = `${m.syl} syllables, target ${m.target} (${off})`;
      }
      row.appendChild(meta);
      return row;
    }));
  }

  function renderGlueTray() {
    if (!els.glueTray) return;
    const line = game.poem.lines[game.poem.activeLine];
    const spent = glueCount(line);
    const room = spent < game.form.slots;
    // Alphabetical: the tray is a lookup, not a deck. You reach for a
    // specific word, so it needs to be where you expect it every time.
    const words = [...game.glueWords].sort((a, b) => a.localeCompare(b));
    els.glueTray.replaceChildren(...words.map((word) => {
      const btn = document.createElement('button');
      btn.className = 'glue-word';
      btn.textContent = word;
      btn.disabled = !room || game.over;
      btn.addEventListener('click', () => handlers.onAddGlue(word));
      return btn;
    }));
    if (els.glueCount) {
      els.glueCount.textContent = `${spent}/${game.form.slots} glue in line ${game.poem.activeLine + 1}`;
    }
  }

  function renderDraft() {
    if (!game.drafting) { els.draft.hidden = true; return; }
    els.draft.hidden = false;
    els.draft.replaceChildren();

    const box = document.createElement('div');
    box.className = 'draft-inner';
    box.innerHTML =
      `<p class="draft-why">a card — you have <strong>${game.ink}</strong> ink</p>`;

    const row = document.createElement('div');
    row.className = 'draft-row';
    for (const card of game.offer) {
      const affordable = card.cost <= game.ink;
      const el = document.createElement('button');
      el.className = 'card';
      el.dataset.family = card.family;
      el.disabled = !affordable;
      el.innerHTML =
        `<span class="card-family">${card.family}</span>
         <span class="card-name">${escapeHtml(card.name)}</span>
         <span class="card-blurb">${escapeHtml(card.blurb)}</span>
         <span class="card-cost">${card.cost === 0 ? 'free' : `${card.cost} ink`}</span>`;
      el.addEventListener('click', () => handlers.onTakeCard(card.id));
      row.appendChild(el);
    }
    box.appendChild(row);

    const skip = document.createElement('button');
    skip.className = 'btn';
    skip.textContent = 'take none';
    skip.addEventListener('click', handlers.onSkipDraft);
    box.appendChild(skip);

    els.draft.appendChild(box);
  }

  function renderHeld() {
    if (!els.held) return;
    if (!game.held.length) { els.held.hidden = true; return; }
    els.held.hidden = false;
    els.held.replaceChildren(...game.held.map((card) => {
      const chip = document.createElement('span');
      chip.className = 'held-card';
      chip.dataset.family = card.family;
      chip.textContent = card.name;
      chip.title = `${card.family} — ${card.blurb}`;
      return chip;
    }));
  }

  function renderForesight() {
    if (!els.foresight) return;
    const queue = game.belt.queue;
    if (!queue.length) { els.foresight.hidden = true; return; }
    els.foresight.hidden = false;
    els.foresight.replaceChildren(...[
      Object.assign(document.createElement('span'), {
        className: 'foresight-label', textContent: 'coming',
      }),
      ...queue.map((tile) => {
        const chip = document.createElement('span');
        chip.className = 'foresight-tile';
        chip.dataset.vibe = tile.vibe;
        chip.textContent = tile.text;
        return chip;
      }),
    ]);
  }

  function renderDredge() {
    if (!els.dredge) return;
    const can = game.belt.rewinds > 0;
    els.dredge.hidden = !can;
    if (can) {
      els.dredge.textContent = `dredge (${game.belt.rewinds})`;
      els.dredge.disabled = !game.belt.fallen.length;
      els.dredge.onclick = handlers.onDredge;
    }
  }

  function renderProgress() {
    if (!els.progress) return;
    const save = game.progress;
    if (!save) { els.progress.textContent = ''; return; }
    const next = nextUnlock(save);
    const earned = UNLOCKS.length
      - (next ? UNLOCKS.filter((u) => save.totalInk < u.at).length : 0);
    if (!next) {
      els.progress.textContent =
        `${save.totalInk} ink earned across ${save.mapsPlayed} maps · every vibe unlocked`;
      return;
    }
    const togo = next.at - save.totalInk;
    els.progress.innerHTML =
      `${save.totalInk} ink earned · <strong>${togo}</strong> more unlocks ` +
      `<span class="unlock-name">${escapeHtml(next.name)}</span> ` +
      `<em>${escapeHtml(next.blurb)}</em>` +
      ` · ${earned + 3}/${UNLOCKS.length + 3} vibes`;
  }

  function renderArchive() {
    if (!els.archivePanel) return;
    if (!handlers.isArchiveOpen?.()) { els.archivePanel.hidden = true; return; }
    els.archivePanel.hidden = false;

    const poems = game.progress?.poems ?? [];
    const rows = poems.length
      ? poems.map((poem) => `
          <li class="archive-poem">
            <div class="archive-head">
              <span class="archive-form">${escapeHtml(poem.formName || poem.formId)}</span>
              <span class="archive-scheme">${escapeHtml(poem.scheme || '')}</span>
              <span class="archive-theme">${escapeHtml(poem.themeName || '')}</span>
              <span class="archive-score">${poem.ink ?? 0} ink</span>
            </div>
            <div class="archive-lines">${
              poem.lines.map((l) => escapeHtml(l) || '<em>—</em>').join('<br>')
            }</div>
            <div class="archive-actions">
              <button class="archive-replay" data-seed="${escapeHtml(poem.seed)}">
                ${escapeHtml(poem.seed)}
              </button>
              <button class="archive-share" data-index="${poems.indexOf(poem)}">share</button>
            </div>
          </li>`).join('')
      : `<li class="archive-empty">Nothing kept yet. Finish a map and it lands here.</li>`;

    els.archivePanel.innerHTML =
      `<div class="archive-inner">
         <div class="archive-bar">
           <h2>poems</h2>
           <span class="archive-count">${poems.length} kept</span>
           <button class="btn" id="archive-close">close</button>
         </div>
         <ul class="archive-list">${rows}</ul>
       </div>`;

    els.archivePanel.querySelector('#archive-close')
      ?.addEventListener('click', () => handlers.onCloseArchive());
    for (const btn of els.archivePanel.querySelectorAll('.archive-replay')) {
      btn.addEventListener('click', () => handlers.onReplaySeed(btn.dataset.seed));
    }
    for (const btn of els.archivePanel.querySelectorAll('.archive-share')) {
      btn.addEventListener('click',
        () => handlers.onSharePoem(poems[Number(btn.dataset.index)]));
    }
  }

  // --- theme map ----------------------------------------------------------

  let atlasLayout = null;
  let atlasPick = null;

  function atlasContext() {
    return {
      seen: game.progress?.themesSeen ?? {},
      unlockedVibes: game.allBanks.map((b) => b.id)
        .filter((id) => game.unlockedVibeIds.includes(id)),
    };
  }

  function themeCard(theme, status) {
    const vibes = themeVibes(theme);
    const total = vibes.reduce((sum, v) => sum + v.weight, 0);
    const bar = vibes.map((v) =>
      `<span class="mix-slice" data-vibe="${v.vibe}"
             style="flex:${v.weight}" title="${escapeHtml(v.vibe)} ${v.weight}"></span>`).join('');
    const chips = vibes.map((v) =>
      `<span class="mix-chip" data-vibe="${v.vibe}">${escapeHtml(v.vibe)}
         <b>${Math.round((v.weight / total) * 100)}%</b></span>`).join('');

    let state;
    if (status.locked) {
      state = `<p class="card-state locked">Locked — needs
        ${status.missing.map((m) => `<b>${escapeHtml(m)}</b>`).join(' and ')}</p>`;
    } else if (!status.explored) {
      state = `<p class="card-state unvisited">Not yet visited</p>`;
    } else {
      state = `<p class="card-state visited">
        Visited <b>${status.plays}</b> ${status.plays === 1 ? 'time' : 'times'}
        · best <b>${status.bestInk}</b> ink</p>`;
    }

    const quote = status.line
      ? `<blockquote class="card-quote">${escapeHtml(status.line)}</blockquote>`
      : '';
    const replay = status.lastSeed
      ? `<button class="card-replay" data-seed="${escapeHtml(status.lastSeed)}">replay ${escapeHtml(status.lastSeed)}</button>`
      : '';

    return `
      <article class="theme-card${status.locked ? ' is-locked' : ''}">
        <h3 class="card-title">${escapeHtml(theme.name)}</h3>
        <p class="card-blurb">${escapeHtml(theme.blurb)}</p>
        <div class="mix-bar">${bar}</div>
        <div class="mix-chips">${chips}</div>
        ${state}
        ${quote}
        ${replay}
      </article>`;
  }

  function renderAtlas() {
    if (!els.atlasPanel) return;
    if (!handlers.isAtlasOpen?.()) { els.atlasPanel.hidden = true; return; }
    els.atlasPanel.hidden = false;

    const themes = game.allThemes ?? [];
    const ctx = atlasContext();
    const summary = atlasSummary(themes, ctx);
    atlasLayout = layoutAtlas(themes, game.allBanks);

    const { width, height, nodes, anchors, centre } = atlasLayout;

    const spokes = anchors.map((a) =>
      `<line x1="${centre.x}" y1="${centre.y}" x2="${a.px}" y2="${a.py}"
             class="atlas-spoke" data-vibe="${a.id}"/>`).join('');

    const rings = [0.34, 0.67, 1].map((r) =>
      `<ellipse cx="${centre.x}" cy="${centre.y}"
                rx="${(width / 2 - 74) * r}" ry="${(height / 2 - 74) * r}"
                class="atlas-ring"/>`).join('');

    const labels = anchors.map((a) => {
      const out = 1.1;
      const lx = centre.x + (a.px - centre.x) * out;
      const ly = centre.y + (a.py - centre.y) * out;
      return `<div class="atlas-anchor" data-vibe="${a.id}"
                   style="left:${(lx / width) * 100}%; top:${(ly / height) * 100}%">
                ${escapeHtml(a.name)}
              </div>`;
    }).join('');

    const dots = nodes.map((node) => {
      const status = themeStatus(node.theme, ctx);
      const cls = ['atlas-node'];
      if (status.locked) cls.push('locked');
      else if (status.explored) cls.push('explored');
      else cls.push('unvisited');
      if (atlasPick === node.theme.id) cls.push('picked');
      // Visited themes grow a little with each return, so the map shows where
      // you actually spend your time rather than only where you have been once.
      const size = status.explored ? Math.min(13 + status.plays * 2.5, 26) : 9;
      return `<button class="${cls.join(' ')}" data-theme="${escapeHtml(node.theme.id)}"
                data-vibe="${node.vibe ?? 'blend'}"
                title="${escapeHtml(node.theme.name)}"
                style="left:${(node.x / width) * 100}%; top:${(node.y / height) * 100}%;
                       --dot:${size}px">
                <span class="node-label">${escapeHtml(node.theme.name)}</span>
              </button>`;
    }).join('');

    const picked = themes.find((t) => t.id === atlasPick) ?? null;

    els.atlasPanel.innerHTML = `
      <div class="atlas-inner">
        <div class="atlas-bar">
          <h2>theme map</h2>
          <span class="atlas-count">
            <b>${summary.explored}</b> of ${summary.available} reachable visited
            · ${summary.total} in all
          </span>
          <button class="btn" id="atlas-close">close</button>
        </div>

        <p class="atlas-note">
          Every theme sits where its vibes put it — near an edge if it leans on
          one register, towards the middle if it blends. Dots grow as you return.
        </p>

        <div class="atlas-stage" style="aspect-ratio:${width} / ${height}">
          <svg class="atlas-grid" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            ${rings}${spokes}
          </svg>
          ${labels}
          ${dots}
        </div>

        <div class="atlas-detail" id="atlas-detail">
          ${picked
            ? themeCard(picked, themeStatus(picked, ctx))
            : `<p class="atlas-empty">Pick a theme to read it.</p>`}
        </div>
      </div>`;

    els.atlasPanel.querySelector('#atlas-close')
      ?.addEventListener('click', () => handlers.onCloseAtlas());
    for (const dot of els.atlasPanel.querySelectorAll('.atlas-node')) {
      dot.addEventListener('click', () => {
        atlasPick = atlasPick === dot.dataset.theme ? null : dot.dataset.theme;
        renderAtlas();
      });
    }
    els.atlasPanel.querySelector('.card-replay')
      ?.addEventListener('click', (e) => handlers.onReplaySeed(e.currentTarget.dataset.seed));
  }

  function renderWildcard() {
    if (!els.wildcard) return;
    const tile = game.wildcard;
    if (!tile) { els.wildcard.hidden = true; return; }
    els.wildcard.hidden = false;

    const offer = tile.offer;
    const canAfford = game.canAffordWildcard();
    els.wildcard.innerHTML = `
      <div class="wild-inner">
        <p class="wild-tag">a wildcard</p>
        <h2 class="wild-name">${escapeHtml(offer.name)}</h2>
        <div class="wild-trade">
          <div class="wild-side gain">
            <span class="wild-label">you get</span>
            <p>${escapeHtml(offer.gain)}</p>
          </div>
          <div class="wild-side cost">
            <span class="wild-label">it costs</span>
            <p>${escapeHtml(offer.cost)}</p>
          </div>
        </div>
        <div class="wild-actions">
          <button class="btn btn-go" id="wild-take" ${canAfford ? '' : 'disabled'}>
            ${canAfford ? 'take it' : 'not enough ink'}
          </button>
          <button class="btn" id="wild-leave">walk away</button>
        </div>
        <p class="wild-note">Walking away costs nothing — but the word this
        replaced is gone either way.</p>
      </div>`;
    els.wildcard.querySelector('#wild-take')
      ?.addEventListener('click', () => handlers.onTakeWildcard());
    els.wildcard.querySelector('#wild-leave')
      ?.addEventListener('click', () => handlers.onLeaveWildcard());
  }

  function renderTutorial() {
    if (!els.tutorial) return;
    if (!handlers.isTutorialOpen?.()) { els.tutorial.hidden = true; return; }
    els.tutorial.hidden = false;
    els.tutorial.innerHTML = `
      <div class="tutorial-inner">
        <h1 class="wordmark">swiftadrift</h1>
        <p class="tutorial-lede">
          Words ride past on a belt. Keep the ones you want, let the rest go.
          What you keep is the poem.
        </p>

        <ol class="tutorial-steps">
          <li>
            <span class="step-n">1</span>
            <div>
              <strong>Catch words.</strong> Click a tile on the belt and it drops
              into the highlighted line. Click a line to make it the active one.
              Anything you ignore scrolls off the left edge and is gone — that
              is how you cross words out.
            </div>
          </li>
          <li>
            <span class="step-n">2</span>
            <div>
              <strong>Join them up.</strong> Glue words — <em>the, of, and, in</em>
              — are free, unlimited, and sit between the words you caught. They
              never take a slot. You also start each map with a few
              <strong>bonus words</strong> on the right: one use each, drawn from
              vibes this map's theme won't give you.
            </div>
          </li>
          <li>
            <span class="step-n">3</span>
            <div>
              <strong>Earn ink.</strong> <span class="ink-word">Ink</span> is the
              only currency. It builds as your poem gets better — lines that land
              on their syllable target, words that share a vibe, sounds that
              chime, and rhymes that answer each other if you have rhyme switched
              on.
            </div>
          </li>
          <li>
            <span class="step-n">4</span>
            <div>
              <strong>Spend ink on cards.</strong> Three times a map the belt
              pauses and offers you a card. <em class="fam-theme">Theme</em> cards
              change which vibes arrive, <em class="fam-flavour">flavour</em> cards
              change what kind of words they are, and
              <em class="fam-direction">direction</em> cards change the belt
              itself — slower, further ahead, or dragging back what you lost.
            </div>
          </li>
          <li>
            <span class="step-n">5</span>
            <div>
              <strong>Ink unlocks vibes.</strong> Spending never costs you
              progress — it is the ink you <em>earn</em> across every map that
              counts. You begin with ${STARTING_VIBES.length} vibes;
              ${UNLOCKS.length} more are waiting.
              <span class="tutorial-unlocks">${
                UNLOCKS.map((u) =>
                  `<span class="unlock-chip"><b>${u.at}</b> ${escapeHtml(u.name)}</span>`)
                  .join('')
              }</span>
            </div>
          </li>
        </ol>

        <p class="tutorial-wild">
          <strong>And sometimes a <span class="wild-star">✦</span> goes past.</strong>
          A wildcard. Click it and you will be offered a trade — ink, more words,
          a glimpse of a vibe you have not unlocked — always with something to
          pay. Take it or walk away; walking away costs nothing.
        </p>

        <dl class="tutorial-keys">
          <dt>space</dt><dd>catch the word nearest the edge</dd>
          <dt>1&ndash;9</dt><dd>choose a line</dd>
          <dt>&uarr; &darr;</dt><dd>move between lines</dd>
          <dt>&#9003;</dt><dd>take back the last word</dd>
          <dt>n</dt><dd>new map</dd>
          <dt>m</dt><dd>theme map</dd>
          <dt>p</dt><dd>poems</dd>
          <dt>?</dt><dd>this page</dd>
        </dl>

        <p class="tutorial-foot">
          Every map is a fresh theme and a fresh seed. Nothing is timed, nothing
          can be failed — the belt simply runs out.
        </p>
        <button class="btn btn-go" id="tutorial-go">start</button>
      </div>`;
    els.tutorial.querySelector('#tutorial-go')
      ?.addEventListener('click', () => handlers.onCloseTutorial());
  }

  // --- sharing ------------------------------------------------------------

  let sharePreview = null;

  function renderShare() {
    if (!els.sharePanel) return;
    const poem = handlers.sharingPoem?.();
    if (!poem) { els.sharePanel.hidden = true; sharePreview = null; return; }
    els.sharePanel.hidden = false;

    const url = shareUrl(poem);
    const text = shareText(poem, { url });
    const justFinished = handlers.isFinishedPoem?.() ?? false;

    // Finishing a map lands here, so this has to carry the result as well as
    // the share controls -- what it earned, what it unlocked, and the way on.
    const outcome = justFinished
      ? `<div class="share-outcome">
           <p class="share-why">${
             game.belt.drained ? 'the belt ran dry' : 'the poem is finished'}</p>
           <p class="share-ink">
             <span class="ink-earned">+${game.inkEarned ?? 0}</span> ink${
               poem.complete ? ' · complete' : ''}
           </p>
           ${(game.unlocked || []).map((u) => `
             <p class="banner-unlock">
               <span class="unlock-tag">unlocked</span>
               <span class="unlock-name">${escapeHtml(u.name)}</span>
               <em>${escapeHtml(u.blurb)}</em>
             </p>`).join('')}
         </div>`
      : '';

    els.sharePanel.innerHTML = `
      <div class="share-inner">
        <div class="share-bar">
          <h2>${justFinished ? escapeHtml(poem.themeName || 'your poem') : 'share'}</h2>
          <button class="btn" id="share-close">close</button>
        </div>
        ${outcome}
        <div class="share-preview" id="share-preview"></div>
        <div class="share-actions">
          <button class="btn" id="share-png">save image</button>
          <button class="btn" id="share-copy-image">copy image</button>
          <button class="btn" id="share-copy">copy text</button>
          ${navigator.share ? '<button class="btn" id="share-native">share…</button>' : ''}
        </div>
        <div class="share-intents">
          ${INTENTS.map((i) =>
            `<a class="intent" href="${i.build(text)}" target="_blank" rel="noopener">${i.name}</a>`).join('')}
        </div>
        <p class="share-note">The link carries the seed, so anyone who opens it
        gets the same map — same theme, same words, same order.</p>
        ${justFinished
          ? '<button class="btn btn-go share-again" id="share-again">another map</button>'
          : ''}
      </div>`;

    sharePreview = renderCard(poem, { scale: 2 });
    sharePreview.className = 'share-canvas';
    els.sharePanel.querySelector('#share-preview').appendChild(sharePreview);

    const q = (id) => els.sharePanel.querySelector(id);
    q('#share-close').addEventListener('click', () => handlers.onCloseShare());
    q('#share-png').addEventListener('click', () => handlers.onSavePng(poem, sharePreview));
    q('#share-copy-image').addEventListener('click',
      (e) => handlers.onCopyImage(sharePreview, e.currentTarget));
    q('#share-copy').addEventListener('click',
      (e) => handlers.onCopyText(text, e.currentTarget));
    q('#share-native')?.addEventListener('click',
      () => handlers.onNativeShare(poem, sharePreview));
    q('#share-again')?.addEventListener('click', () => handlers.onNewMap());
  }

  function renderHud() {
    const { form, belt, theme } = game;
    if (els.inkTotal) {
      const ink = String(game.ink);
      if (els.inkTotal.textContent !== ink) {
        els.inkTotal.textContent = ink;
        els.inkTotal.classList.remove('bumped');
        void els.inkTotal.offsetWidth;      // restart the animation
        els.inkTotal.classList.add('bumped');
      }
    }
    if (els.themeName) els.themeName.textContent = theme?.name ?? '';
    if (els.themeBlurb) els.themeBlurb.textContent = theme?.blurb ?? '';
    // With rhyme off the scheme is meaningless, so the badge goes away rather
    // than showing a row of dashes.
    if (els.formScheme) {
      const scheme = game.rhyme ? form.scheme : '';
      els.formScheme.textContent = scheme;
      els.formScheme.hidden = !scheme || scheme.startsWith('-');
    }
    if (els.rhymeToggle) els.rhymeToggle.checked = !!game.rhyme;
    els.beltSupply.textContent = `${belt.supply} left on the belt`;
  }

  function renderBonus() {
    if (!els.bonusTray) return;
    els.bonusTray.replaceChildren(...game.bonus.map((tile) => {
      const el = document.createElement('button');
      el.className = `bonus-word${tile.used ? ' used' : ''}`
        + (tile.stranger ? ' stranger' : '');
      el.dataset.vibe = tile.vibe;
      el.disabled = tile.used || game.over;
      el.innerHTML = `<span class="bonus-text"></span><span class="bonus-vibe"></span>`;
      el.querySelector('.bonus-text').textContent = tile.text;
      el.querySelector('.bonus-vibe').textContent = tile.vibeName;
      el.title = tile.used
        ? 'already spent'
        : `${tile.vibeName} · ${tile.syl} syl — one use`;
      el.addEventListener('click', () => handlers.onTakeBonus(tile.id));
      return el;
    }));
  }

  function renderBanner() {
    if (!game.over) { els.banner.hidden = true; return; }
    const s = game.score;
    const why = game.belt.drained ? 'the belt ran dry' : 'the poem is finished';
    els.banner.hidden = false;
    els.banner.innerHTML =
      `<div class="banner-inner">
         <p class="banner-why">${why}</p>
         <div class="banner-poem">${
           game.poem.lines
             .map((l) => escapeHtml(
               lineParts(l).map((p) => (p.kind === 'glue' ? p.text : p.tile.text)).join(' ')
             ) || '<em>—</em>')
             .join('<br>')
         }</div>
         <p class="banner-score">
           <span class="ink-earned">+${game.inkEarned ?? 0}</span> ink${s.complete ? ' · complete' : ''}
         </p>
         ${(game.unlocked || []).map((u) => `
           <p class="banner-unlock">
             <span class="unlock-tag">unlocked</span>
             <span class="unlock-name">${escapeHtml(u.name)}</span>
             <em>${escapeHtml(u.blurb)}</em>
           </p>`).join('')}
         <div class="banner-actions">
           <button class="btn btn-go" id="banner-share">share this poem</button>
           <button class="btn" id="banner-again">another map</button>
         </div>
       </div>`;
    els.banner.querySelector('#banner-again')
      .addEventListener('click', handlers.onNewMap);
    els.banner.querySelector('#banner-share')
      ?.addEventListener('click', () => handlers.onShareCurrent());
  }

  function sync() {
    game.rescore();
    renderPoem();
    renderGlueTray();
    renderBonus();
    renderHud();
    renderHeld();
    renderForesight();
    renderDredge();
    renderDraft();
    renderProgress();
    renderArchive();
    renderShare();
    renderAtlas();
    renderWildcard();
    renderTutorial();
    renderBanner();
  }

  return { frame, sync };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { SCHEME_LETTERS };
