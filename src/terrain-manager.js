// Terrain Manager — Fixed-grid chunk streaming adapted for IWSDK
// Changes from PlanetGen_viverse original:
//   - chunk.cityGroup (not chunk.group) is added to _chunkGroup
//   - onChunkBuilt / onChunkRemoved callbacks allow WorldSystem to manage
//     IWSDK LocomotionEnvironment entities for terrain meshes
//   - Terrain mesh is NOT added here; WorldSystem does it via createTransformEntity

import * as THREE from 'three';
import { TerrainChunk } from './terrain-chunk.js';

const CHUNK_SIZE = 256;

export const WORLD_CONFIG = {
  renderDist:    3,  // chunks loaded in each direction around player
  chunksPerFrame: 2, // how many chunks to build per frame
};

export class TerrainManager {
  constructor(scene, seed, mode) {
    this._scene         = scene;
    this._seed          = seed;
    this._mode          = mode;
    this._chunks        = new Map();
    this._chunkGroup    = new THREE.Group();
    this._scene.add(this._chunkGroup);
    this._buildingCount = 0;
    this._lastCX        = null;
    this._lastCZ        = null;
    this._buildingBoxes = [];
    this._buildQueue    = [];

    // Set by WorldSystem to integrate with IWSDK LocomotionEnvironment
    this.onChunkBuilt   = null;  // (chunk) => void  called after chunk is built
    this.onChunkRemoved = null;  // (chunk) => void  called before chunk.destroy()
  }

  get group()         { return this._chunkGroup; }
  get buildingCount() { return this._buildingCount; }
  get chunkCount()    { return this._chunks.size; }
  get chunkSize()     { return CHUNK_SIZE; }
  get buildingBoxes() { return this._buildingBoxes; }

  /** Flat array of all building Meshes across loaded chunks for raycasting. */
  get buildingMeshes() {
    const meshes = [];
    for (const [, chunk] of this._chunks) {
      for (const mesh of Object.values(chunk._buildingMeshes)) {
        meshes.push(mesh);
      }
    }
    return meshes;
  }

  /** Destroy a building by its ID. Returns world-space position or null. */
  destroyBuilding(id) {
    for (const [, chunk] of this._chunks) {
      const pos = chunk.destroyBuilding(id);
      if (pos) {
        this._rebuildBoxes();
        this._buildingCount = Math.max(0, this._buildingCount - 1);
        return pos;
      }
    }
    return null;
  }

  update(camX, camZ) {
    const cx = Math.floor(camX / CHUNK_SIZE);
    const cz = Math.floor(camZ / CHUNK_SIZE);

    if (cx === this._lastCX && cz === this._lastCZ) {
      this._processBuildQueue();
      return;
    }
    this._lastCX = cx;
    this._lastCZ = cz;

    // Remove out-of-range chunks
    const rd = WORLD_CONFIG.renderDist;
    let changed = false;
    for (const [key, chunk] of this._chunks) {
      const parts = key.split('_');
      const kcx = +parts[0], kcz = +parts[1];
      if (Math.abs(kcx - cx) > rd + 1 || Math.abs(kcz - cz) > rd + 1) {
        if (this.onChunkRemoved) this.onChunkRemoved(chunk);
        chunk.destroy();
        this._chunks.delete(key);
        changed = true;
      }
    }

    // Queue new chunks
    for (let dx = -rd; dx <= rd; dx++) {
      for (let dz = -rd; dz <= rd; dz++) {
        const tcx = cx + dx, tcz = cz + dz;
        const key = `${tcx}_${tcz}`;
        if (!this._chunks.has(key)) {
          const chunk = new TerrainChunk({
            key, cx: tcx, cz: tcz,
            chunkSize: CHUNK_SIZE,
            seed: this._seed, mode: this._mode,
            lod: 0, terrainSegs: 128,
            scene: this._scene,
          });
          this._chunks.set(key, chunk);
          this._buildQueue.push(chunk);
        }
      }
    }

    if (changed) this._rebuildBoxes();
    this._processBuildQueue();
  }

  _processBuildQueue() {
    let built = 0;
    while (this._buildQueue.length > 0 && built < WORLD_CONFIG.chunksPerFrame) {
      const chunk = this._buildQueue.shift();
      if (this._chunks.has(chunk.key)) {
        chunk.build();
        // City group (roads, buildings, grass) goes into the master chunk group
        this._chunkGroup.add(chunk.cityGroup);
        chunk.cityGroup.updateWorldMatrix(true, true);
        // Terrain mesh is handled by WorldSystem's onChunkBuilt callback
        if (this.onChunkBuilt) this.onChunkBuilt(chunk);
        built++;
      }
    }

    if (built > 0) this._rebuildBoxes();

    this._buildingCount = 0;
    for (const [, chunk] of this._chunks) {
      this._buildingCount += chunk.buildingCount;
    }
  }

  _rebuildBoxes() {
    this._buildingBoxes = [];
    for (const [, chunk] of this._chunks) {
      for (const box of chunk.buildingBoxes) {
        this._buildingBoxes.push(box);
      }
    }
  }

  rebuild(seed, mode) {
    this._seed = seed;
    this._mode = mode;
    this._buildQueue = [];
    this._lastCX = null;
    this._lastCZ = null;
    this._buildingBoxes = [];

    for (const [, chunk] of this._chunks) {
      if (this.onChunkRemoved) this.onChunkRemoved(chunk);
      chunk.destroy();
    }
    this._chunks.clear();
    this._buildingCount = 0;
  }
}
