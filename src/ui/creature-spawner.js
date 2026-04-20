// creature-spawner.js — DOM-based creature spawn panel UI.
//
// Creates a draggable overlay panel matching PlanetGen's dark terminal aesthetic.
// Calls creatureManager.spawnBatch() and .clearAll() directly.

import { MORPHOTYPE, SPAWN_PRESETS, SURFACE_TYPE } from '../creatures/CreatureParams.js';
import { BIOME_TAG } from '../creatures/BiomeRecipe.js';
import { MODEL_CREATURE_CATALOG } from '../creatures/ModelCreatureRigger.js';

const BIOMES = ['AUTO', ...Object.values(BIOME_TAG)];
const BEHAVIOURS = ['GRAZER', 'SPOOKED', 'STALKER', 'HUNTER', 'DRIFTER', 'SWARM'];
const SURFACES = Object.values(SURFACE_TYPE);

const STYLES = `
  #creature-spawner {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 240px;
    background: rgba(8, 15, 10, 0.92);
    border: 1px solid rgba(80, 200, 100, 0.35);
    border-radius: 10px;
    padding: 14px 16px 16px;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #7defa0;
    z-index: 999;
    user-select: none;
    backdrop-filter: blur(8px);
    box-shadow: 0 0 24px rgba(60, 180, 80, 0.18), 0 4px 32px rgba(0,0,0,0.6);
    transition: opacity 0.2s;
  }
  #creature-spawner.hidden { opacity: 0; pointer-events: none; }

  #creature-spawner h3 {
    margin: 0 0 10px;
    font-size: 12px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #a0ffb8;
    text-shadow: 0 0 8px rgba(80, 255, 120, 0.5);
    cursor: move;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  #creature-spawner .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 6px 0;
    gap: 6px;
  }

  #creature-spawner label {
    color: #55aa70;
    white-space: nowrap;
    flex-shrink: 0;
    width: 68px;
  }

  /* Toggle button group */
  #creature-spawner .btn-group {
    display: flex;
    gap: 3px;
    flex: 1;
  }
  #creature-spawner .btn-group button {
    flex: 1;
    background: rgba(60, 180, 80, 0.06);
    border: 1px solid rgba(80, 200, 100, 0.2);
    border-radius: 4px;
    color: #55aa70;
    font-family: 'Courier New', monospace;
    font-size: 9px;
    padding: 3px 2px;
    cursor: pointer;
    transition: all 0.15s;
    letter-spacing: 0.5px;
  }
  #creature-spawner .btn-group button.active {
    background: rgba(80, 220, 100, 0.22);
    border-color: rgba(80, 220, 100, 0.6);
    color: #a0ffb8;
    text-shadow: 0 0 6px rgba(120, 255, 140, 0.6);
  }
  #creature-spawner .btn-group button:hover:not(.active) {
    background: rgba(60, 180, 80, 0.14);
    color: #7defa0;
  }

  /* Select */
  #creature-spawner select {
    flex: 1;
    background: rgba(60, 180, 80, 0.08);
    border: 1px solid rgba(80, 200, 100, 0.25);
    border-radius: 4px;
    color: #7defa0;
    font-family: 'Courier New', monospace;
    font-size: 10px;
    padding: 3px 5px;
    cursor: pointer;
    outline: none;
  }
  #creature-spawner select option { background: #0a1a0d; }

  /* Range sliders */
  #creature-spawner input[type=range] {
    flex: 1;
    accent-color: #50c864;
    height: 4px;
    cursor: pointer;
  }
  #creature-spawner .val {
    color: #a0ffb8;
    width: 28px;
    text-align: right;
    flex-shrink: 0;
  }

  /* Text + seed controls */
  #creature-spawner .seed-row {
    display: flex;
    gap: 4px;
    flex: 1;
  }
  #creature-spawner input[type=number] {
    flex: 1;
    background: rgba(60, 180, 80, 0.08);
    border: 1px solid rgba(80, 200, 100, 0.25);
    border-radius: 4px;
    color: #a0ffb8;
    font-family: 'Courier New', monospace;
    font-size: 10px;
    padding: 3px 5px;
    outline: none;
    min-width: 0;
  }
  #creature-spawner input[type=number]::-webkit-inner-spin-button { opacity: 0; }

  /* Dice button */
  #creature-spawner .dice-btn {
    background: rgba(60, 180, 80, 0.1);
    border: 1px solid rgba(80, 200, 100, 0.25);
    border-radius: 4px;
    color: #7defa0;
    font-size: 13px;
    width: 26px;
    cursor: pointer;
    padding: 0;
    line-height: 26px;
    text-align: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  #creature-spawner .dice-btn:hover { background: rgba(60, 180, 80, 0.25); color: #a0ffb8; }

  /* Action buttons */
  #creature-spawner .actions {
    display: flex;
    gap: 6px;
    margin: 10px 0 8px;
  }
  #creature-spawner .actions button {
    flex: 1;
    padding: 6px 4px;
    border-radius: 5px;
    cursor: pointer;
    font-family: 'Courier New', monospace;
    font-size: 10px;
    font-weight: bold;
    letter-spacing: 0.5px;
    transition: all 0.15s;
    border: 1px solid;
  }
  #creature-spawner .spawn-btn {
    background: rgba(60, 200, 80, 0.15);
    border-color: rgba(60, 200, 80, 0.45);
    color: #a0ffb8;
  }
  #creature-spawner .spawn-btn:hover {
    background: rgba(60, 200, 80, 0.3);
    box-shadow: 0 0 10px rgba(60, 200, 80, 0.3);
  }
  #creature-spawner .clear-btn {
    background: rgba(200, 60, 60, 0.12);
    border-color: rgba(200, 60, 60, 0.35);
    color: #ff8888;
  }
  #creature-spawner .clear-btn:hover {
    background: rgba(200, 60, 60, 0.25);
    box-shadow: 0 0 8px rgba(200, 60, 60, 0.2);
  }

  /* Divider */
  #creature-spawner .divider {
    border: none;
    border-top: 1px solid rgba(80, 200, 100, 0.12);
    margin: 8px 0;
  }

  /* Presets label */
  #creature-spawner .presets-label {
    color: #3a7a50;
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 5px;
  }

  /* Preset buttons */
  #creature-spawner .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  #creature-spawner .preset-btn {
    background: rgba(60, 180, 80, 0.07);
    border: 1px solid rgba(80, 200, 100, 0.18);
    border-radius: 4px;
    color: #55aa70;
    font-family: 'Courier New', monospace;
    font-size: 9px;
    padding: 3px 7px;
    cursor: pointer;
    transition: all 0.15s;
    letter-spacing: 0.3px;
  }
  #creature-spawner .preset-btn:hover {
    background: rgba(60, 180, 80, 0.2);
    color: #a0ffb8;
    border-color: rgba(80, 200, 100, 0.4);
  }

  /* Count display */
  #creature-spawner .count-display {
    text-align: right;
    color: #3a7a50;
    font-size: 9px;
    margin-top: 6px;
  }
  #creature-spawner .count-display span { color: #7defa0; }

  /* Toggle button */
  #creature-spawner-toggle {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 38px;
    height: 38px;
    background: rgba(8, 15, 10, 0.88);
    border: 1px solid rgba(80, 200, 100, 0.35);
    border-radius: 8px;
    color: #7defa0;
    font-size: 18px;
    cursor: pointer;
    z-index: 1000;
    display: none;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(8px);
    transition: all 0.15s;
  }
  #creature-spawner-toggle:hover { background: rgba(60, 180, 80, 0.2); }
`;

/**
 * Inject CSS into the page.
 */
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);
}

/**
 * Create and mount the creature spawner panel.
 *
 * @param {import('../creatures/CreatureManager.js').CreatureManager} creatureManager
 * @param {() => THREE.Vector3} getPlayerPos  Returns current player world position
 */
export function createCreatureSpawnerUI(creatureManager, getPlayerPos) {
  injectStyles();

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedMorphotype = MORPHOTYPE.QUADRUPED;
  let selectedBehaviour  = 'GRAZER';
  let selectedSurface    = SURFACE_TYPE.SKIN;
  let selectedBiome      = 'AUTO';
  let count  = 12;
  let spread = 60;
  let seed   = Math.floor(Math.random() * 99999);

  // ── Panel HTML ─────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'creature-spawner';
  panel.innerHTML = `
    <h3 id="cs-title">🦎 CREATURES V3</h3>

    <div class="row">
      <label>Type</label>
      <div class="btn-group" id="cs-morpho">
        <button data-v="QUADRUPED" class="active">QUAD</button>
        <button data-v="BIPED">BIPED</button>
        <button data-v="NOPED">NOPED</button>
        <button data-v="RANDOM">RND</button>
      </div>
    </div>

    <div class="row">
      <label>Surface</label>
      <div class="btn-group" id="cs-surface">
        ${SURFACES.map(s => `<button data-v="${s}" ${s === selectedSurface ? 'class="active"' : ''}>${s.slice(0, 4)}</button>`).join('')}
      </div>
    </div>

    <div class="row">
      <label>Behaviour</label>
      <select id="cs-behaviour">
        ${BEHAVIOURS.map(b => `<option value="${b}">${b}</option>`).join('')}
        <option value="RANDOM">RANDOM</option>
      </select>
    </div>

    <div class="row">
      <label>Biome</label>
      <select id="cs-biome">
        ${BIOMES.map(b => `<option value="${b}">${b}</option>`).join('')}
      </select>
    </div>

    <div class="row">
      <label>Count</label>
      <input type="range" id="cs-count" min="1" max="50" value="${count}">
      <span class="val" id="cs-count-val">${count}</span>
    </div>

    <div class="row">
      <label>Spread m</label>
      <input type="range" id="cs-spread" min="10" max="200" value="${spread}">
      <span class="val" id="cs-spread-val">${spread}</span>
    </div>

    <div class="row">
      <label>Seed</label>
      <div class="seed-row">
        <input type="number" id="cs-seed" value="${seed}">
        <button class="dice-btn" id="cs-dice" title="Random seed">🎲</button>
      </div>
    </div>

    <div class="actions">
      <button class="spawn-btn" id="cs-spawn">SPAWN BATCH</button>
      <button class="clear-btn" id="cs-clear">CLEAR ALL</button>
    </div>

    <hr class="divider">

    <div class="presets-label">Quick presets</div>
    <div class="presets" id="cs-presets">
      ${Object.keys(SPAWN_PRESETS).map(k =>
        `<button class="preset-btn" data-preset="${k}">${k}</button>`
      ).join('')}
    </div>

    <hr class="divider">

    <div class="presets-label">Model creatures</div>
    <div class="presets" id="cs-models">
      ${Object.entries(MODEL_CREATURE_CATALOG).map(([key, cfg]) =>
        `<button class="preset-btn model-btn" data-model="${key}" title="${cfg.biomeTag}">${cfg.label}</button>`
      ).join('')}
    </div>

    <div class="count-display">Active: <span id="cs-active">0</span></div>
  `;
  document.body.appendChild(panel);

  // ── Element refs ───────────────────────────────────────────────────────────
  const morphoGroup   = panel.querySelector('#cs-morpho');
  const surfaceGroup  = panel.querySelector('#cs-surface');
  const behaviourSel  = panel.querySelector('#cs-behaviour');
  const countSlider   = panel.querySelector('#cs-count');
  const countVal      = panel.querySelector('#cs-count-val');
  const spreadSlider  = panel.querySelector('#cs-spread');
  const spreadVal     = panel.querySelector('#cs-spread-val');
  const seedInput     = panel.querySelector('#cs-seed');
  const diceBtn       = panel.querySelector('#cs-dice');
  const spawnBtn      = panel.querySelector('#cs-spawn');
  const clearBtn      = panel.querySelector('#cs-clear');
  const presetsDiv    = panel.querySelector('#cs-presets');
  const activeCount   = panel.querySelector('#cs-active');
  const biomeSel      = panel.querySelector('#cs-biome');

  // ── Morphotype toggle ──────────────────────────────────────────────────────
  morphoGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    morphoGroup.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMorphotype = btn.dataset.v;
  });

  // ── Surface toggle ─────────────────────────────────────────────────────────
  surfaceGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    surfaceGroup.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSurface = btn.dataset.v;
  });

  // ── Behaviour select ───────────────────────────────────────────────────────
  behaviourSel.addEventListener('change', () => {
    selectedBehaviour = behaviourSel.value;
  });

  // ── Biome select ───────────────────────────────────────────────────────────
  biomeSel.addEventListener('change', () => {
    selectedBiome = biomeSel.value;
  });

  // ── Sliders ────────────────────────────────────────────────────────────────
  countSlider.addEventListener('input', () => {
    count = parseInt(countSlider.value);
    countVal.textContent = count;
  });
  spreadSlider.addEventListener('input', () => {
    spread = parseInt(spreadSlider.value);
    spreadVal.textContent = spread;
  });

  // ── Seed ───────────────────────────────────────────────────────────────────
  seedInput.addEventListener('input', () => {
    seed = parseInt(seedInput.value) || 0;
  });
  diceBtn.addEventListener('click', () => {
    seed = Math.floor(Math.random() * 99999);
    seedInput.value = seed;
  });

  // ── Spawn ──────────────────────────────────────────────────────────────────
  spawnBtn.addEventListener('click', () => {
    const origin = getPlayerPos();
    creatureManager.spawnBatch({
      morphotype:      selectedMorphotype,
      behaviourPreset: selectedBehaviour,
      surfaceType:     selectedSurface,
      biome:           selectedBiome,
      count,
      spread,
      seed,
      origin,
    });
    updateCount();
  });

  // ── Clear ──────────────────────────────────────────────────────────────────
  clearBtn.addEventListener('click', () => {
    creatureManager.clearAll();
    updateCount();
  });

  // ── Presets ────────────────────────────────────────────────────────────────
  presetsDiv.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-btn');
    if (!btn) return;
    const presetKey = btn.dataset.preset;
    const preset    = SPAWN_PRESETS[presetKey];
    if (!preset) return;

    // Update UI to match preset
    const mtype = preset.morphotype === 'RANDOM' ? 'RANDOM' : preset.morphotype;
    morphoGroup.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.v === mtype);
    });
    selectedMorphotype = mtype;

    const btype = preset.behaviourPreset;
    behaviourSel.value = btype;
    selectedBehaviour  = btype;

    if (preset.surfaceType) {
      selectedSurface = preset.surfaceType;
      surfaceGroup.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.v === selectedSurface);
      });
    }

    countSlider.value = preset.count;
    count = preset.count;
    countVal.textContent = count;

    spreadSlider.value = preset.spread;
    spread = preset.spread;
    spreadVal.textContent = spread;

    if (preset.tags && preset.tags.length > 0) {
      selectedBiome = preset.tags[0];
      if (selectedBiome === 'ANY') selectedBiome = 'AUTO';
      biomeSel.value = selectedBiome;
    }

    // Spawn immediately with preset
    const origin = getPlayerPos();
    creatureManager.spawnBatch({
      morphotype:      selectedMorphotype,
      behaviourPreset: selectedBehaviour,
      surfaceType:     selectedSurface,
      biome:           selectedBiome,
      count,
      spread,
      seed,
      origin,
    });
    updateCount();
  });

  // ── Model creature buttons ─────────────────────────────────────────────────
  panel.querySelector('#cs-models').addEventListener('click', (e) => {
    const btn = e.target.closest('.model-btn');
    if (!btn) return;
    const modelName = btn.dataset.model;
    const origin = getPlayerPos();
    creatureManager.spawnModelBatch({ modelName, count: Math.min(count, 6), spread, seed, origin });
    updateCount();
  });

  // ── Draggable header ───────────────────────────────────────────────────────
  makeDraggable(panel, panel.querySelector('#cs-title'));

  // ── Count updater ──────────────────────────────────────────────────────────
  function updateCount() {
    activeCount.textContent = creatureManager.count;
  }

  // Update count display every second
  setInterval(updateCount, 1000);

  return panel;
}

/** Make an element draggable by a handle. */
function makeDraggable(el, handle) {
  let ox = 0, oy = 0, sx = 0, sy = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    ox = e.clientX;
    oy = e.clientY;
    const rect = el.getBoundingClientRect();
    sx = rect.left;
    sy = rect.top;

    const onMove = (me) => {
      const dx = me.clientX - ox;
      const dy = me.clientY - oy;
      el.style.left   = (sx + dx) + 'px';
      el.style.top    = (sy + dy) + 'px';
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}
