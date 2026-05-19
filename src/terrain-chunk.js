// Terrain Chunk — adapted for IWSDK integration
// Key difference from PlanetGen_viverse original:
//   - Terrain mesh geometry is in WORLD SPACE (translate after rotate, no group offset)
//     so world.createTransformEntity(terrainMesh) can wrap it with LocomotionEnvironment.
//   - City/road/grass objects live in _cityGroup, positioned at (cx*chunkSize, 0, cz*chunkSize)
//     and added to the terrain manager's _chunkGroup separately.
//   - Trees are still added directly to scene (unchanged).
//
// Lifecycle managed by WorldSystem via TerrainManager callbacks:
//   onChunkBuilt  → world.createTransformEntity(chunk.terrainMesh) + LocomotionEnvironment
//   onChunkRemoved → entity.destroy() + geometry.dispose() before chunk.destroy()

import * as THREE from 'three';
import { getTerrainHeight } from './noise.js';
import { MAT } from './materials.js';
import { generateCityForChunk } from './city-generator.js';
import { generateGrassForChunk } from './grass-generator.js';
import { generateTreesForChunk } from './tree-generator.js';

export class TerrainChunk {
  constructor(params) {
    // City group: positioned at chunk origin, holds city/road/grass in local space
    this._cityGroup = new THREE.Group();
    this._params = params;
    this._buildingCount = 0;
    this._buildingBoxes = [];
    this._buildingMeshes = {};  // id → THREE.Mesh (individually destructible)
    this._treeMeshes = [];
    this._treePositions = [];
    this._built = false;
    this._terrainMesh = null;           // World-space terrain mesh (no group parent)
    this._buildingCollisionMesh = null; // World-space position-only building collision mesh
    this._locomotionEntity = null;      // Terrain LocomotionEnvironment entity (WorldSystem)
    this._cityGroupEntity = null;       // Building collision LocomotionEnvironment entity (WorldSystem)
  }

  get cityGroup()             { return this._cityGroup; }
  get buildingCount()         { return this._buildingCount; }
  get buildingBoxes()         { return this._buildingBoxes; }
  get key()                   { return this._params.key; }
  get terrainMesh()           { return this._terrainMesh; }
  get buildingCollisionMesh() { return this._buildingCollisionMesh; }

  /** Remove a single building by ID. Returns debris position or null. */
  destroyBuilding(id) {
    const mesh = this._buildingMeshes[id];
    if (!mesh) return null;

    const pos = mesh.getWorldPosition(new THREE.Vector3());

    this._cityGroup.remove(mesh);
    mesh.geometry.dispose();
    delete this._buildingMeshes[id];

    this._buildingBoxes = this._buildingBoxes.filter(b => b.id !== id);
    this._buildingCount = Math.max(0, this._buildingCount - 1);

    return pos;
  }

  build() {
    if (this._built) return;
    this._built = true;

    const { cx, cz, chunkSize, seed, mode, lod, terrainSegs } = this._params;

    // City group: city objects are in local space, so position the group at chunk origin
    this._cityGroup.position.set(cx * chunkSize, 0, cz * chunkSize);

    // ── Terrain mesh in WORLD SPACE ──────────────────────────────────────────
    // PlaneGeometry vertices: x ∈ [-chunkSize/2, +chunkSize/2], z ∈ [same] after rotateX.
    // geo.translate(cx*cs, 0, cz*cs) shifts them to world coords — no group offset needed.
    // The mesh is NOT added to _cityGroup; WorldSystem adds it via createTransformEntity.
    const segs = terrainSegs;
    const geo = new THREE.PlaneGeometry(chunkSize, chunkSize, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.translate(cx * chunkSize, 0, cz * chunkSize);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);  // already world X after translate
      const wz = pos.getZ(i);  // already world Z after translate
      pos.setY(i, getTerrainHeight(wx, wz));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, MAT.ground);
    terrain.receiveShadow = true;
    terrain.name = `terrain_${cx}_${cz}`;
    this._terrainMesh = terrain;
    // Not added to scene here — WorldSystem does it via createTransformEntity

    // ── City content (local space, inside _cityGroup) ────────────────────────
    const cityResult = generateCityForChunk(this._cityGroup, cx, cz, chunkSize, seed, mode, lod);
    this._buildingCount       = cityResult.buildingCount;
    this._buildingBoxes       = cityResult.buildingBoxes;
    this._buildingMeshes      = cityResult.buildingMeshes;
    this._buildingCollisionMesh = cityResult.buildingCollisionMesh;

    // ── Grass (local space inside _cityGroup, only on highest LOD) ──────────
    if (lod === 0) {
      const grassMesh = generateGrassForChunk(cx * chunkSize, cz * chunkSize, chunkSize, mode);
      if (grassMesh) this._cityGroup.add(grassMesh);
    }

    // ── Trees — InstancedMeshes added directly to scene ──────────────────────
    const treeResult = generateTreesForChunk(this._params.scene, cx, cz, chunkSize, seed);
    if (treeResult) {
      this._treeMeshes = treeResult.meshes;
      this._treePositions = treeResult.positions;
    }
  }

  destroy() {
    this._built = false;

    // City group — dispose geometry (materials are shared, do NOT dispose)
    this._cityGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this._cityGroup.parent) {
      this._cityGroup.parent.remove(this._cityGroup);
    }

    // Tree InstancedMeshes — remove from scene and dispose geometry
    for (const mesh of this._treeMeshes) {
      if (mesh.parent) mesh.parent.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    }
    this._treeMeshes = [];
    this._treePositions = [];

    // Locomotion entities are destroyed in onChunkRemoved before destroy() is called.
    this._terrainMesh = null;
    this._buildingCollisionMesh = null;
    this._locomotionEntity = null;
    this._cityGroupEntity = null;
  }
}
