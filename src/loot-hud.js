// LootHUD — collapsable inventory panel.
//
// COLLAPSED (default)
//   Compact strip in the top-right corner: coloured icons + counts for all
//   non-zero resource types, plus a "[I] Inventory" toggle hint.
//
// EXPANDED (I key or controller A button → toggle())
//   Full panel slides open below the strip with three labelled grid sections:
//   RESOURCES · GEAR · SPORTS
//   Each slot shows an icon, label, and count. Zero-count slots are dimmed.
//
// The panel imports ITEM_DEFS from loot-manager.js to keep all item metadata
// in one place.

import { ITEM_DEFS } from './loot-manager.js';

// ── Layout: ordered slots per category ─────────────────────────────────────

const CATEGORIES = [
  { label: 'RESOURCES', keys: ['iron', 'crystal', 'gold', 'gem'],     cols: 4 },
  { label: 'GEAR',      keys: ['capture', 'weapon', 'spray'],         cols: 3 },
  { label: 'SPORTS',    keys: ['ball', 'frisbee', 'racket'],          cols: 3 },
];

// ── Styles (all inline — no external stylesheet needed) ─────────────────────

const BASE = [
  'position:fixed',
  'top:16px',
  'right:16px',
  'font-family:monospace',
  'color:#fff',
  'z-index:1000',
  'pointer-events:none',
  'user-select:none',
].join(';');

const STRIP_STYLE = [
  'background:rgba(0,0,0,0.60)',
  'border:1px solid rgba(255,255,255,0.12)',
  'border-radius:6px 6px 0 0',
  'padding:7px 12px',
  'display:flex',
  'align-items:center',
  'gap:10px',
  'font-size:12px',
  'cursor:pointer',
  'pointer-events:auto',
].join(';');

const PANEL_STYLE = [
  'background:rgba(0,0,0,0.75)',
  'border:1px solid rgba(255,255,255,0.12)',
  'border-top:none',
  'border-radius:0 0 6px 6px',
  'overflow:hidden',
  'max-height:0px',
  'transition:max-height 0.28s cubic-bezier(0.4,0,0.2,1)',
  'width:312px',
].join(';');

// Full expanded height — large enough for all content, animation clips to it
const EXPANDED_HEIGHT = '520px';

const SECTION_LABEL_STYLE = [
  'color:#555',
  'font-size:10px',
  'letter-spacing:1.5px',
  'margin:10px 12px 4px',
].join(';');

function slotStyle(def, count) {
  const dim = count === 0;
  return [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:2px',
    'background:rgba(255,255,255,0.04)',
    'border:1px solid rgba(255,255,255,0.07)',
    'border-radius:5px',
    'padding:6px 4px',
    `opacity:${dim ? '0.30' : '1'}`,
    'transition:opacity 0.2s',
  ].join(';');
}

// ── LootHUD ─────────────────────────────────────────────────────────────────

export class LootHUD {
  constructor(lootManager) {
    this._lm       = lootManager;
    this._expanded = false;

    // Root wrapper
    this._root = document.createElement('div');
    this._root.style.cssText = BASE;

    // Compact resource strip (always visible)
    this._strip = document.createElement('div');
    this._strip.style.cssText = STRIP_STYLE;
    this._strip.title = 'Inventory (I)';
    this._strip.addEventListener('click', () => this.toggle());
    this._root.appendChild(this._strip);

    // Expandable panel body
    this._panel = document.createElement('div');
    this._panel.style.cssText = PANEL_STYLE;
    this._panel.innerHTML = this._buildPanelHTML(lootManager.inventory);
    this._root.appendChild(this._panel);

    document.body.appendChild(this._root);

    // Keyboard toggle
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyI' && !e.repeat) this.toggle();
    });

    // Wire inventory updates
    lootManager.onInventoryChange = (_type, inv) => this._refresh(inv);

    this._renderStrip(lootManager.inventory);
  }

  // ── Public ──────────────────────────────────────────────────────────────────

  toggle() {
    this._expanded = !this._expanded;
    this._panel.style.maxHeight = this._expanded ? EXPANDED_HEIGHT : '0px';
    // Rebuild panel contents fresh each open so counts are always current
    if (this._expanded) {
      this._panel.innerHTML = this._buildPanelHTML(this._lm.inventory);
    }
    this._renderStrip(this._lm.inventory);
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  _refresh(inv) {
    this._renderStrip(inv);
    if (this._expanded) {
      this._panel.innerHTML = this._buildPanelHTML(inv);
    }
  }

  _renderStrip(inv) {
    // Show all resource types that are non-zero, or at least two placeholders
    // so the strip never feels empty.
    const resourceKeys = CATEGORIES[0].keys;
    const chips = resourceKeys
      .map(k => {
        const def = ITEM_DEFS[k];
        const n   = inv[k] ?? 0;
        const col = n > 0 ? def.color : '#444';
        return `<span style="color:${col}">${def.icon}<span style="color:#ccc;margin-left:2px">${n}</span></span>`;
      })
      .join('');

    const hint = `<span style="color:#444;margin-left:4px;font-size:10px">[I]</span>`;
    const label = `<span style="color:#666;font-size:10px;letter-spacing:1px">INV</span>`;
    this._strip.innerHTML = `${label}${chips}${hint}`;
  }

  _buildPanelHTML(inv) {
    return CATEGORIES.map(cat => this._buildSection(cat, inv)).join('');
  }

  _buildSection({ label, keys, cols }, inv) {
    const gap         = 6;
    const panelInner  = 312;                       // panel width
    const slotW       = Math.floor((panelInner - 24 - gap * (cols - 1)) / cols);

    const grid = [
      `<div style="display:grid;grid-template-columns:repeat(${cols},${slotW}px);gap:${gap}px;padding:0 12px 10px">`,
      ...keys.map(k => this._buildSlot(k, inv[k] ?? 0)),
      '</div>',
    ].join('');

    return [
      `<div style="${SECTION_LABEL_STYLE}">${label}</div>`,
      grid,
    ].join('');
  }

  _buildSlot(key, count) {
    const def   = ITEM_DEFS[key];
    const style = slotStyle(def, count);
    return [
      `<div style="${style}">`,
      `  <span style="font-size:20px;line-height:1;color:${def.color}">${def.icon}</span>`,
      `  <span style="font-size:9px;color:#888;letter-spacing:0.5px;text-transform:uppercase">${def.label}</span>`,
      `  <span style="font-size:14px;font-weight:bold;color:${count > 0 ? '#fff' : '#444'}">${count}</span>`,
      `</div>`,
    ].join('');
  }

  destroy() {
    this._root.remove();
  }
}
