// Ocean Manager — contained water patches at terrain depressions.
//
// V2: Replaces the full-world Water.js reflective plane (very expensive —
// runs a reflection render pass every frame) with small CircleGeometry patches
// placed only where terrain actually dips below SEA_LEVEL.
//
// Performance profile:
//   - One shared MeshStandardMaterial (no reflection shader)
//   - Max 10 patches of ~16-segment circles (~480 triangles total)
//   - Rebuilds only when player moves > 128 m
//   - Natural clustering avoids overlapping pools

import * as THREE from 'three';
import { getTerrainHeight } from './noise.js';

const SEA_LEVEL    = -9;    // only the deepest valleys fill
const PATCH_RADIUS = 55;    // base radius of each pool in metres
const MAX_PATCHES  = 10;    // hard cap on simultaneous patches
const SCAN_RANGE   = 700;   // scan radius around player (metres)
const SCAN_STEP    = 46;    // grid spacing between sample points
const MOVE_THRESH  = 128;   // metres player must move before rebuild

export class OceanManager {
  constructor(scene) {
    this._scene   = scene;
    this._patches = [];
    this._lastX   = null;
    this._lastZ   = null;
    this._time    = 0;

    // One shared material for all patches — no per-patch cost
    this._mat = new THREE.MeshStandardMaterial({
      color:       new THREE.Color(0x1a4a70),
      roughness:   0.06,
      metalness:   0.18,
      transparent: true,
      opacity:     0.80,
      depthWrite:  false,   // avoids z-fighting with terrain at water's edge
    });
  }

  /** Called each frame from WorldSystem.update(). sunDir is unused but kept for API compat. */
  update(dt, camPos /*, sunDir */) {
    this._time += dt;

    // Subtle colour shimmer — no texture needed
    const phase = Math.sin(this._time * 0.35) * 0.025;
    this._mat.color.setRGB(0.08 + phase, 0.27 + phase, 0.41 + phase);

    // Rebuild only when player moves far enough to warrant it
    if (this._lastX === null) {
      this._lastX = camPos.x + MOVE_THRESH * 2; // force first build
      this._lastZ = camPos.z;
    }
    const dx = camPos.x - this._lastX;
    const dz = camPos.z - this._lastZ;
    if (dx * dx + dz * dz > MOVE_THRESH * MOVE_THRESH) {
      this._lastX = camPos.x;
      this._lastZ = camPos.z;
      this._rebuildPatches(camPos.x, camPos.z);
    }
  }

  _rebuildPatches(cx, cz) {
    // Dispose previous patch geometries
    for (const m of this._patches) {
      this._scene.remove(m);
      m.geometry.dispose();
    }
    this._patches = [];

    // Grid-sample terrain in range, collect sub-sea-level points
    const half = SCAN_RANGE / 2;
    const candidates = [];
    for (let dx = -half; dx <= half; dx += SCAN_STEP) {
      for (let dz = -half; dz <= half; dz += SCAN_STEP) {
        const wx = cx + dx;
        const wz = cz + dz;
        const h  = getTerrainHeight(wx, wz);
        if (h < SEA_LEVEL) {
          candidates.push({ wx, wz, h });
        }
      }
    }

    // Sort by depth (deepest first) then pick well-separated patches
    candidates.sort((a, b) => a.h - b.h);
    const placed = [];
    for (const c of candidates) {
      const minSep = PATCH_RADIUS * 2.2; // prevent overlapping pools
      const tooClose = placed.some(p => {
        const ddx = p.wx - c.wx, ddz = p.wz - c.wz;
        return ddx * ddx + ddz * ddz < minSep * minSep;
      });
      if (!tooClose) placed.push(c);
      if (placed.length >= MAX_PATCHES) break;
    }

    // Create a circle mesh for each selected patch
    for (const p of placed) {
      // Vary radius slightly per location using a cheap hash so pools aren't all identical
      const hash = Math.abs((p.wx * 7 + p.wz * 13) | 0) % 40;
      const radius = PATCH_RADIUS + hash;
      const geo  = new THREE.CircleGeometry(radius, 16);
      const mesh = new THREE.Mesh(geo, this._mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(p.wx, SEA_LEVEL, p.wz);
      mesh.receiveShadow = false; // skip shadow cost on water
      this._scene.add(mesh);
      this._patches.push(mesh);
    }
  }

  dispose() {
    for (const m of this._patches) { this._scene.remove(m); m.geometry.dispose(); }
    this._patches = [];
    this._mat.dispose();
  }

  get seaLevel() { return SEA_LEVEL; }
  get patchCount() { return this._patches.length; }
}
