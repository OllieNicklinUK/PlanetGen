// LootManager — seeded item spawning system.
//
// SPAWNING ZONES
//   Open terrain  → mineral resources (iron / crystal / gold / gem)
//   City zones    → gear & sports equipment (capture sphere / weapon / spray / ball / frisbee / racket)
//
// WORLD GRID
//   64-unit loot cells. Each cell is deterministically seeded (world seed XOR
//   a constant) so the same seed always produces the same world layout.
//   Items are pooled — only materialised within LOOT_RANGE of the player.
//
// PICKUP
//   Automatic on proximity (< PICKUP_RADIUS metres). Collected keys remembered
//   for the session.
//
// ITEM_DEFS is exported so the HUD can consume labels, icons, and colours
// without duplicating the catalogue.

import * as THREE from 'three';
import { SeededRNG, getTerrainHeight, isCityZone } from './noise.js';

const LOOT_CELL     = 64;       // world-space grid cell size
const LOOT_RANGE    = 200;      // materialise radius around player
const PICKUP_RADIUS = 2.5;      // auto-collect distance (metres)
const HOVER_HEIGHT  = 1.3;      // metres above terrain surface
const MAX_ACTIVE    = 90;       // hard cap on simultaneously materialised items
const SEED_SALT     = 0xbeef1234;

// ── Item catalogue ──────────────────────────────────────────────────────────
// Exported so LootHUD can use labels/icons/colours without duplication.

export const ITEM_DEFS = {
  // Resources — spawn in open terrain
  iron:    { label: 'Iron',    cat: 'RESOURCES', icon: '▪', color: '#aab0bb', hex: 0x888899, emissive: 0x222233, metalness: 0.85, roughness: 0.40 },
  crystal: { label: 'Crystal', cat: 'RESOURCES', icon: '◆', color: '#44eeff', hex: 0x44eeff, emissive: 0x00aa88, metalness: 0.10, roughness: 0.20 },
  gold:    { label: 'Gold',    cat: 'RESOURCES', icon: '●', color: '#ffcc22', hex: 0xffcc22, emissive: 0xaa6600, metalness: 0.90, roughness: 0.30 },
  gem:     { label: 'Gem',     cat: 'RESOURCES', icon: '◈', color: '#ff44bb', hex: 0xff44bb, emissive: 0x880033, metalness: 0.10, roughness: 0.15 },
  // Gear — spawn in city zones
  capture: { label: 'Capture', cat: 'GEAR',      icon: '○', color: '#ff6644', hex: 0xff6644, emissive: 0x881100, metalness: 0.30, roughness: 0.40 },
  weapon:  { label: 'Blaster', cat: 'GEAR',      icon: '▸', color: '#ff4444', hex: 0xff4444, emissive: 0x660000, metalness: 0.70, roughness: 0.30 },
  spray:   { label: 'Spray',   cat: 'GEAR',      icon: '◉', color: '#cc44ff', hex: 0xcc44ff, emissive: 0x440088, metalness: 0.60, roughness: 0.50 },
  // Sports — spawn in city zones
  ball:    { label: 'Ball',    cat: 'SPORTS',    icon: '◯', color: '#ffaa22', hex: 0xffaa22, emissive: 0x663300, metalness: 0.00, roughness: 0.80 },
  frisbee: { label: 'Frisbee', cat: 'SPORTS',    icon: '◌', color: '#44ff88', hex: 0x44ff88, emissive: 0x006622, metalness: 0.30, roughness: 0.50 },
  racket:  { label: 'Racket',  cat: 'SPORTS',    icon: '⊕', color: '#44aaff', hex: 0x44aaff, emissive: 0x002266, metalness: 0.50, roughness: 0.40 },
};

// ── Spawn probability tables ────────────────────────────────────────────────

const MINERAL_THRESHOLDS = [
  { type: 'iron',    t: 0.55 },
  { type: 'crystal', t: 0.80 },
  { type: 'gold',    t: 0.94 },
  { type: 'gem',     t: 1.00 },
];

const GEAR_THRESHOLDS = [
  { type: 'capture', t: 0.35 },
  { type: 'weapon',  t: 0.55 },
  { type: 'spray',   t: 0.72 },
  { type: 'ball',    t: 0.85 },
  { type: 'frisbee', t: 0.94 },
  { type: 'racket',  t: 1.00 },
];

function pickFromTable(roll, table) {
  for (const { type, t } of table) { if (roll < t) return type; }
  return table[table.length - 1].type;
}

// ── World-space geometry per type ────────────────────────────────────────────

function buildGeometry(type) {
  switch (type) {
    case 'iron':    return new THREE.BoxGeometry(0.65, 0.65, 0.65);
    case 'crystal': return new THREE.OctahedronGeometry(0.55, 0);
    case 'gold':    return new THREE.SphereGeometry(0.42, 8, 6);
    case 'gem':     return new THREE.DodecahedronGeometry(0.42, 0);
    case 'capture': return new THREE.SphereGeometry(0.45, 12, 8);
    case 'weapon': {
      const g = new THREE.BoxGeometry(0.18, 0.75, 0.12);
      return g;
    }
    case 'spray':   return new THREE.CylinderGeometry(0.18, 0.20, 0.78, 8, 1);
    case 'ball':    return new THREE.SphereGeometry(0.50, 10, 8);
    case 'frisbee': return new THREE.CylinderGeometry(0.55, 0.55, 0.07, 16, 1);
    case 'racket':  return new THREE.BoxGeometry(0.18, 0.90, 0.04);
    default:        return new THREE.BoxGeometry(0.5, 0.5, 0.5);
  }
}

// ── LootManager ──────────────────────────────────────────────────────────────

export class LootManager {
  constructor(scene, seed) {
    this._scene = scene;
    this._seed  = seed ^ SEED_SALT;

    this._active     = [];          // materialised item objects
    this._activeKeys = new Set();   // cell keys currently visible
    this._collected  = new Set();   // permanently collected this session
    this._cellCache  = new Map();   // cell definition cache

    // Starting inventory — player begins with 3 capture spheres
    this.inventory = {
      iron: 0, crystal: 0, gold: 0, gem: 0,
      capture: 3, weapon: 0, spray: 0,
      ball: 0, frisbee: 0, racket: 0,
    };

    // Fired with (type, inventory) on any inventory change
    this.onInventoryChange = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Add items to inventory and fire the change callback. */
  addItem(type, count = 1) {
    if (!(type in this.inventory)) return;
    this.inventory[type] += count;
    if (this.onInventoryChange) this.onInventoryChange(type, this.inventory);
  }

  // ── Cell loot definitions (cached) ──────────────────────────────────────────

  _getCellItems(cx, cz) {
    const cacheKey = `${cx}_${cz}`;
    if (this._cellCache.has(cacheKey)) return this._cellCache.get(cacheKey);

    const r     = SeededRNG.fromChunk(this._seed, cx, cz);
    const count = Math.floor(r.next() * 3) + 1;
    const items = [];

    // Sample the cell centre to decide zone type once (cheap)
    const sampleX = cx * LOOT_CELL + LOOT_CELL * 0.5;
    const sampleZ = cz * LOOT_CELL + LOOT_CELL * 0.5;
    const inCity  = isCityZone(sampleX, sampleZ);

    for (let i = 0; i < count; i++) {
      // Minerals: ~55% slot fill. Gear: ~25% (rarer, feels like a find).
      const threshold = inCity ? 0.25 : 0.55;
      if (r.next() > threshold) continue;

      const ox = (r.next() - 0.5) * LOOT_CELL * 0.8;
      const oz = (r.next() - 0.5) * LOOT_CELL * 0.8;
      const wx = cx * LOOT_CELL + ox;
      const wz = cz * LOOT_CELL + oz;

      const type = inCity
        ? pickFromTable(r.next(), GEAR_THRESHOLDS)
        : pickFromTable(r.next(), MINERAL_THRESHOLDS);

      items.push({ idx: i, type, wx, wz });
    }

    this._cellCache.set(cacheKey, items);
    return items;
  }

  // ── Materialise / dematerialise ─────────────────────────────────────────────

  _materialise(item) {
    const wy  = getTerrainHeight(item.wx, item.wz) + HOVER_HEIGHT;
    const def = ITEM_DEFS[item.type];
    const geo = buildGeometry(item.type);
    const mat = new THREE.MeshStandardMaterial({
      color:             def.hex,
      emissive:          def.emissive,
      emissiveIntensity: 0.55,
      metalness:         def.metalness,
      roughness:         def.roughness,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.position.set(item.wx, wy, item.wz);
    this._scene.add(mesh);

    return {
      key: item.key, type: item.type,
      x: item.wx, y: wy, z: item.wz,
      mesh, geo, mat,
      phase: Math.random() * Math.PI * 2,
    };
  }

  _dematerialise(a) {
    this._scene.remove(a.mesh);
    a.geo.dispose();
    a.mat.dispose();
  }

  _pickupFlash(pos, type) {
    const def  = ITEM_DEFS[type];
    const geo  = new THREE.SphereGeometry(0.25, 6, 6);
    const mat  = new THREE.MeshBasicMaterial({ color: def.hex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this._scene.add(mesh);
    let t = 0;
    const tick = () => {
      t += 0.07;
      mesh.scale.setScalar(1 + t * 5);
      mat.opacity = Math.max(0, 1 - t * 2.2);
      mat.transparent = true;
      if (t < 0.5) requestAnimationFrame(tick);
      else { this._scene.remove(mesh); geo.dispose(); mat.dispose(); }
    };
    tick();
  }

  // ── Per-frame update ─────────────────────────────────────────────────────────

  update(delta, playerPos) {
    const px = playerPos.x, py = playerPos.y, pz = playerPos.z;

    const minCX = Math.floor((px - LOOT_RANGE) / LOOT_CELL);
    const maxCX = Math.floor((px + LOOT_RANGE) / LOOT_CELL);
    const minCZ = Math.floor((pz - LOOT_RANGE) / LOOT_CELL);
    const maxCZ = Math.floor((pz + LOOT_RANGE) / LOOT_CELL);

    const wantedKeys = new Set();

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        for (const item of this._getCellItems(cx, cz)) {
          const key = `${cx}_${cz}_${item.idx}`;
          if (this._collected.has(key)) continue;
          wantedKeys.add(key);

          if (!this._activeKeys.has(key) && this._active.length < MAX_ACTIVE) {
            const active = this._materialise({ ...item, key });
            this._active.push(active);
            this._activeKeys.add(key);
          }
        }
      }
    }

    // Dematerialise out-of-range items
    for (let i = this._active.length - 1; i >= 0; i--) {
      if (!wantedKeys.has(this._active[i].key)) {
        this._dematerialise(this._active[i]);
        this._activeKeys.delete(this._active[i].key);
        this._active.splice(i, 1);
      }
    }

    // Animate + proximity pickup
    const elapsed = performance.now() * 0.001;
    for (let i = this._active.length - 1; i >= 0; i--) {
      const a = this._active[i];

      a.mesh.position.y = a.y + Math.sin(elapsed * 1.6 + a.phase) * 0.18;
      a.mesh.rotation.y = elapsed * 0.7 + a.phase;

      const dx = a.x - px, dy = a.y - py, dz = a.z - pz;
      if (dx * dx + dy * dy + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
        this._collected.add(a.key);
        this.inventory[a.type]++;
        this._pickupFlash(a.mesh.position, a.type);
        this._dematerialise(a);
        this._activeKeys.delete(a.key);
        this._active.splice(i, 1);
        if (this.onInventoryChange) this.onInventoryChange(a.type, this.inventory);
      }
    }
  }
}
