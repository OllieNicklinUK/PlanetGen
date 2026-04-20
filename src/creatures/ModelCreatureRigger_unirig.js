// ModelCreatureRigger_unirig.js — Loader for UniRig-processed GLBs.
//
// Drop-in replacement for ModelCreatureRigger.js once UniRig has been run
// on the creature models (see UniRig_batch.ipynb).
//
// Differences from the runtime auto-rigger:
//   • Reads the existing armature embedded by UniRig — no proximity computation
//   • Bone descriptors are derived from the GLB skeleton hierarchy (bone names)
//     instead of bounding-box heuristics
//   • Skin weights come from the mesh attributes — AI-generated, topology-aware
//   • Per-instance clone is still fast (shares geometry ArrayBuffer)
//
// URL base: /creature-models-rigged/  (served from public/creature-models-rigged/)

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MORPHOTYPE, NOPED_SUBTYPE } from './CreatureParams.js';

// ── Per-model catalog (same as original, carried forward) ────────────────────

export const MODEL_CREATURE_CATALOG = {
  Elephant: { morphotype: MORPHOTYPE.QUADRUPED, biomeTag:'TEMPERATE', label:'Elephant',    scale:1.0, bodyHeight:1.4, behaviourPreset:'GRAZER' },
  rex:      { morphotype: MORPHOTYPE.BIPED,     biomeTag:'ARID',      label:'Rex',         scale:0.9, bodyHeight:1.8, hipFrac:0.45, meshRotationY:Math.PI, shinBendWeight:0.18, stepHeightMult:0.30, behaviourPreset:'HUNTER' },
  apex:     { morphotype: MORPHOTYPE.QUADRUPED, biomeTag:'VOLCANIC',  label:'Apex',        scale:1.1, bodyHeight:1.2, behaviourPreset:'HUNTER' },
  lizzy:    { morphotype: MORPHOTYPE.QUADRUPED, biomeTag:'LUSH',      label:'Lizzy',       scale:1.44, bodyHeight:0.8, tailSwing:2.2, shinBendWeight:0.5, stepHeightMult:0.6, meshRotationY:-Math.PI/2, behaviourPreset:'SWARM' },
  steggy:   { morphotype: MORPHOTYPE.QUADRUPED, biomeTag:'TEMPERATE', label:'Steggy',      scale:1.44, bodyHeight:1.5, meshRotationY:-Math.PI/2, stepHeightMult:0.25, shinBendWeight:0.15, speedMult:0.5, behaviourPreset:'GRAZER' },
  gek:      { morphotype: MORPHOTYPE.QUADRUPED, biomeTag:'LUSH',      label:'Gek',         scale:0.8, bodyHeight:0.9, behaviourPreset:'GRAZER' },
  Exo:      { morphotype: MORPHOTYPE.BIPED,     biomeTag:'TEMPERATE', label:'Exo',         scale:1.0, bodyHeight:1.8, hipFrac:0.48, meshRotationY:-Math.PI/2, yOffset:1.0, shinBendWeight:0.12, stepHeightMult:0.22, behaviourPreset:'STALKER' },
  octo:     { morphotype: MORPHOTYPE.NOPED,     biomeTag:'AQUATIC',   label:'Octo',        scale:1.0, bodyHeight:0.8, subtype:NOPED_SUBTYPE.FLOATER, behaviourPreset:'DRIFTER' },
  skull:    { morphotype: MORPHOTYPE.NOPED,     biomeTag:'TOXIC',     label:'Skull Serpent',scale:0.7, bodyHeight:0.6, subtype:NOPED_SUBTYPE.UNDULATOR, behaviourPreset:'STALKER' },
};

// ── Loader & cache ────────────────────────────────────────────────────────────

const _loader   = new GLTFLoader();
const _rigCache = new Map();  // modelName → RigTemplate

export async function preloadCreatureModel(modelName) {
  if (_rigCache.has(modelName)) return;
  const cfg = MODEL_CREATURE_CATALOG[modelName];
  if (!cfg) return;
  const url = `./creature-models-rigged/${modelName}.glb`;
  try {
    const gltf = await _loader.loadAsync(url);
    const tmpl = _buildTemplateFromGLTF(gltf, cfg);
    if (tmpl) {
      _rigCache.set(modelName, tmpl);
      console.log(`[UniRigLoader] Loaded: ${modelName} — ${tmpl.boneDescs.length} bones`);
    }
  } catch (e) {
    console.warn(`[UniRigLoader] ${url} not found — falling back to runtime rigger for ${modelName}`);
    // Graceful fallback: import and use the runtime rigger
    const { preloadCreatureModel: fallback } = await import('./ModelCreatureRigger.js');
    await fallback(modelName);
    _rigCache.set(modelName, null); // null = use fallback
  }
}

export async function preloadAllCreatureModels() {
  await Promise.all(Object.keys(MODEL_CREATURE_CATALOG).map(preloadCreatureModel));
}

export function rigCreatureModel(modelName, params) {
  const tmpl = _rigCache.get(modelName);

  // null means we fell back to the runtime rigger
  if (tmpl === null) {
    const { rigCreatureModel: fallback } = require('./ModelCreatureRigger.js');
    return fallback(modelName, params);
  }
  if (!tmpl) return null;

  // ── Clone geometry (shares ArrayBuffer — very fast) ──────────────────────
  const geo = tmpl.geo.clone();

  // ── Fresh bone hierarchy from the same descriptors ───────────────────────
  const threeBones = tmpl.boneDescs.map(bd => {
    const bone = new THREE.Bone();
    bone.name = bd.name;
    bone.position.copy(bd.localPos);
    return bone;
  });
  for (const bd of tmpl.boneDescs) {
    if (bd.parentIdx >= 0) {
      threeBones[bd.parentIdx].add(threeBones[bd.idx]);
    }
  }
  const skeletonRoot = new THREE.Group();
  for (const bd of tmpl.boneDescs) {
    if (bd.parentIdx < 0) skeletonRoot.add(threeBones[bd.idx]);
  }

  const skeleton = new THREE.Skeleton(threeBones);
  const mesh     = new THREE.SkinnedMesh(geo, tmpl.mats);
  if (tmpl.cfg.meshRotationY) mesh.rotation.y = tmpl.cfg.meshRotationY;
  mesh.add(skeletonRoot);
  mesh.bind(skeleton);
  mesh.castShadow     = true;
  mesh.receiveShadow  = true;

  // Scale to match bodyLength × scale
  const targetSize = (params.bodyLength || 1.5) * (params.scale || 1.0);
  const finalScale = targetSize / (tmpl.normScale || 1);

  const group = new THREE.Group();
  group.scale.setScalar(finalScale);
  group.add(mesh);

  // Build the boneDescs array in the role format the animation system expects
  const boneDescs = _mapBoneRoles(tmpl.boneDescs, tmpl.cfg);

  return { mesh, bones: threeBones, skeleton, boneDescs, group };
}

// ── GLTF template builder ─────────────────────────────────────────────────────

function _buildTemplateFromGLTF(gltf, cfg) {
  // Find the SkinnedMesh in the scene
  let skinnedMesh = null;
  gltf.scene.traverse(obj => { if (obj.isSkinnedMesh && !skinnedMesh) skinnedMesh = obj; });
  if (!skinnedMesh) {
    console.warn('[UniRigLoader] No SkinnedMesh found in GLB');
    return null;
  }

  // Collect bone descriptors from the skeleton
  const skeleton  = skinnedMesh.skeleton;
  const boneDescs = skeleton.bones.map((bone, idx) => {
    const parentIdx = skeleton.bones.findIndex(b => b === bone.parent);
    return {
      idx,
      name:      bone.name,
      parentIdx, // -1 if root
      localPos:  bone.position.clone(),
      role:      _guessRole(bone.name, idx, skeleton.bones.length),
      id:        idx,
      parent:    parentIdx >= 0 ? parentIdx : null,
      start:     new THREE.Vector3(),
      end:       new THREE.Vector3(),
      radius:    0.1,
    };
  });

  // Compute world-space start/end for each bone (for IK compatibility)
  skeleton.bones.forEach((bone, idx) => {
    bone.getWorldPosition(boneDescs[idx].start);
    // End = average of children world positions, or start + small forward offset
    const children = skeleton.bones.filter((_, ci) => boneDescs[ci].parentIdx === idx);
    if (children.length > 0) {
      const avg = new THREE.Vector3();
      children.forEach(c => { const p = new THREE.Vector3(); c.getWorldPosition(p); avg.add(p); });
      avg.divideScalar(children.length);
      boneDescs[idx].end.copy(avg);
    } else {
      boneDescs[idx].end.copy(boneDescs[idx].start).addScaledVector(new THREE.Vector3(0,1,0), 0.05);
    }
  });

  // Geometry + materials
  const geo  = skinnedMesh.geometry.clone();
  const mats = skinnedMesh.material;

  // Longest model dimension for scale normalisation
  geo.computeBoundingBox();
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  const normScale = Math.max(size.x, size.y, size.z);

  return { geo, boneDescs, mats, normScale, cfg };
}

// ── Role mapping: translate UniRig bone names → our animation roles ───────────
// UniRig outputs bones named by the Articulation-XL standard (or mixamo-style).
// We map them to our roles: spine, head, neck, tail, limb_upper, limb_lower, foot.

const ROLE_PATTERNS = [
  { role: 'head',        patterns: [/head/i, /skull/i] },
  { role: 'neck',        patterns: [/neck/i] },
  { role: 'tail',        patterns: [/tail/i] },
  { role: 'foot',        patterns: [/foot/i, /toe/i, /hoof/i, /claw/i] },
  { role: 'limb_lower',  patterns: [/forearm/i, /lowerarm/i, /shin/i, /lowerleg/i, /lower.?leg/i, /calf/i] },
  { role: 'limb_upper',  patterns: [/upperarm/i, /arm/i, /thigh/i, /upperleg/i, /upper.?leg/i] },
  { role: 'spine',       patterns: [/spine/i, /hip/i, /pelvis/i, /chest/i, /torso/i, /abdomen/i, /back/i, /root/i] },
];

function _guessRole(boneName, idx, totalBones) {
  for (const { role, patterns } of ROLE_PATTERNS) {
    if (patterns.some(p => p.test(boneName))) return role;
  }
  // Fallback: treat as spine
  return 'spine';
}

function _mapBoneRoles(boneDescs, cfg) {
  // Ensure the animation system can find head/spine/tail etc. by role
  // Also ensure 'id' and 'parent' fields match what CreatureManager expects
  return boneDescs.map(bd => ({
    ...bd,
    id:     bd.idx,
    parent: bd.parentIdx >= 0 ? bd.parentIdx : null,
  }));
}
