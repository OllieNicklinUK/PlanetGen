// player-abilities.js — Shoot (left mouse) and Jetpack (Space hold).

import * as THREE from 'three';
import { getTerrainHeight } from './noise.js';

const SHOOT_RANGE    = 400;
const SHOOT_COOLDOWN = 0.22;
const LASER_LENGTH   = 120;
const JETPACK_RISE   = 12;   // m/s upward impulse per second

export class PlayerAbilities {
  constructor(scene, camera, characterPhysics, creatureManager, terrainManager) {
    this._scene   = scene;
    this._camera  = camera;
    this._physics = characterPhysics; // BvhCharacterPhysics — applyVelocity()
    this._cm      = creatureManager;
    this._tm      = terrainManager ?? null;

    this._jetpackHeld = false;
    this._shootCD     = 0;

    this._ray    = new THREE.Raycaster();
    this._ray.far = SHOOT_RANGE;
    this._origin = new THREE.Vector3();
    this._dir    = new THREE.Vector3();
    this._quat   = new THREE.Quaternion();

    // Targeting beam — thin dim guide ray always on
    const guideGeo = new THREE.BoxGeometry(0.008, 0.008, LASER_LENGTH);
    const guideMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.35 });
    const guideMesh = new THREE.Mesh(guideGeo, guideMat);
    guideMesh.position.z = -LASER_LENGTH / 2;
    camera.add(guideMesh);

    // Shoot beam — bright pulse shown on fire then fades
    const beamGeo = new THREE.BoxGeometry(0.06, 0.06, LASER_LENGTH);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0 });
    this._beamMesh = new THREE.Mesh(beamGeo, beamMat);
    this._beamMesh.position.z = -LASER_LENGTH / 2;
    this._beamOpacity = 0;
    camera.add(this._beamMesh);

    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerdown', e => {
      if (e.button === 0) this._shoot();
    });
    document.addEventListener('keydown', e => {
      if (e.code === 'Space') { e.preventDefault(); this._jetpackHeld = true; }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space') this._jetpackHeld = false;
    });
  }

  update(delta) {
    this._shootCD = Math.max(0, this._shootCD - delta);

    if (this._jetpackHeld && this._physics) {
      this._physics.applyVelocity(new THREE.Vector3(0, JETPACK_RISE * delta, 0));
    }

    if (this._beamOpacity > 0) {
      this._beamOpacity = Math.max(0, this._beamOpacity - delta * 6);
      this._beamMesh.material.opacity = this._beamOpacity;
    }
  }

  _shoot() {
    if (this._shootCD > 0) return;
    this._shootCD = SHOOT_COOLDOWN;

    this._camera.getWorldPosition(this._origin);
    this._camera.getWorldQuaternion(this._quat);
    this._dir.set(0, 0, -1).applyQuaternion(this._quat).normalize();
    this._ray.set(this._origin, this._dir);

    const creatureMeshes = this._cm?._creatures
      ?.filter(c => c.mesh && !c.fsm?.collapsed)
      ?.map(c => c.mesh) ?? [];
    const creatureHits = creatureMeshes.length
      ? this._ray.intersectObjects(creatureMeshes, false) : [];

    const buildingMeshes = this._tm ? this._tm.buildingMeshes : [];
    const buildingHits   = buildingMeshes.length
      ? this._ray.intersectObjects(buildingMeshes, false) : [];

    this._beamOpacity = 1.0;
    this._beamMesh.material.opacity = 1.0;

    const bestCreature = creatureHits[0];
    const bestBuilding = buildingHits[0];
    if (!bestCreature && !bestBuilding) return;

    if (bestCreature && (!bestBuilding || bestCreature.distance <= bestBuilding.distance)) {
      const target = this._cm._creatures.find(c => c.mesh === bestCreature.object);
      if (target) { this._cm.hitCreature(target); this._impactFlash(bestCreature.point); }
    } else if (bestBuilding) {
      const id = bestBuilding.object.userData.buildingId;
      if (id && this._tm) {
        const pos = this._tm.destroyBuilding(id);
        if (pos) this._buildingDebris(pos, bestBuilding.point);
      }
    }
  }

  _impactFlash(point) {
    const geo  = new THREE.SphereGeometry(0.3, 6, 6);
    const mat  = new THREE.MeshBasicMaterial({ color: 0xffaa22 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    this._scene.add(mesh);
    let t = 0;
    const tick = () => {
      t += 0.06;
      mesh.scale.setScalar(1 + t * 2.5);
      mat.opacity = Math.max(0, 1 - t * 2.5); mat.transparent = true;
      if (t < 0.45) requestAnimationFrame(tick);
      else { this._scene.remove(mesh); geo.dispose(); mat.dispose(); }
    };
    tick();
  }

  _buildingDebris(buildingPos, hitPoint) {
    this._impactFlash(hitPoint);
    const scene  = this._scene;
    const pieces = [];
    const PIECE_COUNT = 8;
    for (let i = 0; i < PIECE_COUNT; i++) {
      const size = 0.7 + Math.random() * 2.2;
      const geo  = new THREE.BoxGeometry(size, size * (0.5 + Math.random()), size);
      const grey = 0.30 + Math.random() * 0.28;
      const mat  = new THREE.MeshStandardMaterial({
        color: new THREE.Color(grey, grey * 0.93, grey * 0.88),
        roughness: 0.9, metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        hitPoint.x + (Math.random() - 0.5) * 4,
        hitPoint.y + Math.random() * 3,
        hitPoint.z + (Math.random() - 0.5) * 4,
      );
      mesh.rotation.set(
        Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI,
      );
      scene.add(mesh);
      pieces.push({ mesh, geo, mat, vy: 4 + Math.random() * 6, age: 0 });
    }
    const animate = () => {
      let alive = false;
      for (const p of pieces) {
        p.age += 0.016;
        p.vy  -= 9.8 * 0.016;
        p.mesh.position.y += p.vy * 0.016;
        p.mesh.rotation.x += 0.04; p.mesh.rotation.z += 0.03;
        if (p.age < 2.5) alive = true;
        else { scene.remove(p.mesh); p.geo.dispose(); p.mat.dispose(); }
      }
      if (alive) requestAnimationFrame(animate);
    };
    animate();
  }
}
