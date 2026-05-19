/**
 * Exports the current lobby layout as a Three.js JSON scene file.
 * Load the output in the Three.js editor via File → Import.
 *
 * Usage: node scripts/export-lobby-scene.js
 */

import * as THREE from 'three';
import { writeFileSync } from 'fs';

const LOBBY_Y = 1;

const DESTINATIONS = [
  { label: 'PlanetGen World', color: '#44ff88' },
  { label: 'Snow World',      color: '#88ddff' },
  { label: 'Splat World',     color: '#ff44ff' },
  { label: 'Prop Library',    color: '#ffaa00' },
  { label: 'Google → 3DGS',   color: '#00ffff' },
  { label: 'Warehouse CQB',   color: '#64c8ff' },
];

const scene = new THREE.Scene();
scene.name = 'LobbyScene';
scene.background = new THREE.Color(0x0c1228);

// ─── Lights ───────────────────────────────────────────────────────────────────

const ambient = new THREE.AmbientLight(0x8899bb, 1.8);
ambient.name = 'ambient';
scene.add(ambient);

const hemi = new THREE.HemisphereLight(0x6688dd, 0x223344, 2.0);
hemi.name = 'hemi';
scene.add(hemi);

const fill = new THREE.PointLight(0x7788cc, 3.0, 60, 1.5);
fill.name = 'fill_light';
fill.position.set(0, LOBBY_Y + 12, 0);
scene.add(fill);

const warm = new THREE.PointLight(0x7c5cff, 1.5, 40, 2);
warm.name = 'warm_light';
warm.position.set(0, LOBBY_Y + 1, 0);
scene.add(warm);

// ─── Floor ────────────────────────────────────────────────────────────────────
// Canvas hex texture can't run in Node — use a placeholder material.
// Re-apply the hex CanvasTexture in lobby-system after loading.

const floor = new THREE.Mesh(
  new THREE.BoxGeometry(80, 1, 80),
  new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.6, metalness: 0.4 }),
);
floor.name = 'floor';
floor.position.y = LOBBY_Y - 0.5;
floor.receiveShadow = true;
scene.add(floor);

// ─── Portals ──────────────────────────────────────────────────────────────────

const count = DESTINATIONS.length;

for (let i = 0; i < count; i++) {
  const dest  = DESTINATIONS[i];
  const t     = count > 1 ? i / (count - 1) : 0.5;
  const angle = THREE.MathUtils.degToRad(-144 + t * 288);
  const R     = 11;
  const x     = Math.sin(angle) * R;
  const z     = -Math.cos(angle) * R;

  const group = new THREE.Group();
  group.name = `portal_${i}`;
  group.position.set(x, LOBBY_Y, z);
  group.lookAt(new THREE.Vector3(0, LOBBY_Y, 0));

  // Hexagonal pedestal
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.5, 0.6, 6),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(dest.color).multiplyScalar(0.2),
      emissive: new THREE.Color(dest.color),
      emissiveIntensity: 0.05,
      metalness: 0.9,
      roughness: 0.15,
    }),
  );
  pedestal.name = 'pedestal';
  pedestal.position.y = 0.3;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  // Outer glow ring
  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.04, 8, 64),
    new THREE.MeshBasicMaterial({ color: dest.color }),
  );
  outerRing.name = 'ring_outer';
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = 0.62;
  group.add(outerRing);

  // Inner glow ring
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.02, 8, 48),
    new THREE.MeshBasicMaterial({ color: dest.color, transparent: true, opacity: 0.4 }),
  );
  innerRing.name = 'ring_inner';
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.63;
  group.add(innerRing);

  scene.add(group);

  // Spotlight above the pedestal — must be added to scene (not group) so
  // target works correctly in the editor.
  const spot = new THREE.SpotLight(new THREE.Color(dest.color), 40, 15, 0.45, 0.6, 1);
  spot.name = `spot_${i}`;
  spot.position.set(x, LOBBY_Y + 7, z);
  spot.target.name = `spot_target_${i}`;
  spot.target.position.set(x, LOBBY_Y, z);
  scene.add(spot);
  scene.add(spot.target);
}

// ─── Export ───────────────────────────────────────────────────────────────────

const json = JSON.stringify(scene.toJSON(), null, 2);
writeFileSync('public/lobby-sandbox.json', json);
console.log('✓ Written public/lobby-sandbox.json');
console.log('  Open the Three.js editor → File → Import → select this file');
