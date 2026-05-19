// CreatureGenerator.js — V2.3: enhanced V1 per-bone tubes.
//
// Uses the proven V1 approach (one tube per bone, mergeVertices at junctions)
// but with higher geometry detail:
//   - 10+ sided cross-sections (was 4-8)
//   - 4 rings per bone (was 2) for smoother skinning deformation
//   - Elliptical body cross-sections (wider than tall)
//   - V2 materials, eyes with pupils
//
// This avoids the chain-folding issues from V2.0-V2.2 while looking much
// better than V1's low-poly tubes.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { simplex3, mix, smoothstep } from './simplex3.js';
import { MORPHOTYPE, NOPED_SUBTYPE } from './CreatureParams.js';
import { createCreatureMaterial } from './creature-material.js';
import { CreatureAssembler } from './CreatureAssembler.js';

const assembler = new CreatureAssembler();

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_SIDES      = 10;
const BODY_RINGS     = 4;   // rings per spine/neck/head/tail bone
const LIMB_RINGS     = 3;   // rings per limb bone

// ── Helpers ──────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Build a multi-ring tube segment between two points.
 * Ring at t=0 is weighted to boneIndex0, ring at t=1 to boneIndex1.
 * Supports elliptical cross-sections via widthMul/heightMul.
 */
function buildTubeSegment(start, end, r0, r1, sides, rings, boneIndex0, boneIndex1, widthMul, heightMul) {
  const tangent = new THREE.Vector3().subVectors(end, start).normalize();
  if (tangent.lengthSq() < 0.0001) tangent.set(0, 1, 0);

  const ref = Math.abs(tangent.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(tangent, ref).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, tangent).normalize();

  const positions = [], normals = [], uvs = [], indices = [];
  const boneIdx = [], weights = [];
  const center = new THREE.Vector3();

  for (let ri = 0; ri <= rings; ri++) {
    const t = ri / rings;
    center.lerpVectors(start, end, t);
    const r = lerp(r0, r1, t);
    const rW = r * widthMul;
    const rH = r * heightMul;

    for (let vi = 0; vi < sides; vi++) {
      const angle = (vi / sides) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const vx = center.x + cosA * right.x * rW + sinA * realUp.x * rH;
      const vy = center.y + cosA * right.y * rW + sinA * realUp.y * rH;
      const vz = center.z + cosA * right.z * rW + sinA * realUp.z * rH;
      positions.push(vx, vy, vz);

      // Outward normal from ring centre
      const nx = vx - center.x, ny = vy - center.y, nz = vz - center.z;
      const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      normals.push(nx/nl, ny/nl, nz/nl);

      uvs.push(vi / sides, t);

      // Skinning: blend from bone0 at t=0 to bone1 at t=1
      // (same assignment as V1 at the endpoints)
      boneIdx.push(boneIndex0, boneIndex1, 0, 0);
      weights.push(1 - t, t, 0, 0);
    }
  }

  // Quad indices
  for (let ri = 0; ri < rings; ri++) {
    for (let vi = 0; vi < sides; vi++) {
      const a = ri * sides + vi;
      const b = ri * sides + (vi + 1) % sides;
      const c = (ri + 1) * sides + vi;
      const d = (ri + 1) * sides + (vi + 1) % sides;
      indices.push(a, b, d,  a, d, c);
    }
  }

  return { positions, normals, uvs, indices, boneIdx, weights };
}

function segToGeo(seg) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg.positions), 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(seg.normals), 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(seg.uvs), 2));
  geo.setIndex(seg.indices);
  geo.setAttribute('skinIndex',  new THREE.Uint16BufferAttribute(new Uint16Array(seg.boneIdx), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(seg.weights), 4));
  return geo;
}

// ── Skeleton builders (unchanged) ────────────────────────────────────────────

function buildQuadrupedSkeleton(p) {
  const bones = [];
  const { bodyLength, bodyWidth, bodyHeight, spineSegments, neckLength, headScale,
          tailLength, tailSegments, limbLength, limbWidth, footSize, digitigrade } = p;
  const segLen = bodyLength / spineSegments;

  let prevId = null;
  for (let i = 0; i < spineSegments; i++) {
    const frac = i / (spineSegments - 1);
    const yCurve = Math.sin(frac * Math.PI) * bodyHeight * 0.12;
    const sx = -bodyLength / 2 + i * segLen;
    const ex = sx + segLen;
    const taper = 0.6 + 0.4 * Math.sin(frac * Math.PI);
    let radius = bodyWidth * 0.5 * taper;
    if (i === 1 || i === spineSegments - 2) radius *= 1.25;
    const id = bones.length;
    bones.push({ id, role: 'spine', parent: prevId,
      start: new THREE.Vector3(sx, yCurve, 0),
      end: new THREE.Vector3(ex, yCurve + (i < spineSegments-1 ? Math.sin((i+1)/(spineSegments-1)*Math.PI)*bodyHeight*0.12 - yCurve : 0), 0),
      radius });
    prevId = id;
  }
  const frontSpineId = 0, rearSpineId = spineSegments - 1;

  if (neckLength > 0.1) {
    const neckSegs = Math.max(1, Math.round(neckLength / 0.3));
    let neckParent = frontSpineId;
    for (let i = 0; i < neckSegs; i++) {
      const frac = i / neckSegs;
      const angle = -Math.PI * 0.2 - frac * 0.3;
      const id = bones.length;
      const prev = bones[id - 1] || bones[frontSpineId];
      bones.push({ id, role: 'neck', parent: neckParent,
        start: prev.end.clone(),
        end: new THREE.Vector3(prev.end.x+Math.cos(angle)*(neckLength/neckSegs), prev.end.y+Math.sin(-angle)*(neckLength/neckSegs), 0),
        radius: bodyWidth * 0.25 * (1 - frac * 0.3) });
      neckParent = id;
    }
    const neckTip = bones[bones.length - 1];
    bones.push({ id: bones.length, role: 'head', name: 'head', parent: neckTip.id,
      start: neckTip.end.clone(),
      end: neckTip.end.clone().addScaledVector(new THREE.Vector3(1, 0.15, 0).normalize(), bodyWidth*headScale*0.8),
      radius: bodyWidth * headScale * 0.55 });
  }

  if (tailLength > 0.1 && tailSegments > 0) {
    const rearBone = bones[rearSpineId];
    const tailSegLen = tailLength / tailSegments;
    let tailParent = rearSpineId;
    for (let i = 0; i < tailSegments; i++) {
      const frac = (i+1)/tailSegments;
      const prev = bones[bones.length-1];
      const angle = 0.15*i;
      const id = bones.length;
      bones.push({ id, role: 'tail', parent: tailParent,
        start: (i===0 ? rearBone.end : prev.end).clone(),
        end: new THREE.Vector3(
          (i===0?rearBone.end.x:prev.end.x)+Math.cos(angle)*tailSegLen,
          (i===0?rearBone.end.y:prev.end.y)+Math.sin(angle)*tailSegLen*0.5, 0),
        radius: rearBone.radius*(1-frac*0.85) });
      tailParent = id;
    }
  }

  const limbAttachIds = [1, 1, spineSegments-2, spineSegments-2];
  const limbSideZ = [bodyWidth*0.5, -bodyWidth*0.5, bodyWidth*0.5, -bodyWidth*0.5];
  for (let li = 0; li < 4; li++) {
    const attachBone = bones[limbAttachIds[li]];
    const attach = attachBone.start.clone().add(new THREE.Vector3(0, 0, limbSideZ[li]*0.8));
    const upperId = bones.length;
    const kneeDir = digitigrade ? -0.35 : 0.3;
    const midPos = new THREE.Vector3(attach.x+kneeDir*limbLength*0.4, attach.y-limbLength*0.5, attach.z);
    const lowPos = new THREE.Vector3(midPos.x-kneeDir*limbLength*0.4, midPos.y-limbLength*0.5, attach.z);
    bones.push({ id: upperId, role: 'limb_upper', parent: limbAttachIds[li],
      start: attach.clone(), end: midPos.clone(), radius: limbWidth*1.2 });
    const lowerId = bones.length;
    bones.push({ id: lowerId, role: 'limb_lower', parent: upperId,
      start: midPos.clone(), end: lowPos.clone(), radius: limbWidth*0.75 });
    bones.push({ id: bones.length, role: 'foot', parent: lowerId,
      start: lowPos.clone(), end: lowPos.clone().add(new THREE.Vector3(0.1,-footSize*0.5,0)), radius: footSize });
  }
  return bones;
}

function buildBipedSkeleton(p) {
  const bones = [];
  const { bodyLength, bodyWidth, spineSegments, neckLength, headScale, limbLength, limbWidth, footSize, digitigrade } = p;
  const segLen = bodyLength / spineSegments;
  let prevId = null;
  for (let i = 0; i < spineSegments; i++) {
    const frac = i/(spineSegments-1);
    const id = bones.length;
    let radius = bodyWidth*0.5*(0.7+0.3*Math.sin(frac*Math.PI));
    if (i===0||i===Math.floor(spineSegments*0.7)) radius*=1.2;
    bones.push({ id, role: 'spine', parent: prevId,
      start: new THREE.Vector3(0.25*frac*bodyLength, i*segLen, 0),
      end: new THREE.Vector3(0.25*(frac+1/(spineSegments-1))*bodyLength, (i+1)*segLen, 0), radius });
    prevId = id;
  }
  const topSpineId = spineSegments-1, neckId = bones.length;
  bones.push({ id: neckId, role: 'neck', parent: topSpineId,
    start: bones[topSpineId].end.clone(), end: bones[topSpineId].end.clone().add(new THREE.Vector3(0.1,neckLength,0)), radius: bodyWidth*0.22 });
  bones.push({ id: bones.length, role: 'head', name: 'head', parent: neckId,
    start: bones[neckId].end.clone(), end: bones[neckId].end.clone().add(new THREE.Vector3(0.1,bodyWidth*headScale*0.7,0)), radius: bodyWidth*headScale*0.5 });
  for (let li = 0; li < 2; li++) {
    const side = li===0?1:-1;
    const attach = bones[0].start.clone().add(new THREE.Vector3(0,0,side*bodyWidth*0.4));
    const upperId = bones.length;
    const mid = new THREE.Vector3(attach.x+(digitigrade?0.3:-0.2)*limbLength*0.5, attach.y-limbLength*0.5, attach.z);
    const low = new THREE.Vector3(mid.x-(digitigrade?0.3:-0.2)*limbLength*0.5, mid.y-limbLength*0.5, attach.z);
    bones.push({ id: upperId, role: 'limb_upper', parent: 0, start: attach.clone(), end: mid.clone(), radius: limbWidth*1.3 });
    const lowerId = bones.length;
    bones.push({ id: lowerId, role: 'limb_lower', parent: upperId, start: mid.clone(), end: low.clone(), radius: limbWidth*0.8 });
    bones.push({ id: bones.length, role: 'foot', parent: lowerId, start: low.clone(), end: low.clone().add(new THREE.Vector3(0.15,-footSize*0.4,0)), radius: footSize });
  }
  return bones;
}

function buildNopedSkeleton(p) {
  const bones = [];
  const { subtype, bodyLength, bodyWidth } = p;
  if (subtype === NOPED_SUBTYPE.UNDULATOR) {
    const segs = p.undulatorSegments||12, segLen = bodyLength/segs;
    let prevId = null;
    for (let i = 0; i < segs; i++) {
      const radius = bodyWidth*0.4*(1-(i/segs)*0.5);
      const id = bones.length;
      bones.push({ id, role: 'spine', parent: prevId,
        start: new THREE.Vector3(-bodyLength/2+i*segLen,0,0), end: new THREE.Vector3(-bodyLength/2+(i+1)*segLen,0,0), radius });
      prevId = id;
    }
  } else if (subtype === NOPED_SUBTYPE.FLOATER) {
    bones.push({ id: 0, role: 'spine', parent: null,
      start: new THREE.Vector3(0,0,0), end: new THREE.Vector3(0,bodyWidth*0.8,0), radius: bodyWidth*0.7 });
    const tc = p.tentacleCount||6;
    for (let i = 0; i < tc; i++) {
      const angle = (i/tc)*Math.PI*2;
      const attach = new THREE.Vector3(Math.cos(angle)*bodyWidth*0.5,-0.1,Math.sin(angle)*bodyWidth*0.5);
      bones.push({ id: bones.length, role: 'tail', parent: 0,
        start: attach.clone(), end: new THREE.Vector3(attach.x*1.2,attach.y-bodyWidth*1.2,attach.z*1.2), radius: bodyWidth*0.06 });
    }
  }
  return bones;
}

// ── Main export ──────────────────────────────────────────────────────────────

export function generateCreature(p, biomeTag = 'TEMPERATE') {
  let boneDescs;
  if      (p.morphotype === MORPHOTYPE.QUADRUPED) boneDescs = buildQuadrupedSkeleton(p);
  else if (p.morphotype === MORPHOTYPE.BIPED)     boneDescs = buildBipedSkeleton(p);
  else                                             boneDescs = buildNopedSkeleton(p);

  const sides = Math.max(MIN_SIDES, p.bodySegments);
  const geometries = [];

  // ── Build one tube per bone (V1 approach with higher detail) ──────────
  for (let bi = 0; bi < boneDescs.length; bi++) {
    const bd = boneDescs[bi];
    const r0 = bd.radius;
    const r1 = bd.radius * (bd.role === 'spine' ? 1.0 : 0.7);
    const isBody = (bd.role === 'spine' || bd.role === 'neck' || bd.role === 'head');
    const isLimb = (bd.role === 'limb_upper' || bd.role === 'limb_lower' || bd.role === 'foot');
    const rings = isLimb ? LIMB_RINGS : BODY_RINGS;
    const tubeSides = isLimb ? Math.max(8, sides - 2) : sides;

    // Elliptical body, circular limbs
    const wMul = isBody ? 1.3 : 1.0;
    const hMul = isBody ? 0.9 : 1.0;

    // Skinning: same as V1 — start ring = current bone, end ring = parent
    const boneIdx0 = bi;
    const boneIdx1 = bd.parent !== null ? bd.parent : bi;

    const seg = buildTubeSegment(bd.start, bd.end, r0, r1, tubeSides, rings, boneIdx0, boneIdx1, wMul, hMul);
    geometries.push(segToGeo(seg));
  }

  // ── Merge + Weld ──────────────────────────────────────────────────────
  let mergedGeo = mergeGeometries(geometries, false);
  mergedGeo = mergeVertices(mergedGeo, 0.001);
  mergedGeo.computeVertexNormals();

  // ── Per-vertex colour ─────────────────────────────────────────────────
  const posAttr = mergedGeo.getAttribute('position');
  const colArray = new Float32Array(posAttr.count * 3);
  const colorA = new THREE.Color(p.skinColorA);
  const colorB = new THREE.Color(p.skinColorB);
  for (let i = 0; i < posAttr.count; i++) {
    const px = posAttr.getX(i), py = posAttr.getY(i), pz = posAttr.getZ(i);
    let t = 0;
    if (p.patternType === 'stripe') t = (Math.sin(py*p.patternScale*4.0)+1.0)*0.5;
    else if (p.patternType === 'spot') t = simplex3(px*p.patternScale,py*p.patternScale,pz*p.patternScale) > 0.2 ? 1.0 : 0.0;
    else if (p.patternType === 'noise') t = smoothstep(0.3,0.7,(simplex3(px*p.patternScale,py*p.patternScale,pz*p.patternScale)+1.0)*0.5);
    colArray[i*3]   = mix(colorA.r, colorB.r, t);
    colArray[i*3+1] = mix(colorA.g, colorB.g, t);
    colArray[i*3+2] = mix(colorA.b, colorB.b, t);
  }
  mergedGeo.setAttribute('color', new THREE.BufferAttribute(colArray, 3));

  // ── THREE.Bone hierarchy ──────────────────────────────────────────────
  const threeBones = boneDescs.map(bd => {
    const bone = new THREE.Bone();
    bone.name = bd.name || `${bd.role}_${bd.id}`;
    bone.position.copy(bd.start);
    return bone;
  });
  for (const bd of boneDescs) {
    if (bd.parent !== null && bd.parent !== undefined) {
      threeBones[bd.parent].add(threeBones[bd.id]);
      threeBones[bd.id].position.sub(boneDescs[bd.parent].start);
    }
  }
  const skeletonRoot = new THREE.Group();
  for (const bd of boneDescs) {
    if (bd.parent === null || bd.parent === undefined) skeletonRoot.add(threeBones[bd.id]);
  }

  const skeleton = new THREE.Skeleton(threeBones);
  const material = createCreatureMaterial(p);
  const mesh = new THREE.SkinnedMesh(mergedGeo, material);
  mesh.add(skeletonRoot);
  mesh.bind(skeleton);
  mesh.castShadow = true;

  const group = new THREE.Group();
  group.scale.setScalar(p.scale);
  group.add(mesh);

  // ── Assembler (V3) ────────────────────────────────────────────────────────
  assembler.assembleParts(group, skeleton, p, biomeTag, () => Math.random()); 

  return { mesh, bones: threeBones, skeleton, boneDescs, group };
}

export function disposeCreature(creatureData) {
  const { mesh, group } = creatureData;
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
  else mesh.material?.dispose();
  if (group.parent) group.parent.remove(group);
}
