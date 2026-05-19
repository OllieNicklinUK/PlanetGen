// ik.js — FABRIK IK solver for creature limb foot planting.
//
// FABRIK = Forward And Backward Reaching Inverse Kinematics.
// 2 iterations gives visually correct results for 2-3 bone chains.

import * as THREE from 'three';

const _tmp = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Solve a chain of bone tip positions using FABRIK.
 * Mutates the positions[] array in-place.
 *
 * @param {THREE.Vector3[]} positions  World-space positions of each bone tip (length N+1: root + N joints)
 * @param {number[]} lengths           Length of each bone segment (length N)
 * @param {THREE.Vector3} target       IK target in world space
 * @param {THREE.Vector3} root         Fixed root position in world space
 * @param {number} [iterations=2]
 */
export function solveFABRIK(positions, lengths, target, root, iterations = 2) {
  const n = positions.length;
  if (n < 2) return;

  // Check if target is reachable
  const totalLen = lengths.reduce((a, b) => a + b, 0);
  const dist = positions[0].distanceTo(target);
  if (dist > totalLen) {
    // Target out of reach — stretch toward it
    for (let i = 0; i < n - 1; i++) {
      const r = positions[i].distanceTo(target);
      const lambda = lengths[i] / r;
      positions[i + 1].lerpVectors(positions[i], target, lambda);
    }
    return;
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Forward pass — reach tip toward target
    positions[n - 1].copy(target);
    for (let i = n - 2; i >= 0; i--) {
      const r = positions[i + 1].distanceTo(positions[i]);
      const lambda = lengths[i] / r;
      positions[i].lerpVectors(positions[i + 1], positions[i], lambda);
    }

    // Backward pass — re-anchor root
    positions[0].copy(root);
    for (let i = 0; i < n - 1; i++) {
      const r = positions[i].distanceTo(positions[i + 1]);
      const lambda = lengths[i] / r;
      positions[i + 1].lerpVectors(positions[i], positions[i + 1], lambda);
    }
  }
}

/**
 * Update a THREE.Bone chain to match solved FABRIK positions.
 * Each bone's .position is set in local space by back-solving from world positions.
 *
 * @param {THREE.Bone[]} bones  Array of THREE.Bone objects (must be in a hierarchy)
 * @param {THREE.Vector3[]} worldPositions  World-space positions from solveFABRIK output
 */
export function applyFABRIKToBones(bones, worldPositions) {
  for (let i = 0; i < bones.length - 1; i++) {
    const bone = bones[i];
    const from = worldPositions[i];
    const to   = worldPositions[i + 1];

    _dir.subVectors(to, from).normalize();

    // Set bone quaternion to rotate Y+ toward direction vector
    bone.quaternion.setFromUnitVectors(_up, _dir);
  }
}

const _up = new THREE.Vector3(0, 1, 0);

/**
 * Fast analytic 2-bone IK (law of cosines).
 * Returns the elbow/knee world position for a 2-bone chain.
 *
 * @param {THREE.Vector3} root    Root joint position (world)
 * @param {THREE.Vector3} target  End-effector target (world)
 * @param {number} len1           Length of upper segment
 * @param {number} len2           Length of lower segment
 * @param {THREE.Vector3} poleDir Pole vector (determines which way the knee bends)
 * @param {THREE.Vector3} out     Result: mid-joint world position
 * @returns {THREE.Vector3}       out, the computed mid-joint position
 */
export function solve2Bone(root, target, len1, len2, poleDir, out) {
  const dt = root.distanceTo(target);
  const d  = Math.min(dt, len1 + len2 - 0.001);

  // Law of cosines: angle at root
  const cosAngle = (len1 * len1 + d * d - len2 * len2) / (2 * len1 * d);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

  // Direction from root to target
  _dir.subVectors(target, root).normalize();

  // Perpendicular (pole) direction in the plane of root→target
  _tmp.copy(poleDir).sub(_dir.clone().multiplyScalar(_dir.dot(poleDir))).normalize();

  // Mid joint = root + rotation in plane
  out.copy(root)
    .addScaledVector(_dir, Math.cos(angle) * len1)
    .addScaledVector(_tmp, Math.sin(angle) * len1);

  return out;
}
