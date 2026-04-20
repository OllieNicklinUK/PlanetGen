// ModelCreatureRigger.js — runtime auto-rigger for whole GLB creature models.
//
// V2 — single-rig-per-type architecture:
//   preloadCreatureModel()  → loads GLB + computes ONE rig template (heavy)
//   rigCreatureModel()      → clones geometry + builds fresh bone hierarchy (fast)
//
// All instances of the same species share:
//   • Identical bone descriptors / skin weights
//   • The same merged geometry (shared ArrayBuffer — read-only after bind)
//   • The same original PBR materials
//
// Per-instance: own THREE.Bone objects, own THREE.Skeleton, own group/scale.
//
// ── GLB best practices ──────────────────────────────────────────────────────
//   1. Orientation   : face +Z (forward), Y-up. Apply all transforms before export.
//   2. Origin        : place at ground-center of the bounding box (feet on Y=0).
//   3. Rest pose      : T-pose or natural standing pose with legs straight.
//   4. Single mesh   : merge body into one mesh before export for cleanest weights.
//                      Separate accessories are fine — they merge at load time.
//   5. Body extremities at bbox extremes: head tip at max-Z, tail at min-Z,
//                      feet near min-Y. The auto-rigger reads these to place bones.
//   6. Symmetry      : bilateral symmetry on the ZY plane (X = 0) gives best limb detection.
//   7. Vertex density: 5k–20k vertices per creature is optimal.
//                      Dense loops around joints (knees, neck) improve deformation.
//   8. No existing armature: export without any skeleton — the rigger builds its own.
//   9. Materials     : single PBR material with baked texture atlas preferred.
//  10. Scale         : export at real-world scale (1 unit = 1 metre) so the rigger
//                      normalises correctly. Elephant ~4m long, Rex ~6m tall.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MORPHOTYPE, NOPED_SUBTYPE } from './CreatureParams.js';

// ── Per-model catalog ────────────────────────────────────────────────────────

export const MODEL_CREATURE_CATALOG = {
  Elephant: {
    morphotype:  MORPHOTYPE.QUADRUPED,
    biomeTag:    'TEMPERATE',
    label:       'Elephant',
    scale:       1.0,
    bodyHeight:  1.4,
    spineBones:  7,
    tailBones:   3,
    hasLimbs:    true,
    behaviourPreset: 'GRAZER',
  },
  rex: {
    morphotype:      MORPHOTYPE.BIPED,
    biomeTag:        'ARID',
    label:           'Rex',
    scale:           0.9,
    bodyHeight:      1.8,
    spineBones:      8,
    tailBones:       4,
    hasLimbs:        true,
    hipFrac:         0.45,    // legs in lower 45% — same humanoid-style placement
    meshRotationY:   Math.PI, // model faces backward — flip 180°
    shinBendWeight:  0.18,    // thigh-driven stride
    stepHeightMult:  0.30,    // controlled foot lift
    behaviourPreset: 'HUNTER',
  },
  apex: {
    morphotype:  MORPHOTYPE.QUADRUPED,
    biomeTag:    'VOLCANIC',
    label:       'Apex',
    scale:       1.1,
    bodyHeight:  1.2,
    spineBones:  7,
    tailBones:   3,
    hasLimbs:    true,
    behaviourPreset: 'HUNTER',
  },
  skull: {
    morphotype:  MORPHOTYPE.NOPED,
    subtype:     NOPED_SUBTYPE.UNDULATOR,
    biomeTag:    'TOXIC',
    label:       'Skull Serpent',
    scale:       0.7,
    bodyHeight:  0.6,
    spineBones:  10,
    tailBones:   0,
    hasLimbs:    false,
    behaviourPreset: 'STALKER',
  },
  octo: {
    morphotype:  MORPHOTYPE.NOPED,
    subtype:     NOPED_SUBTYPE.FLOATER,
    biomeTag:    'AQUATIC',
    label:       'Octo',
    scale:       1.0,
    bodyHeight:  0.8,
    spineBones:  1,
    tailBones:   8,
    hasLimbs:    false,
    behaviourPreset: 'DRIFTER',
  },
  gek: {
    morphotype:  MORPHOTYPE.QUADRUPED,
    biomeTag:    'LUSH',
    label:       'Gek',
    scale:       0.8,
    bodyHeight:  0.9,
    spineBones:  6,
    tailBones:   4,
    hasLimbs:    true,
    behaviourPreset: 'GRAZER',
  },
  Exo: {
    morphotype:      MORPHOTYPE.BIPED,
    biomeTag:        'TEMPERATE',
    label:           'Exo',
    scale:           1.0,
    bodyHeight:      1.8,
    spineBones:      5,       // torso only (upper 52% of body)
    tailBones:       0,       // no tail
    hasLimbs:        true,
    hipFrac:         0.48,    // legs occupy bottom 48% — hips placed at waist height
    meshRotationY:   -Math.PI / 2,
    yOffset:         1.0,     // lift mesh out of floor
    shinBendWeight:  0.12,    // thigh does the work; shin stays nearly straight
    stepHeightMult:  0.22,    // minimal foot lift
    behaviourPreset: 'STALKER',  // wanders, tracks player with head
  },
  lizzy: {
    morphotype:      MORPHOTYPE.QUADRUPED,
    biomeTag:        'LUSH',   // lush affinity: plant-loving but will react to player
    label:           'Lizzy',
    scale:           1.44,     // 60% larger than original 0.9
    bodyHeight:      0.8,
    spineBones:      8,
    tailBones:       7,        // long tail — more bones = richer wave propagation
    hasLimbs:        true,
    meshRotationY:   -Math.PI / 2,
    tailSwing:       2.2,      // dramatic swoosh amplitude
    shinBendWeight:  0.5,
    stepHeightMult:  0.6,
    behaviourPreset: 'SWARM',  // moves in packs; SWARM has high SAME_SPECIES affinity
  },
  steggy: {
    morphotype:   MORPHOTYPE.QUADRUPED,
    biomeTag:     'TEMPERATE',
    label:        'Steggy',
    scale:        1.2,
    bodyHeight:   1.5,
    spineBones:   8,
    tailBones:    4,
    hasLimbs:     true,
    meshRotationY:   -Math.PI / 2,
    stepHeightMult:  0.25,   // very low foot lift
    shinBendWeight:  0.15,   // thigh does the work; shin stays almost straight
    speedMult:       0.5,
    behaviourPreset: 'GRAZER',
  },
};

// ── Caches ───────────────────────────────────────────────────────────────────

const _loader   = new GLTFLoader();
const _glbCache = new Map();  // modelName → raw THREE.Group from GLTF
const _rigCache = new Map();  // modelName → RigTemplate (computed once)

/**
 * RigTemplate — computed once per model, shared across all instances:
 * {
 *   geo:       THREE.BufferGeometry  — merged, centered, skin-weighted
 *   boneDescs: object[]              — bone descriptor array (positions fixed)
 *   mats:      Material | Material[] — original GLB materials
 *   normScale: number                — longest-axis length (for scaling at spawn)
 *   cfg:       object                — MODEL_CREATURE_CATALOG entry
 * }
 */

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a GLB and compute its rig template.  Call once before spawning.
 * Safe to call multiple times — skips if already cached.
 */
export async function preloadCreatureModel(modelName) {
  if (_rigCache.has(modelName)) return;
  const cfg = MODEL_CREATURE_CATALOG[modelName];
  if (!cfg) { console.warn(`[ModelCreatureRigger] Unknown model: ${modelName}`); return; }

  const url = `./creature-models/${modelName}.glb`;
  try {
    let scene = _glbCache.get(modelName);
    if (!scene) {
      const gltf = await _loader.loadAsync(url);
      scene = gltf.scene;
      _glbCache.set(modelName, scene);
    }
    const template = _computeRigTemplate(scene.clone(true), cfg);
    if (template) {
      _rigCache.set(modelName, template);
      console.log(`[ModelCreatureRigger] Rigged: ${modelName} — ${template.boneDescs.length} bones, ${template.geo.getAttribute('position').count} verts`);
    }
  } catch (e) {
    console.warn(`[ModelCreatureRigger] Failed to load ${url}:`, e.message);
  }
}

/** Pre-load every model in the catalog. */
export async function preloadAllCreatureModels() {
  await Promise.all(Object.keys(MODEL_CREATURE_CATALOG).map(preloadCreatureModel));
}

/**
 * Instantiate a model creature from the cached rig template.
 * Fast — only clones geometry and creates new bone objects.
 * Returns { mesh, bones, boneDescs, skeleton, group } — same shape as generateCreature().
 */
export function rigCreatureModel(modelName, params) {
  const template = _rigCache.get(modelName);
  if (!template) {
    console.warn(`[ModelCreatureRigger] ${modelName} not in rig cache. Call preloadCreatureModel() first.`);
    return null;
  }

  // ── Clone geometry (fast — typed arrays share ArrayBuffer) ──────────────
  const geo = template.geo.clone();

  // ── Fresh bone hierarchy (same positions, independent transform objects) ─
  const threeBones = template.boneDescs.map(bd => {
    const bone = new THREE.Bone();
    bone.name = `${bd.role}_${bd.id}`;
    bone.position.copy(bd.start);
    return bone;
  });
  for (const bd of template.boneDescs) {
    if (bd.parent != null) {
      threeBones[bd.parent].add(threeBones[bd.id]);
      threeBones[bd.id].position.sub(template.boneDescs[bd.parent].start);
    }
  }
  const skeletonRoot = new THREE.Group();
  for (const bd of template.boneDescs) {
    if (bd.parent == null) skeletonRoot.add(threeBones[bd.id]);
  }

  // ── SkinnedMesh ──────────────────────────────────────────────────────────
  const skeleton = new THREE.Skeleton(threeBones);
  const mesh     = new THREE.SkinnedMesh(geo, template.mats);
  if (template.cfg.meshRotationY) mesh.rotation.y = template.cfg.meshRotationY;
  mesh.add(skeletonRoot);
  mesh.bind(skeleton);
  mesh.castShadow     = true;
  mesh.receiveShadow  = true;

  // Scale so the model's longest axis matches bodyLength × scale
  const targetSize = (params.bodyLength || 1.5) * (params.scale || 1.0);
  const finalScale = targetSize / (template.normScale || 1);

  const group = new THREE.Group();
  group.scale.setScalar(finalScale);
  group.add(mesh);

  return { mesh, bones: threeBones, skeleton, boneDescs: template.boneDescs, group };
}

// ── Rig template computation (runs once per model type) ──────────────────────

function _computeRigTemplate(scene, cfg) {
  scene.updateMatrixWorld(true);

  // 1. Collect all meshes in world space
  const parts = [];
  scene.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    obj.updateWorldMatrix(true, false);
    const geo = obj.geometry.clone();
    geo.applyMatrix4(obj.matrixWorld);
    if (!geo.getAttribute('position')) return;
    parts.push({ geo, mat: obj.material });
  });
  if (parts.length === 0) return null;

  // 2. Normalise attribute sets across all meshes
  _normaliseAttributes(parts.map(p => p.geo));

  // 3. Merge into one geometry
  const mergedGeo = mergeGeometries(parts.map(p => p.geo), false) ?? parts[0].geo;

  // 4. Center at origin
  mergedGeo.computeBoundingBox();
  const box    = mergedGeo.boundingBox.clone();
  const centre = box.getCenter(new THREE.Vector3());
  mergedGeo.translate(-centre.x, -centre.y, -centre.z);
  box.translate(centre.clone().negate());

  const size = box.getSize(new THREE.Vector3());

  // Longest axis length — used to normalise scale at spawn time
  const normScale = Math.max(size.x, size.y, size.z);

  // 5. Spine axis detection
  const morph = cfg.morphotype;
  let spineAxis = 'y';
  if (morph === MORPHOTYPE.QUADRUPED) spineAxis = size.x >= size.z ? 'x' : 'z';

  // 6. Build bone descriptors (fixed for this model forever)
  const boneDescs = _buildBoneDescs(cfg, box, size, spineAxis);

  // 7. Assign skin weights
  _assignSkinWeights(mergedGeo, boneDescs);
  mergedGeo.computeVertexNormals();

  // 8. Collect materials
  const mats = parts.length === 1 ? parts[0].mat : parts.map(p => p.mat);

  return { geo: mergedGeo, boneDescs, mats, normScale, cfg };
}

// ── Skeleton construction ────────────────────────────────────────────────────

function _buildBoneDescs(cfg, box, size, spineAxis) {
  if (cfg.morphotype === MORPHOTYPE.NOPED && cfg.subtype === NOPED_SUBTYPE.FLOATER) {
    return _buildFloaterBones(cfg, box, size);
  }

  const boneDescs = [];
  const N       = cfg.spineBones;
  const spineMin = box.min[spineAxis];
  const segLen   = size[spineAxis] / N;
  const bodyR    = Math.min(size.x, size.z, size.y) * 0.28;

  // Y height of spine centreline.
  // For humanoid bipeds with hipFrac: spine starts at waist, not feet.
  // hipFrac = fraction of body height that is legs (0 = no legs, 0.5 = legs are half the body).
  const hipFrac = (cfg.morphotype === MORPHOTYPE.BIPED && cfg.hipFrac) ? cfg.hipFrac : 0;
  const spineY  = cfg.morphotype === MORPHOTYPE.BIPED
    ? box.min.y + size.y * hipFrac   // lift spine base up to hip height
    : box.min.y + size.y * 0.45;

  // ── Spine ──────────────────────────────────────────────────────────────
  let prevId = null;
  for (let i = 0; i < N; i++) {
    const frac = i / (N - 1);
    const s0 = spineMin + i * segLen;
    const s1 = s0 + segLen;
    const arch = Math.sin(frac * Math.PI) * size.y * 0.06;

    const start = new THREE.Vector3(); start[spineAxis] = s0; start.y = spineY + arch;
    const end   = new THREE.Vector3(); end[spineAxis]   = s1;
    end.y = spineY + Math.sin(Math.min(frac + 1 / (N - 1), 1) * Math.PI) * size.y * 0.06;

    let radius = bodyR * (0.65 + 0.35 * Math.sin(frac * Math.PI));
    if (i === 1 || i === N - 2) radius *= 1.2;

    const id = boneDescs.length;
    boneDescs.push({ id, role: 'spine', parent: prevId, start, end, radius });
    prevId = id;
  }

  const frontId = 0, rearId = N - 1;

  // ── Head ───────────────────────────────────────────────────────────────
  // Biped spine runs along Y — the "front" bone (index 0) is the BOTTOM (hips).
  // The head attaches to the TOP spine bone (rearId) and extends upward.
  const headParentId = cfg.morphotype === MORPHOTYPE.BIPED ? rearId : frontId;
  const headStart = boneDescs[headParentId].end.clone();
  const headEnd   = headStart.clone();
  if (cfg.morphotype === MORPHOTYPE.BIPED) {
    headEnd.y += segLen * 0.7;        // head extends upward from top of torso
  } else {
    headEnd[spineAxis] += segLen * 0.6;
    if (cfg.morphotype === MORPHOTYPE.QUADRUPED) headEnd.y += segLen * 0.25;
  }

  const headId = boneDescs.length;
  boneDescs.push({ id: headId, role: 'head', parent: headParentId, name: 'head',
    start: headStart, end: headEnd, radius: bodyR * 0.5 });

  // ── Tail ───────────────────────────────────────────────────────────────
  if (cfg.tailBones > 0) {
    let tailParent = rearId;
    for (let i = 0; i < cfg.tailBones; i++) {
      const frac = (i + 1) / cfg.tailBones;
      const prev = boneDescs[boneDescs.length - 1];
      const ts = (i === 0 ? boneDescs[rearId].end : prev.end).clone();
      const te = ts.clone();
      te[spineAxis] -= segLen * 0.9;
      te.y += segLen * 0.15;
      const tid = boneDescs.length;
      boneDescs.push({ id: tid, role: 'tail', parent: tailParent,
        start: ts, end: te, radius: boneDescs[rearId].radius * (1 - frac * 0.8) });
      tailParent = tid;
    }
  }

  // ── Limbs ──────────────────────────────────────────────────────────────
  if (cfg.hasLimbs) {
    const limbW = Math.min(size.x, size.z) * 0.28;
    // For humanoid bipeds with hipFrac: legs span exactly from hip to foot (hipFrac × height).
    // For generic bipeds (hipFrac=0): use the default 42% estimate.
    const limbH = (cfg.morphotype === MORPHOTYPE.BIPED && hipFrac > 0)
      ? size.y * hipFrac       // legs fill the lower hipFrac portion of the model
      : size.y * 0.42;
    if (cfg.morphotype === MORPHOTYPE.QUADRUPED) {
      _addQuadLimbs(boneDescs, box, size, spineAxis, spineY, limbW, limbH, N);
    } else if (cfg.morphotype === MORPHOTYPE.BIPED) {
      // bottomId=0 — the lowest spine bone, which is now at the hip when hipFrac>0
      _addBipedLimbs(boneDescs, box, size, spineAxis, spineY, limbW, limbH, 0);
    }
  }

  return boneDescs;
}

function _buildFloaterBones(cfg, box, size) {
  const boneDescs = [];
  boneDescs.push({ id: 0, role: 'spine', parent: null,
    start: new THREE.Vector3(0, box.min.y + size.y * 0.3, 0),
    end:   new THREE.Vector3(0, box.min.y + size.y * 0.7, 0),
    radius: Math.min(size.x, size.z) * 0.35 });

  const tc = cfg.tailBones || 8;
  const r  = Math.min(size.x, size.z) * 0.35;
  for (let i = 0; i < tc; i++) {
    const angle = (i / tc) * Math.PI * 2;
    const attach = new THREE.Vector3(Math.cos(angle) * r, box.min.y + size.y * 0.3, Math.sin(angle) * r);
    const tid = boneDescs.length;
    boneDescs.push({ id: tid, role: 'tail', parent: 0,
      start: attach.clone(),
      end: new THREE.Vector3(attach.x * 1.5, attach.y - size.y * 0.6, attach.z * 1.5),
      radius: r * 0.1 });
  }
  return boneDescs;
}

function _addQuadLimbs(descs, _box, size, spineAxis, spineY, limbW, limbH, N) {
  const sideAxis = spineAxis === 'x' ? 'z' : 'x';
  const sideOff  = size[sideAxis] * 0.3;
  const frontIdx = Math.min(1, Math.round(N * 0.2));
  const rearIdx  = Math.max(0, Math.round(N * 0.75));
  const attachIds = [frontIdx, frontIdx, rearIdx, rearIdx];
  const sides     = [+sideOff, -sideOff, +sideOff, -sideOff];

  for (let li = 0; li < 4; li++) {
    const ax = descs[attachIds[li]].start.clone();
    ax[sideAxis] = sides[li];
    ax.y = spineY;

    const upperId = descs.length;
    const kneePos = ax.clone(); kneePos.y -= limbH * 0.5;
    kneePos[spineAxis] += (li < 2 ? +1 : -1) * limbH * 0.15;
    descs.push({ id: upperId, role: 'limb_upper', parent: attachIds[li],
      start: ax.clone(), end: kneePos.clone(), radius: limbW * 1.1 });

    const lowerId = descs.length;
    const footPos = kneePos.clone(); footPos.y -= limbH * 0.5;
    footPos[spineAxis] -= (li < 2 ? +1 : -1) * limbH * 0.1;
    descs.push({ id: lowerId, role: 'limb_lower', parent: upperId,
      start: kneePos.clone(), end: footPos.clone(), radius: limbW * 0.7 });

    const footId = descs.length;
    const toeTip = footPos.clone();
    toeTip[spineAxis] += (li < 2 ? +1 : -1) * limbH * 0.12;
    toeTip.y -= limbH * 0.08;
    descs.push({ id: footId, role: 'foot', parent: lowerId,
      start: footPos.clone(), end: toeTip, radius: limbW * 0.55 });
  }
}

function _addBipedLimbs(descs, _box, size, _spineAxis, spineY, limbW, limbH, bottomId) {
  const sideAxis = 'z';
  const sideOff  = size.z * 0.22;
  for (let li = 0; li < 2; li++) {
    // Use spineY as the hip attachment height so legs start at the correct waist position
    const ax = new THREE.Vector3(0, spineY, 0);
    ax[sideAxis] = li === 0 ? +sideOff : -sideOff;

    const upperId = descs.length;
    const kneePos = ax.clone(); kneePos.y -= limbH * 0.5;
    descs.push({ id: upperId, role: 'limb_upper', parent: bottomId,
      start: ax.clone(), end: kneePos.clone(), radius: limbW * 1.2 });

    const lowerId = descs.length;
    const footPos = kneePos.clone(); footPos.y -= limbH * 0.5;
    descs.push({ id: lowerId, role: 'limb_lower', parent: upperId,
      start: kneePos.clone(), end: footPos.clone(), radius: limbW * 0.8 });

    const footId = descs.length;
    const toeTip = footPos.clone(); toeTip.z += limbH * 0.15; toeTip.y -= limbH * 0.08;
    descs.push({ id: footId, role: 'foot', parent: lowerId,
      start: footPos.clone(), end: toeTip, radius: limbW * 0.6 });
  }
}

// ── Vertex skin weight assignment ────────────────────────────────────────────

const _a   = new THREE.Vector3();
const _b   = new THREE.Vector3();
const _v   = new THREE.Vector3();
const _cl  = new THREE.Vector3();

function _closestOnSeg(v, a, b) {
  _a.subVectors(b, a);
  _b.subVectors(v, a);
  const t = Math.max(0, Math.min(1, _b.dot(_a) / Math.max(_a.dot(_a), 1e-8)));
  return _cl.copy(a).addScaledVector(_a, t);
}

function _assignSkinWeights(geo, boneDescs) {
  const pos = geo.getAttribute('position');
  const N   = pos.count;
  const idx = new Uint16Array(N * 4);
  const wts = new Float32Array(N * 4);

  for (let i = 0; i < N; i++) {
    _v.fromBufferAttribute(pos, i);
    let b0 = 0, d0 = Infinity, b1 = 0, d1 = Infinity;

    for (const bd of boneDescs) {
      const cl = _closestOnSeg(_v, bd.start, bd.end);
      const d  = _v.distanceTo(cl);
      if (d < d0)      { b1 = b0; d1 = d0; b0 = bd.id; d0 = d; }
      else if (d < d1) { b1 = bd.id; d1 = d; }
    }

    const w0 = 1 / (d0 + 1e-4), w1 = 1 / (d1 + 1e-4), wt = w0 + w1;
    idx[i*4] = b0; idx[i*4+1] = b1;
    wts[i*4] = w0 / wt; wts[i*4+1] = w1 / wt;
  }

  geo.setAttribute('skinIndex',  new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(wts, 4));
}

// ── Attribute normalisation ──────────────────────────────────────────────────

function _normaliseAttributes(geos) {
  const present = new Map();
  for (const g of geos) {
    for (const [name, attr] of Object.entries(g.attributes)) {
      if (name === 'skinIndex' || name === 'skinWeight') continue;
      if (!present.has(name)) present.set(name, attr.itemSize);
    }
  }
  for (const g of geos) {
    for (const [name, itemSize] of present) {
      if (!g.getAttribute(name)) {
        const count = g.getAttribute('position').count;
        g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * itemSize), itemSize));
      }
    }
    g.deleteAttribute('skinIndex');
    g.deleteAttribute('skinWeight');
  }
}
