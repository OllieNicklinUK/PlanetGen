/**
 * LevelBuilderSystem
 *
 * Inspired by the split plan-view / 3D-view layout of homeidea3d.sbcode.net.
 * Runs in VisibilityState.NonImmersive (browser).  When the user clicks
 * "▶ Enter World" all placed floor/wall entities receive LocomotionEnvironment
 * so the existing locomotion system works immediately in XR.
 *
 * Activate via URL: ?mode=builder
 */

import {
  createSystem,
  VisibilityState,
  LocomotionEnvironment,
  AmbientLight,
  DirectionalLight,
  BoxGeometry,
  CylinderGeometry,
  SphereGeometry,
  ConeGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  Mesh,
  Vector3,
} from '@iwsdk/core';
import type { Signal } from '@preact/signals-core';
import { PlacedObject } from './components/placed-object.js';
import { EditorCameraSystem } from './editor-camera-system.js';

// ─── Asset catalogue ──────────────────────────────────────────────────────────

interface AssetDef {
  label:        string;
  category:     'floor' | 'wall' | 'prop';
  planW:        number;   // footprint width  (metres)
  planD:        number;   // footprint depth  (metres)
  yOffset:      number;   // mesh centre above Y = 0
  hexColor:     number;   // display colour
  createMesh(): Mesh;
}

const ASSETS: Record<string, AssetDef> = {
  'floor-1x1':  { label: '1×1 Floor',  category: 'floor', planW: 1, planD: 1, yOffset: 0.05,  hexColor: 0x7a6040,
    createMesh: () => new Mesh(new BoxGeometry(1, 0.1, 1),   new MeshStandardMaterial({ color: 0x7a6040, roughness: 0.9 })) },
  'floor-2x2':  { label: '2×2 Floor',  category: 'floor', planW: 2, planD: 2, yOffset: 0.05,  hexColor: 0x7a6040,
    createMesh: () => new Mesh(new BoxGeometry(2, 0.1, 2),   new MeshStandardMaterial({ color: 0x7a6040, roughness: 0.9 })) },
  'floor-4x4':  { label: '4×4 Floor',  category: 'floor', planW: 4, planD: 4, yOffset: 0.05,  hexColor: 0x7a6040,
    createMesh: () => new Mesh(new BoxGeometry(4, 0.1, 4),   new MeshStandardMaterial({ color: 0x7a6040, roughness: 0.9 })) },
  'floor-plat': { label: 'Platform',   category: 'floor', planW: 2, planD: 2, yOffset: 0.15,  hexColor: 0x557755,
    createMesh: () => new Mesh(new BoxGeometry(2, 0.3, 2),   new MeshStandardMaterial({ color: 0x557755, roughness: 0.8 })) },
  'wall-1m':    { label: 'Wall 1 m',   category: 'wall',  planW: 1, planD: 0.2, yOffset: 1.5, hexColor: 0xb09878,
    createMesh: () => new Mesh(new BoxGeometry(1, 3, 0.2),   new MeshStandardMaterial({ color: 0xb09878, roughness: 0.8 })) },
  'wall-2m':    { label: 'Wall 2 m',   category: 'wall',  planW: 2, planD: 0.2, yOffset: 1.5, hexColor: 0xb09878,
    createMesh: () => new Mesh(new BoxGeometry(2, 3, 0.2),   new MeshStandardMaterial({ color: 0xb09878, roughness: 0.8 })) },
  'wall-4m':    { label: 'Wall 4 m',   category: 'wall',  planW: 4, planD: 0.2, yOffset: 1.5, hexColor: 0xb09878,
    createMesh: () => new Mesh(new BoxGeometry(4, 3, 0.2),   new MeshStandardMaterial({ color: 0xb09878, roughness: 0.8 })) },
  'wall-corner':{ label: 'Corner',     category: 'wall',  planW: 0.3, planD: 0.3, yOffset: 1.5, hexColor: 0xa08868,
    createMesh: () => new Mesh(new BoxGeometry(0.3, 3, 0.3), new MeshStandardMaterial({ color: 0xa08868, roughness: 0.8 })) },
  'pillar':     { label: 'Pillar',     category: 'wall',  planW: 0.35, planD: 0.35, yOffset: 1.5, hexColor: 0x9898a8,
    createMesh: () => new Mesh(new CylinderGeometry(0.15, 0.18, 3, 10), new MeshStandardMaterial({ color: 0x9898a8 })) },
  'crate':      { label: 'Crate',      category: 'prop',  planW: 0.6, planD: 0.6, yOffset: 0.3, hexColor: 0x8b6914,
    createMesh: () => new Mesh(new BoxGeometry(0.6, 0.6, 0.6), new MeshStandardMaterial({ color: 0x8b6914, roughness: 0.7 })) },
  'ball':       { label: 'Ball',       category: 'prop',  planW: 0.5, planD: 0.5, yOffset: 0.25, hexColor: 0xcc4444,
    createMesh: () => new Mesh(new SphereGeometry(0.25, 10, 10), new MeshStandardMaterial({ color: 0xcc4444 })) },
  'cone':       { label: 'Marker',     category: 'prop',  planW: 0.4, planD: 0.4, yOffset: 0.3, hexColor: 0xdd8820,
    createMesh: () => new Mesh(new ConeGeometry(0.2, 0.6, 8),   new MeshStandardMaterial({ color: 0xdd8820 })) },
  'tall-box':   { label: 'Tall Block', category: 'prop',  planW: 0.5, planD: 0.5, yOffset: 1.0, hexColor: 0x4466aa,
    createMesh: () => new Mesh(new BoxGeometry(0.5, 2, 0.5),    new MeshStandardMaterial({ color: 0x4466aa })) },
};

// ─── Plan-view constants ──────────────────────────────────────────────────────

const GRID_SNAP  = 1;     // metres
const PX_PER_M   = 22;    // default zoom

// ─── Serialisable record ──────────────────────────────────────────────────────

interface ObjRecord {
  modelKey: string;
  gridX:    number;
  gridZ:    number;
  rotY:     number;
}

// ─── System ──────────────────────────────────────────────────────────────────

export class LevelBuilderSystem extends createSystem(
  { placed: { required: [PlacedObject] } },
  {},
) {
  // activation
  private _active = false;

  // DOM
  private _ui:       HTMLDivElement | null       = null;
  private _planEl:   HTMLCanvasElement | null    = null;
  private _planCtx:  CanvasRenderingContext2D | null = null;
  private _statusEl: HTMLElement | null          = null;
  private _coordEl:  HTMLElement | null          = null;
  private _propsEl:  HTMLElement | null          = null;
  private _colorEl:  HTMLInputElement | null     = null;
  private _assetGrid:HTMLElement | null          = null;

  // builder state
  private _selectedAsset  = 'floor-1x1';
  private _selectedEntity: ReturnType<typeof this.world.createTransformEntity> | null = null;
  private _activeCat: 'floor' | 'wall' | 'prop' = 'floor';
  private _activeView: 'plan' | '3d' = 'plan';
  private _activeTool: 'select' | 'place' = 'place';
  private _planDirty = true;

  // plan-view camera
  private _pzoom   = PX_PER_M;
  private _pox     = 0;     // pan offset X (pixels)
  private _poy     = 0;     // pan offset Y (pixels)
  private _panning = false;
  private _panSX   = 0;
  private _panSY   = 0;
  private _panBX   = 0;
  private _panBY   = 0;

  // ghost state (plan view cursor)
  private _ghostGX = 0;
  private _ghostGZ = 0;
  private _ghostOn = false;
  private _ghostMesh: Mesh | null = null;

  // undo / redo
  private _undo: ObjRecord[][] = [];
  private _redo: ObjRecord[][] = [];

  // scene helpers (added directly to Three.js scene, cleaned up on deactivate)
  private _sceneObjs: object[] = [];

  // ─── lifecycle ───────────────────────────────────────────────────────────────

  init() {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (!this._active) return;
        if (state === VisibilityState.NonImmersive) this._showUI();
        else                                         this._hideUI();
      }),
    );
  }

  /** Called from index.js once the builder URL param is confirmed. */
  activate() {
    this._active = true;
    this._addEditorScene();
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      this._createUI();
      this._loadFromStorage();
    }
  }

  deactivate() {
    this._active = false;
    this._destroyUI();
    this._removeEditorScene();
  }

  update() {
    if (!this._active) return;
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) return;
    if (this._planDirty && this._activeView === 'plan') {
      this._drawPlan();
      this._planDirty = false;
    }
    if (this._ghostMesh) {
      this._ghostMesh.visible = this._ghostOn && this._activeView === '3d';
    }
  }

  // ─── Scene setup ─────────────────────────────────────────────────────────────

  private _addEditorScene() {
    const ambient = new AmbientLight(0xffffff, 0.7);
    const sun     = new DirectionalLight(0xffeedd, 1.4);
    sun.position.set(8, 16, 6);
    sun.castShadow = true;
    this.scene.add(ambient, sun);
    this._sceneObjs.push(ambient, sun);
  }

  private _removeEditorScene() {
    for (const o of this._sceneObjs) this.scene.remove(o as unknown as import('three').Object3D);
    this._sceneObjs = [];
    if (this._ghostMesh) {
      this.scene.remove(this._ghostMesh);
      this._ghostMesh.geometry.dispose();
      (this._ghostMesh.material as MeshBasicMaterial).dispose();
      this._ghostMesh = null;
    }
  }

  // ─── UI creation ─────────────────────────────────────────────────────────────

  private _createUI() {
    if (this._ui) return;

    const style = document.createElement('style');
    style.textContent = this._css();
    document.head.appendChild(style);
    this.cleanupFuncs.push(() => style.remove());

    const div = document.createElement('div');
    div.id = 'lb';
    div.innerHTML = this._html();
    document.body.appendChild(div);
    this._ui = div;

    this._planEl   = div.querySelector<HTMLCanvasElement>('#lb-plan')!;
    this._planCtx  = this._planEl.getContext('2d')!;
    this._statusEl = div.querySelector('#lb-status-msg')!;
    this._coordEl  = div.querySelector('#lb-coord')!;
    this._propsEl  = div.querySelector('#lb-props')!;
    this._colorEl  = div.querySelector<HTMLInputElement>('#lb-obj-color')!;
    this._assetGrid = div.querySelector('#lb-assets')!;

    this._resizePlan();
    const onResize = () => this._resizePlan();
    window.addEventListener('resize', onResize);
    this.cleanupFuncs.push(() => window.removeEventListener('resize', onResize));

    // centre plan view on origin
    this._pox = (this._planEl.width / (window.devicePixelRatio || 1)) / 2;
    this._poy = (this._planEl.height / (window.devicePixelRatio || 1)) / 2;

    this._wireEvents();
    this._renderAssets('floor');
    this._planDirty = true;
  }

  private _destroyUI() {
    this._ui?.remove();
    this._ui = null;
  }

  private _showUI() {
    if (!this._ui) this._createUI();
    else (this._ui.style.display = 'flex');
    (this.globals.builderActive as Signal<boolean>).value = true;
    this._setView(this._activeView);
    this._planDirty = true;
  }

  private _hideUI() {
    if (this._ui) this._ui.style.display = 'none';
    (this.globals.builderActive as Signal<boolean>).value = false;
  }

  // ─── HTML / CSS ───────────────────────────────────────────────────────────────

  private _html(): string {
    return `
<div id="lb-toolbar">
  <span class="lb-brand">⬡ Level Builder</span>
  <div class="lb-sep"></div>
  <button class="lb-tool lb-tool-active" id="lb-t-place" title="Place tool (P)">＋ Place</button>
  <button class="lb-tool" id="lb-t-select" title="Select tool (S)">↖ Select</button>
  <div class="lb-sep"></div>
  <button id="lb-undo" title="Undo (Ctrl+Z)">↩</button>
  <button id="lb-redo" title="Redo (Ctrl+Y)">↪</button>
  <button id="lb-clear" title="Clear all">⊗</button>
  <div class="lb-sep"></div>
  <button id="lb-save" title="Save to browser storage">💾 Save</button>
  <button id="lb-load" title="Load from browser storage">📂 Load</button>
  <div class="lb-flex"></div>
  <button class="lb-view-btn lb-view-active" id="lb-v-plan" title="Plan view">📐 Plan</button>
  <button class="lb-view-btn" id="lb-v-3d" title="3D view">⬛ 3D</button>
  <div class="lb-sep"></div>
  <button id="lb-enter" class="lb-enter-btn">▶ Enter World</button>
</div>
<div id="lb-main">
  <div id="lb-sidebar">
    <div id="lb-cats">
      <button class="lb-cat lb-cat-active" data-cat="floor">Floor</button>
      <button class="lb-cat" data-cat="wall">Wall</button>
      <button class="lb-cat" data-cat="prop">Prop</button>
    </div>
    <div id="lb-assets"></div>
    <div id="lb-props">
      <div class="lb-prop-title">Properties</div>
      <div class="lb-prop-row">
        <span>Rotation</span>
        <div id="lb-rot-btns">
          <button data-rot="0">0°</button>
          <button data-rot="1.5708">90°</button>
          <button data-rot="3.1416">180°</button>
          <button data-rot="4.7124">270°</button>
        </div>
      </div>
      <div class="lb-prop-row">
        <span>Color</span>
        <input type="color" id="lb-obj-color" value="#b09878">
      </div>
      <button id="lb-delete" class="lb-delete-btn">🗑 Delete</button>
    </div>
  </div>
  <div id="lb-viewport">
    <canvas id="lb-plan"></canvas>
    <div id="lb-vp-hud">
      <button id="lb-recenter">⊕</button>
      <span id="lb-coord"></span>
    </div>
  </div>
</div>
<div id="lb-statusbar">
  <span id="lb-status-msg">Select an asset from the palette and click the grid to place it.</span>
</div>`;
  }

  private _css(): string {
    return `
/* ── Level Builder overlay ─────────────────────────────── */
#lb {
  position:fixed; inset:0; display:flex; flex-direction:column;
  font-family:'Segoe UI',Arial,sans-serif; font-size:13px;
  color:#c8d8e8; z-index:1000; pointer-events:none;
  background:transparent;
}
/* toolbar */
#lb-toolbar {
  pointer-events:all; flex-shrink:0; height:46px;
  background:#0d1b2a; border-bottom:1px solid #1e3a5f;
  display:flex; align-items:center; padding:0 10px; gap:5px;
}
.lb-brand { font-weight:600; font-size:14px; color:#7ab8e8; margin-right:4px; }
.lb-sep   { width:1px; height:24px; background:#1e3a5f; margin:0 2px; }
.lb-flex  { flex:1; }
#lb-toolbar button {
  background:#152230; border:1px solid #2a4a6a; color:#a8c8e0;
  border-radius:4px; padding:4px 10px; cursor:pointer; font-size:12px;
}
#lb-toolbar button:hover { background:#1e3a5f; }
.lb-tool-active { background:#1e3a5f !important; color:#ffffff !important; border-color:#4080c0 !important; }
.lb-view-active { background:#1e3a5f !important; color:#ffffff !important; }
.lb-enter-btn   { background:#0e5a28 !important; color:#88ffaa !important;
                  border-color:#1a9a44 !important; font-weight:600; padding:4px 14px !important; }
.lb-enter-btn:hover { background:#1a7a38 !important; }
/* main area */
#lb-main {
  flex:1; display:flex; overflow:hidden; pointer-events:none;
}
/* sidebar */
#lb-sidebar {
  pointer-events:all; width:180px; background:#0f1a27;
  border-right:1px solid #1e3a5f; display:flex; flex-direction:column;
  flex-shrink:0; overflow-y:auto;
}
/* category tabs */
#lb-cats { display:flex; }
.lb-cat {
  flex:1; background:#0d1b2a; border:none; border-bottom:2px solid transparent;
  color:#7090a8; padding:8px 4px; cursor:pointer; font-size:12px;
}
.lb-cat:hover  { color:#c8d8e8; }
.lb-cat-active { color:#a8d8ff; border-bottom-color:#4080c0; background:#111f2e; }
/* asset grid */
#lb-assets {
  flex:1; display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:6px;
}
.lb-asset {
  background:#152230; border:1px solid #1e3a5f; border-radius:4px;
  padding:8px 4px; cursor:pointer; text-align:center; font-size:11px;
  color:#a0b8c8; display:flex; flex-direction:column; align-items:center; gap:3px;
}
.lb-asset:hover     { background:#1e3a5f; color:#c8e8ff; }
.lb-asset-active    { border-color:#4080c0 !important; background:#1a3050 !important; color:#ffffff !important; }
.lb-asset-icon      { font-size:20px; }
/* properties panel */
#lb-props {
  border-top:1px solid #1e3a5f; padding:8px; display:none; flex-direction:column; gap:6px;
}
#lb-props.lb-visible { display:flex; }
.lb-prop-title { font-size:11px; color:#6080a0; text-transform:uppercase; letter-spacing:0.05em; }
.lb-prop-row   { display:flex; flex-direction:column; gap:3px; font-size:11px; color:#8098b0; }
#lb-rot-btns   { display:flex; gap:2px; }
#lb-rot-btns button {
  flex:1; background:#152230; border:1px solid #1e3a5f; color:#a0b8c8;
  border-radius:3px; padding:2px 0; cursor:pointer; font-size:10px;
}
#lb-rot-btns button:hover   { background:#1e3a5f; }
#lb-rot-btns button.lb-rot-active { background:#1e3a5f; color:#fff; border-color:#4080c0; }
#lb-obj-color { width:100%; height:24px; border:1px solid #1e3a5f; border-radius:3px; cursor:pointer; background:none; }
.lb-delete-btn {
  background:#3a1010 !important; border:1px solid #6a2020 !important;
  color:#ff8888 !important; border-radius:4px; padding:4px 8px;
  cursor:pointer; font-size:12px; width:100%;
}
.lb-delete-btn:hover { background:#5a1818 !important; }
/* viewport */
#lb-viewport { flex:1; position:relative; pointer-events:none; }
#lb-plan {
  position:absolute; inset:0; width:100%; height:100%;
  display:block; pointer-events:all; cursor:crosshair;
}
#lb-plan.lb-3d-mode { pointer-events:none; display:none; }
#lb-viewport.lb-3d-active { pointer-events:all; }
#lb-vp-hud {
  pointer-events:all; position:absolute; top:8px; right:10px;
  display:flex; align-items:center; gap:8px;
}
#lb-recenter {
  background:#0d1b2acc; border:1px solid #1e3a5f; color:#7ab8e8;
  border-radius:4px; padding:3px 8px; cursor:pointer; font-size:13px;
}
#lb-recenter:hover { background:#1e3a5fcc; }
#lb-coord { font-size:11px; color:#406080; }
/* status bar */
#lb-statusbar {
  pointer-events:none; flex-shrink:0; height:22px;
  background:#0d1b2a; border-top:1px solid #1e3a5f;
  display:flex; align-items:center; padding:0 10px; color:#4a7090;
}
/* ── scrollbar ──────────────────────────────────────────── */
#lb-sidebar::-webkit-scrollbar       { width:4px; }
#lb-sidebar::-webkit-scrollbar-track { background:#0d1b2a; }
#lb-sidebar::-webkit-scrollbar-thumb { background:#1e3a5f; border-radius:2px; }
`;
  }

  // ─── Event wiring ────────────────────────────────────────────────────────────

  private _wireEvents() {
    const q = <T extends HTMLElement>(sel: string) =>
      this._ui!.querySelector<T>(sel)!;

    // Tools
    q('#lb-t-place').addEventListener('click', () => this._setTool('place'));
    q('#lb-t-select').addEventListener('click', () => this._setTool('select'));

    // Views
    q('#lb-v-plan').addEventListener('click', () => this._setView('plan'));
    q('#lb-v-3d').addEventListener('click', () => this._setView('3d'));

    // Edit buttons
    q('#lb-undo').addEventListener('click', () => this._doUndo());
    q('#lb-redo').addEventListener('click', () => this._doRedo());
    q('#lb-clear').addEventListener('click', () => {
      if (confirm('Clear all placed objects?')) this._clearAll();
    });

    // Save / load
    q('#lb-save').addEventListener('click', () => { this._saveToStorage(); this._status('Level saved.'); });
    q('#lb-load').addEventListener('click', () => { this._loadFromStorage(); this._status('Level loaded.'); });

    // Enter world
    q('#lb-enter').addEventListener('click', () => this._enterExploreMode());

    // Recenter
    q('#lb-recenter').addEventListener('click', () => this._recenterPlan());

    // Category tabs
    this._ui!.querySelectorAll<HTMLElement>('.lb-cat').forEach(btn =>
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat as 'floor' | 'wall' | 'prop';
        this._ui!.querySelectorAll('.lb-cat').forEach(b => b.classList.remove('lb-cat-active'));
        btn.classList.add('lb-cat-active');
        this._renderAssets(cat);
      }),
    );

    // Properties panel
    this._colorEl!.addEventListener('input', () => {
      if (!this._selectedEntity) return;
      const m = (this._selectedEntity.object3D as Mesh).material as MeshStandardMaterial;
      if (m?.color) m.color.setStyle(this._colorEl!.value);
      this._planDirty = true;
    });
    this._ui!.querySelectorAll<HTMLElement>('[data-rot]').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!this._selectedEntity) return;
        const rot = parseFloat(btn.dataset.rot!);
        this._selectedEntity.object3D.rotation.y = rot;
        this._selectedEntity.setValue(PlacedObject, 'rotY', rot);
        this._ui!.querySelectorAll('[data-rot]').forEach(b => b.classList.remove('lb-rot-active'));
        btn.classList.add('lb-rot-active');
        this._planDirty = true;
      }),
    );
    q('#lb-delete').addEventListener('click', () => {
      if (!this._selectedEntity) return;
      this._removeObject(this._selectedEntity);
      this._selectedEntity = null;
      this._showProps(false);
    });

    // Keyboard
    const onKey = (e: KeyboardEvent) => {
      if (!this._active) return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this._selectedEntity) {
          this._removeObject(this._selectedEntity);
          this._selectedEntity = null;
          this._showProps(false);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this._doUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault(); this._doRedo();
      }
      if (e.key === 'p' || e.key === 'P') this._setTool('place');
      if (e.key === 's' || e.key === 'S') this._setTool('select');
    };
    document.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => document.removeEventListener('keydown', onKey));

    // Plan canvas
    this._wirePlanCanvas();
  }

  private _wirePlanCanvas() {
    const el = this._planEl!;
    let moved = false;

    const onDown = (e: MouseEvent) => {
      moved = false;
      if (e.button === 1 || e.button === 2) {
        this._panning = true;
        this._panSX   = e.clientX; this._panSY = e.clientY;
        this._panBX   = this._pox; this._panBY = this._poy;
      }
    };
    const onMove = (e: MouseEvent) => {
      moved = true;
      if (this._panning) {
        this._pox = this._panBX + (e.clientX - this._panSX);
        this._poy = this._panBY + (e.clientY - this._panSY);
        this._planDirty = true;
        return;
      }
      const [wx, wz] = this._c2w(e.offsetX, e.offsetY);
      this._ghostGX = this._snap(wx);
      this._ghostGZ = this._snap(wz);
      this._ghostOn = this._activeTool === 'place';
      this._updateGhostMesh();
      if (this._coordEl) this._coordEl.textContent = `x:${this._ghostGX}  z:${this._ghostGZ}`;
      this._planDirty = true;
    };
    const onUp = (e: MouseEvent) => {
      if (this._panning) { this._panning = false; return; }
      if (moved) return;
      const [wx, wz] = this._c2w(e.offsetX, e.offsetY);
      const gx = this._snap(wx);
      const gz = this._snap(wz);
      if (this._activeTool === 'place') {
        this._placeObject(gx, gz);
      } else {
        this._selectEntity(this._hitTest(gx, gz));
      }
    };
    const onLeave = () => {
      this._ghostOn = false;
      this._panning = false;
      this._planDirty = true;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const [wx, wz] = this._c2w(e.offsetX, e.offsetY);
      this._pzoom = Math.max(4, Math.min(100, this._pzoom * factor));
      const [nx, nz] = this._w2c(wx, wz);
      this._pox += e.offsetX - nx;
      this._poy += e.offsetY - nz;
      this._planDirty = true;
    };
    const onCtx = (e: Event) => e.preventDefault();

    el.addEventListener('mousedown',   onDown);
    el.addEventListener('mousemove',   onMove);
    el.addEventListener('mouseup',     onUp);
    el.addEventListener('mouseleave',  onLeave);
    el.addEventListener('wheel',       onWheel, { passive: false });
    el.addEventListener('contextmenu', onCtx);

    this.cleanupFuncs.push(() => {
      el.removeEventListener('mousedown',   onDown);
      el.removeEventListener('mousemove',   onMove);
      el.removeEventListener('mouseup',     onUp);
      el.removeEventListener('mouseleave',  onLeave);
      el.removeEventListener('wheel',       onWheel);
      el.removeEventListener('contextmenu', onCtx);
    });
  }

  // ─── Asset palette ────────────────────────────────────────────────────────────

  private _renderAssets(cat: 'floor' | 'wall' | 'prop') {
    this._activeCat = cat;
    if (!this._assetGrid) return;
    this._assetGrid.innerHTML = '';
    const icons: Record<string, string> = {
      floor: '▬', wall: '▐', prop: '●',
    };
    Object.entries(ASSETS)
      .filter(([, def]) => def.category === cat)
      .forEach(([key, def]) => {
        const btn = document.createElement('div');
        btn.className = 'lb-asset';
        if (key === this._selectedAsset) btn.classList.add('lb-asset-active');
        btn.innerHTML = `<span class="lb-asset-icon">${icons[cat]}</span><span>${def.label}</span>`;
        btn.addEventListener('click', () => {
          this._selectedAsset = key;
          this._activeTool = 'place';
          this._assetGrid!.querySelectorAll('.lb-asset').forEach(b => b.classList.remove('lb-asset-active'));
          btn.classList.add('lb-asset-active');
          this._setTool('place');
          this._updateGhostMesh();
          this._status(`Selected: ${def.label}. Click the grid to place.`);
        });
        this._assetGrid!.appendChild(btn);
      });
  }

  // ─── Plan canvas drawing ─────────────────────────────────────────────────────

  private _resizePlan() {
    if (!this._planEl) return;
    const dpr = window.devicePixelRatio || 1;
    const el  = this._planEl;
    el.width  = el.clientWidth  * dpr;
    el.height = el.clientHeight * dpr;
    this._planCtx!.scale(dpr, dpr);
    this._planDirty = true;
  }

  private _recenterPlan() {
    if (!this._planEl) return;
    const dpr  = window.devicePixelRatio || 1;
    this._pox  = (this._planEl.width  / dpr) / 2;
    this._poy  = (this._planEl.height / dpr) / 2;
    this._pzoom = PX_PER_M;
    this._planDirty = true;
  }

  private _drawPlan() {
    const ctx = this._planCtx;
    if (!ctx || !this._planEl) return;
    const dpr  = window.devicePixelRatio || 1;
    const cw   = this._planEl.width  / dpr;
    const ch   = this._planEl.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // background
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, cw, ch);

    // minor grid (1 m)
    const gStep = this._pzoom;
    ctx.strokeStyle = '#152232';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let x = ((this._pox % gStep) + gStep) % gStep - gStep; x < cw + gStep; x += gStep) {
      ctx.moveTo(x, 0); ctx.lineTo(x, ch);
    }
    for (let y = ((this._poy % gStep) + gStep) % gStep - gStep; y < ch + gStep; y += gStep) {
      ctx.moveTo(0, y); ctx.lineTo(cw, y);
    }
    ctx.stroke();

    // major grid (5 m)
    const mg = gStep * 5;
    ctx.strokeStyle = '#1a2e44';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let x = ((this._pox % mg) + mg) % mg - mg; x < cw + mg; x += mg) {
      ctx.moveTo(x, 0); ctx.lineTo(x, ch);
    }
    for (let y = ((this._poy % mg) + mg) % mg - mg; y < ch + mg; y += mg) {
      ctx.moveTo(0, y); ctx.lineTo(cw, y);
    }
    ctx.stroke();

    // origin cross
    ctx.strokeStyle = '#2a5070';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this._pox - 12, this._poy); ctx.lineTo(this._pox + 12, this._poy);
    ctx.moveTo(this._pox, this._poy - 12); ctx.lineTo(this._pox, this._poy + 12);
    ctx.stroke();

    // placed objects
    for (const entity of this.queries.placed.entities) {
      const key  = entity.getValue(PlacedObject, 'modelKey') as string;
      const gx   = entity.getValue(PlacedObject, 'gridX')   as number;
      const gz   = entity.getValue(PlacedObject, 'gridZ')   as number;
      const rotY = entity.getValue(PlacedObject, 'rotY')    as number;
      const def  = ASSETS[key];
      if (!def) continue;

      const [cx, cy] = this._w2c(gx, gz);
      const pw = def.planW * this._pzoom;
      const pd = def.planD * this._pzoom;
      const isSel = entity === this._selectedEntity;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotY);

      if (def.category === 'floor') {
        ctx.fillStyle = isSel ? '#2a6040' : '#1e3830';
        ctx.strokeStyle = isSel ? '#44cc88' : '#3a7060';
      } else if (def.category === 'wall') {
        ctx.fillStyle = isSel ? '#5a4a3a' : '#2e2418';
        ctx.strokeStyle = isSel ? '#dda060' : '#7a5a38';
        // diagonal hatching for walls
        ctx.lineWidth = 1;
        ctx.fillRect(-pw / 2, -pd / 2, pw, pd);
        ctx.strokeRect(-pw / 2, -pd / 2, pw, pd);
        ctx.restore();
        continue;
      } else {
        ctx.fillStyle = isSel ? '#2a3a5a' : '#1a2040';
        ctx.strokeStyle = isSel ? '#6080dd' : '#3a50a0';
      }

      ctx.lineWidth = isSel ? 2 : 1;
      ctx.fillRect(-pw / 2, -pd / 2, pw, pd);
      ctx.strokeRect(-pw / 2, -pd / 2, pw, pd);
      ctx.restore();
    }

    // ghost preview
    if (this._ghostOn && this._activeTool === 'place' && ASSETS[this._selectedAsset]) {
      const def  = ASSETS[this._selectedAsset];
      const [cx, cy] = this._w2c(this._ghostGX, this._ghostGZ);
      const pw = def.planW * this._pzoom;
      const pd = def.planD * this._pzoom;
      ctx.fillStyle   = 'rgba(64,128,255,0.25)';
      ctx.strokeStyle = '#4080ff';
      ctx.lineWidth   = 1;
      ctx.fillRect(cx - pw / 2, cy - pd / 2, pw, pd);
      ctx.strokeRect(cx - pw / 2, cy - pd / 2, pw, pd);
    }

    ctx.restore();
  }

  // ─── Coordinate helpers ───────────────────────────────────────────────────────

  /** World XZ → canvas XY. */
  private _w2c(wx: number, wz: number): [number, number] {
    return [wx * this._pzoom + this._pox, wz * this._pzoom + this._poy];
  }
  /** Canvas XY → world XZ. */
  private _c2w(cx: number, cy: number): [number, number] {
    return [(cx - this._pox) / this._pzoom, (cy - this._poy) / this._pzoom];
  }
  private _snap(v: number): number {
    return Math.round(v / GRID_SNAP) * GRID_SNAP;
  }

  // ─── Object placement / removal ──────────────────────────────────────────────

  private _placeObject(gx: number, gz: number) {
    const key = this._selectedAsset;
    const def = ASSETS[key];
    if (!def) return;

    this._pushUndo();

    const mesh = def.createMesh();
    mesh.position.set(gx, def.yOffset, gz);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;

    const entity = this.world.createTransformEntity(mesh, {
      parent: this.world.sceneEntity,
      persistent: true,
    });
    entity
      .addComponent(PlacedObject, {
        modelKey: key,
        category: def.category,
        gridX:    gx,
        gridZ:    gz,
        rotY:     0,
      });

    this._planDirty = true;
    this._status(`Placed ${def.label} at (${gx}, ${gz})`);
  }

  private _removeObject(entity: ReturnType<typeof this.world.createTransformEntity>) {
    this._pushUndo();
    entity.dispose();
    this._planDirty = true;
  }

  private _clearAll() {
    this._pushUndo();
    const entities = [...this.queries.placed.entities];
    for (const e of entities) e.dispose();
    this._selectedEntity = null;
    this._showProps(false);
    this._planDirty = true;
    this._status('Cleared.');
  }

  // ─── Ghost mesh (3D view preview) ────────────────────────────────────────────

  private _updateGhostMesh() {
    const key = this._selectedAsset;
    const def = ASSETS[key];

    // recreate ghost if asset changed
    if (this._ghostMesh) {
      this.scene.remove(this._ghostMesh);
      this._ghostMesh.geometry.dispose();
      (this._ghostMesh.material as MeshBasicMaterial).dispose();
      this._ghostMesh = null;
    }
    if (!def || !this._ghostOn) return;

    const ghost = def.createMesh();
    // Dispose the createMesh() material before replacing — it would otherwise leak GPU memory.
    (ghost.material as MeshStandardMaterial).dispose();
    ghost.material = new MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.4, depthWrite: false });
    ghost.position.set(this._ghostGX, def.yOffset, this._ghostGZ);
    ghost.visible = this._activeView === '3d';
    this.scene.add(ghost);
    this._ghostMesh = ghost;
  }

  // ─── Selection ────────────────────────────────────────────────────────────────

  private _hitTest(gx: number, gz: number) {
    for (const entity of this.queries.placed.entities) {
      const key = entity.getValue(PlacedObject, 'modelKey') as string;
      const ex  = entity.getValue(PlacedObject, 'gridX')   as number;
      const ez  = entity.getValue(PlacedObject, 'gridZ')   as number;
      const def = ASSETS[key];
      if (!def) continue;
      const hw = def.planW / 2 + 0.1;
      const hd = def.planD / 2 + 0.1;
      if (gx >= ex - hw && gx <= ex + hw && gz >= ez - hd && gz <= ez + hd) return entity;
    }
    return null;
  }

  private _selectEntity(entity: ReturnType<typeof this.world.createTransformEntity> | null) {
    this._selectedEntity = entity;
    this._showProps(entity !== null);
    if (entity) {
      const m = (entity.object3D as Mesh).material as MeshStandardMaterial;
      if (m?.color && this._colorEl) {
        this._colorEl.value = '#' + m.color.getHexString();
      }
    }
    this._planDirty = true;
  }

  private _showProps(visible: boolean) {
    this._propsEl?.classList.toggle('lb-visible', visible);
  }

  // ─── View & tool switching ────────────────────────────────────────────────────

  private _setView(view: 'plan' | '3d') {
    this._activeView = view;

    const planEl = this._planEl;
    const vpEl   = this._ui?.querySelector<HTMLElement>('#lb-viewport');
    const bv     = this.globals.builderView as Signal<string> | undefined;

    if (view === 'plan') {
      planEl?.classList.remove('lb-3d-mode');
      vpEl?.classList.remove('lb-3d-active');
      bv && (bv.value = 'plan');
    } else {
      planEl?.classList.add('lb-3d-mode');
      vpEl?.classList.add('lb-3d-active');
      bv && (bv.value = '3d');
      // Re-centre orbit camera over centroid of placed objects
      const camSys = this.world.getSystem(EditorCameraSystem) as EditorCameraSystem | null;
      let cx = 0, cz = 0, n = 0;
      for (const e of this.queries.placed.entities) {
        cx += e.getValue(PlacedObject, 'gridX') as number;
        cz += e.getValue(PlacedObject, 'gridZ') as number;
        n++;
      }
      if (n > 0) camSys?.setTarget(cx / n, 0.5, cz / n);
    }

    this._ui?.querySelector('#lb-v-plan')?.classList.toggle('lb-view-active', view === 'plan');
    this._ui?.querySelector('#lb-v-3d')?.classList.toggle('lb-view-active', view === '3d');
    if (this._ghostMesh) this._ghostMesh.visible = view === '3d' && this._ghostOn;
    this._planDirty = true;
  }

  private _setTool(tool: 'select' | 'place') {
    this._activeTool = tool;
    if (!this._ui) return;
    this._ui.querySelector('#lb-t-place')?.classList.toggle('lb-tool-active',  tool === 'place');
    this._ui.querySelector('#lb-t-select')?.classList.toggle('lb-tool-active', tool === 'select');
    if (tool === 'select') { this._ghostOn = false; this._planDirty = true; }
  }

  // ─── Explore mode ────────────────────────────────────────────────────────────

  private _enterExploreMode() {
    for (const entity of this.queries.placed.entities) {
      const cat = entity.getValue(PlacedObject, 'category') as string;
      if (cat === 'floor' || cat === 'wall') {
        if (!entity.hasComponent(LocomotionEnvironment)) {
          entity.addComponent(LocomotionEnvironment);
        }
      }
    }
    this._hideUI();
    (this.globals.builderActive as Signal<boolean>).value = false;
    this.world.launchXR();
    this._status('Entered world. Exit XR to return to builder.');
  }

  // ─── Undo / redo ─────────────────────────────────────────────────────────────

  private _pushUndo() {
    this._undo.push(this._serialize());
    this._redo = [];
    if (this._undo.length > 50) this._undo.shift();
  }

  private _doUndo() {
    if (!this._undo.length) return;
    this._redo.push(this._serialize());
    this._restoreSnapshot(this._undo.pop()!);
  }

  private _doRedo() {
    if (!this._redo.length) return;
    this._undo.push(this._serialize());
    this._restoreSnapshot(this._redo.pop()!);
  }

  // ─── Serialisation ───────────────────────────────────────────────────────────

  private _serialize(): ObjRecord[] {
    return [...this.queries.placed.entities].map(e => ({
      modelKey: e.getValue(PlacedObject, 'modelKey') as string,
      gridX:    e.getValue(PlacedObject, 'gridX')    as number,
      gridZ:    e.getValue(PlacedObject, 'gridZ')    as number,
      rotY:     e.getValue(PlacedObject, 'rotY')     as number,
    }));
  }

  private _restoreSnapshot(records: ObjRecord[]) {
    for (const e of [...this.queries.placed.entities]) e.dispose();
    this._selectedEntity = null;
    this._showProps(false);
    for (const r of records) this._recreate(r);
    this._planDirty = true;
  }

  private _recreate(r: ObjRecord) {
    const def = ASSETS[r.modelKey];
    if (!def) return;
    const mesh = def.createMesh();
    mesh.position.set(r.gridX, def.yOffset, r.gridZ);
    mesh.rotation.y    = r.rotY;
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    this.world.createTransformEntity(mesh, { parent: this.world.sceneEntity, persistent: true })
      .addComponent(PlacedObject, {
        modelKey: r.modelKey, category: def.category,
        gridX: r.gridX, gridZ: r.gridZ, rotY: r.rotY,
      });
  }

  private _saveToStorage() {
    localStorage.setItem('lb-level', JSON.stringify(this._serialize()));
  }

  private _loadFromStorage() {
    const raw = localStorage.getItem('lb-level');
    if (!raw) return;
    try {
      const records: ObjRecord[] = JSON.parse(raw);
      for (const e of [...this.queries.placed.entities]) e.dispose();
      for (const r of records) this._recreate(r);
      this._planDirty = true;
      this._status(`Loaded ${records.length} objects.`);
    } catch { /* corrupt data */ }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private _status(msg: string) {
    if (this._statusEl) this._statusEl.textContent = msg;
  }
}


