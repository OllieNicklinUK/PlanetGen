// Tree Generator — EZ-Tree + InstancedMesh
// Generates 4 tree variant base geometries once at startup using EZ-Tree,
// then places them across terrain chunks via InstancedMesh.
// Trees only spawn outside city zones, on non-steep slopes, using noise clustering.

import * as THREE from 'three';
import { Tree } from './eztree/index.js';
import { SeededRNG, fbm, isCityZone, getTerrainHeight, getBiome, BIOME } from './noise.js';

// Trees per chunk (max). Actual count varies with noise-driven forest density.
const MAX_TREES_PER_CHUNK = 40;

// Slope threshold: terrain normal Y component below this = too steep for trees
const MIN_SLOPE_Y = 0.75;

// Approximate terrain normal from finite differences
function terrainNormalY(wx, wz) {
  const eps = 2;
  const hL = getTerrainHeight(wx - eps, wz);
  const hR = getTerrainHeight(wx + eps, wz);
  const hD = getTerrainHeight(wx, wz - eps);
  const hU = getTerrainHeight(wx, wz + eps);
  const nx = (hL - hR) / (2 * eps);
  const nz = (hD - hU) / (2 * eps);
  const len = Math.sqrt(nx * nx + 1 + nz * nz);
  return 1 / len; // Y component of normalised normal
}

// ── Variant definitions ────────────────────────────────────────────────────
const VARIANTS = [
  { preset: 'Oak Medium',   scale: 0.5,  forestNoiseOffset: [0,    0   ] },
  { preset: 'Pine Medium',  scale: 0.45, forestNoiseOffset: [100,  200 ] },
  { preset: 'Ash Medium',   scale: 0.55, forestNoiseOffset: [300,  150 ] },
  { preset: 'Aspen Medium', scale: 0.4,  forestNoiseOffset: [500,  350 ] },
];

// ── Build base geometries once (called from main.js on startup) ───────────
let _variants = null; // [{ branchGeo, leavesGeo, branchMat, leavesMat, scale }]

export function initTrees() {
  if (_variants) return;
  _variants = [];

  for (const v of VARIANTS) {
    const tree = new Tree();
    tree.loadPreset(v.preset);

    // Extract branch geometry + material
    const branchGeo = tree.branchesMesh.geometry.clone();
    const branchMat = tree.branchesMesh.material.clone();

    // Extract leaves geometry + material
    const leavesGeo = tree.leavesMesh.geometry.clone();
    const leavesMat = tree.leavesMesh.material.clone();

    _variants.push({ branchGeo, branchMat, leavesGeo, leavesMat, scale: v.scale, forestOffset: v.forestNoiseOffset });
  }
}

// ── Per-chunk tree placement ───────────────────────────────────────────────
export function generateTreesForChunk(scene, cx, cz, chunkSize, seed) {
  if (!_variants) return null;

  const r = SeededRNG.fromChunk(seed ^ 0xBEEF, cx, cz);
  const worldOffX = cx * chunkSize;
  const worldOffZ = cz * chunkSize;

  // Count how many trees per variant this chunk will hold
  const counts = _variants.map(() => 0);
  const positions = _variants.map(() => []);

  for (let i = 0; i < MAX_TREES_PER_CHUNK; i++) {
    // Random local position within chunk
    const lx = (r.next() - 0.5) * chunkSize;
    const lz = (r.next() - 0.5) * chunkSize;
    const wx = worldOffX + lx;
    const wz = worldOffZ + lz;

    // Skip city zones
    if (isCityZone(wx, wz)) continue;

    // Skip steep slopes
    if (terrainNormalY(wx, wz) < MIN_SLOPE_Y) continue;

    // Biome-based tree placement
    const biome = getBiome(wx, wz);
    
    // Skip biomes that shouldn't have trees
    if (biome === BIOME.SAND || biome === BIOME.CLIFF) continue;
    
    // Density multiplier based on biome
    let biomeDensityMult = 1.0;
    if (biome === BIOME.ROCK) biomeDensityMult = 0.2; // sparse trees in rocky areas
    if (biome === BIOME.DUST) biomeDensityMult = 0.6; // medium density in dry dirt
    
    // Forest density noise — cluster trees together
    const density = fbm(wx * 0.004 + 77, wz * 0.004 + 77, 3);
    if (density < (0.05 / biomeDensityMult)) continue; 

    const gy = getTerrainHeight(wx, wz);

    // Pick variant based on another noise value shifted by biome
    const varNoise = fbm(wx * 0.002 + 200, wz * 0.002 + 200, 2);
    
    // Influence variant selection by biome:
    // Pine (Index 1) is more common in Rock/Dust. Oak (Index 0) more common in Grass.
    let varIdx;
    const vN = Math.abs(varNoise);
    if (biome === BIOME.ROCK || biome === BIOME.DUST) {
      // Lean towards variant 1 (Pine) and 3 (Aspen)
      varIdx = vN > 0.5 ? 1 : 3;
    } else {
      // Grass: Lean towards 0 (Oak) and 2 (Ash)
      varIdx = vN > 0.4 ? 0 : 2;
    }

    // Random Y rotation
    const rotY = r.next() * Math.PI * 2;

    positions[varIdx].push({ lx, gy, lz, rotY });
    counts[varIdx]++;
  }

  const meshes = [];

  for (let vi = 0; vi < _variants.length; vi++) {
    const pts = positions[vi];
    if (pts.length === 0) continue;

    const v = _variants[vi];
    const dummy = new THREE.Object3D();

    // Branches InstancedMesh
    const branchIM = new THREE.InstancedMesh(v.branchGeo, v.branchMat, pts.length);
    branchIM.castShadow = true;
    branchIM.receiveShadow = true;

    // Leaves InstancedMesh
    const leavesIM = new THREE.InstancedMesh(v.leavesGeo, v.leavesMat, pts.length);
    leavesIM.castShadow = true;

    for (let i = 0; i < pts.length; i++) {
      const { lx, gy, lz, rotY } = pts[i];
      dummy.position.set(worldOffX + lx, gy, worldOffZ + lz);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.setScalar(v.scale);
      dummy.updateMatrix();
      branchIM.setMatrixAt(i, dummy.matrix);
      leavesIM.setMatrixAt(i, dummy.matrix);
    }

    branchIM.instanceMatrix.needsUpdate = true;
    leavesIM.instanceMatrix.needsUpdate = true;

    scene.add(branchIM);
    scene.add(leavesIM);
    meshes.push(branchIM, leavesIM);
  }

  // Flatten nested positions for easy AI lookup
  const flatPositions = positions.flat().map(p => ({
    pos: new THREE.Vector3(worldOffX + p.lx, p.gy, worldOffZ + p.lz),
    type: 'tree'
  }));

  return { meshes, positions: flatPositions };
}

// ── Wind animation update (call each frame with elapsed time) ─────────────
export function updateTreeWind(elapsedTime) {
  if (!_variants) return;
  for (const v of _variants) {
    const shader = v.leavesMat.userData.shader;
    if (shader) shader.uniforms.uTime.value = elapsedTime;
  }
}
