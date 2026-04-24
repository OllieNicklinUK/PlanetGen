// Tree Generator — EZ-Tree + InstancedMesh (snow world: pine only)

import * as THREE from 'three';
import { Tree } from './eztree/index.js';
import { SeededRNG, fbm } from './noise.js';

const VARIANTS = [
  { preset: 'Oak Medium',   scale: 0.5,  forestNoiseOffset: [0,    0   ] },
  { preset: 'Pine Medium',  scale: 0.45, forestNoiseOffset: [100,  200 ] },
  { preset: 'Ash Medium',   scale: 0.55, forestNoiseOffset: [300,  150 ] },
  { preset: 'Aspen Medium', scale: 0.4,  forestNoiseOffset: [500,  350 ] },
];

let _variants = null;

export function initTrees() {
  if (_variants) return;
  _variants = [];

  for (const v of VARIANTS) {
    const tree = new Tree();
    tree.loadPreset(v.preset);

    const branchGeo = tree.branchesMesh.geometry.clone();
    const branchMat = tree.branchesMesh.material.clone();
    const leavesGeo = tree.leavesMesh.geometry.clone();
    const leavesMat = tree.leavesMesh.material.clone();

    _variants.push({ branchGeo, branchMat, leavesGeo, leavesMat, scale: v.scale, forestOffset: v.forestNoiseOffset });
  }
}

// Snow-world pine placement — uses caller-supplied height function.
// Only spawns Pine Medium (variant index 1).
export function generatePinesForChunk(scene, cx, cz, chunkSize, seed, heightFn) {
  if (!_variants) return [];
  const pine       = _variants[1]; // Pine Medium
  const r          = SeededRNG.fromChunk(seed ^ 0xC0DE, cx, cz);
  const worldOffX  = cx * chunkSize;
  const worldOffZ  = cz * chunkSize;
  const positions  = [];

  for (let i = 0; i < 25; i++) {
    const lx = (r.next() - 0.5) * chunkSize;
    const lz = (r.next() - 0.5) * chunkSize;
    const wx = worldOffX + lx;
    const wz = worldOffZ + lz;

    const dist = Math.sqrt(wx * wx + wz * wz);
    if (dist < 18) continue; // inside flat summit — no trees

    // Slope check — skip cliffs
    const eps = 2;
    const dxH = (heightFn(wx - eps, wz) - heightFn(wx + eps, wz)) / (2 * eps);
    const dzH = (heightFn(wx, wz - eps) - heightFn(wx, wz + eps)) / (2 * eps);
    const normalY = 1 / Math.sqrt(dxH * dxH + 1 + dzH * dzH);
    if (normalY < 0.65) continue;

    // FBM density clustering — pines grow in groups
    const density = fbm(wx * 0.01 + 77, wz * 0.01 + 77, 3);
    if (density < 0.08) continue;

    positions.push({ lx, gy: heightFn(wx, wz), lz, rotY: r.next() * Math.PI * 2 });
  }

  if (positions.length === 0) return [];

  const dummy    = new THREE.Object3D();
  const branchIM = new THREE.InstancedMesh(pine.branchGeo, pine.branchMat, positions.length);
  const leavesIM = new THREE.InstancedMesh(pine.leavesGeo, pine.leavesMat, positions.length);
  branchIM.castShadow = leavesIM.castShadow = true;
  branchIM.receiveShadow = true;

  for (let i = 0; i < positions.length; i++) {
    const { lx, gy, lz, rotY } = positions[i];
    dummy.position.set(worldOffX + lx, gy, worldOffZ + lz);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(pine.scale);
    dummy.updateMatrix();
    branchIM.setMatrixAt(i, dummy.matrix);
    leavesIM.setMatrixAt(i, dummy.matrix);
  }
  branchIM.instanceMatrix.needsUpdate = true;
  leavesIM.instanceMatrix.needsUpdate = true;

  scene.add(branchIM);
  scene.add(leavesIM);
  return [branchIM, leavesIM];
}

export function updateTreeWind(elapsedTime) {
  if (!_variants) return;
  for (const v of _variants) {
    const shader = v.leavesMat.userData.shader;
    if (shader) shader.uniforms.uTime.value = elapsedTime;
  }
}
