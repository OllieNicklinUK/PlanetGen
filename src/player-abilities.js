// player-abilities.js — Shoot (left mouse) and Jetpack (right mouse hold).
//
// LASER  : Thin beam attached directly to player.head — follows view automatically.
//
// SHOOT  : Hitscan raycast from head forward; nearest creature hit within 400 m
//          collapses via bone rig animation then recycles.
//
// JETPACK: Kinematic LocomotionEnvironment platform under the player's feet.
//          When right mouse is held the platform rises; the IWSDK locomotion
//          system stands on it and lifts the player naturally.
//          Releasing the right button drops the platform back to terrain level.

import * as THREE from 'three';
import { LocomotionEnvironment } from '@iwsdk/core';
import { getTerrainHeight } from './noise.js';

const SHOOT_RANGE    = 400;
const SHOOT_COOLDOWN = 0.22;
const LASER_LENGTH   = 120;   // metres
const JETPACK_RISE   = 12;    // m/s upward when held
const JETPACK_FALL   = 8;     // m/s drop back to terrain
const JETPACK_SPEED  = 200;
const NORMAL_SPEED   = 50;

export class PlayerAbilities {
  constructor(world, player, locoSys, creatureManager, terrainManager) {
    this._world = world;
    this._player = player;
    this._loco = locoSys;
    this._cm = creatureManager;
    this._tm = terrainManager ?? null;

    this._jetpackHeld = false;
    this._platformY   = null;   // null until first playerPos known
    this._shootCD     = 0;

    this._ray    = new THREE.Raycaster();
    this._ray.far = SHOOT_RANGE;
    this._origin = new THREE.Vector3();
    this._dir    = new THREE.Vector3();
    this._quat   = new THREE.Quaternion();

    // ── Persistent targeting beam — thin dim guide ray, always on
    const guideGeo = new THREE.BoxGeometry(0.008, 0.008, LASER_LENGTH);
    const guideMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.35 });
    const guideMesh = new THREE.Mesh(guideGeo, guideMat);
    guideMesh.position.z = -LASER_LENGTH / 2;
    player.head.add(guideMesh);

    // ── Shoot beam — bright wide pulse, shown on fire then fades
    const beamGeo = new THREE.BoxGeometry(0.06, 0.06, LASER_LENGTH);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0 });
    this._beamMesh = new THREE.Mesh(beamGeo, beamMat);
    this._beamMesh.position.z = -LASER_LENGTH / 2;
    this._beamOpacity = 0;
    player.head.add(this._beamMesh);

    // ── Jetpack platform — invisible kinematic LocomotionEnvironment
    const platGeo  = new THREE.PlaneGeometry(3, 3);
    platGeo.rotateX(-Math.PI / 2);                   // make it horizontal
    const platMat  = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this._platMesh = new THREE.Mesh(platGeo, platMat);
    this._platEntity = world.createTransformEntity(this._platMesh, {
      parent: world.sceneEntity, persistent: true,
    });
    this._platEntity.addComponent(LocomotionEnvironment, { type: 'kinematic' });

    // ── Input ────────────────────────────────────────────────────────────
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

  // ── Called each frame from WorldSystem.update() ──────────────────────────

  update(delta) {
    this._shootCD = Math.max(0, this._shootCD - delta);
    this._updateJetpack(delta);

    // Fade the shoot beam out each frame
    if (this._beamOpacity > 0) {
      this._beamOpacity = Math.max(0, this._beamOpacity - delta * 6);
      this._beamMesh.material.opacity = this._beamOpacity;
    }
  }

  // ── Shoot ────────────────────────────────────────────────────────────────

  _shoot() {
    if (this._shootCD > 0) return;
    this._shootCD = SHOOT_COOLDOWN;

    const head = this._player?.head;
    if (!head) return;

    head.getWorldPosition(this._origin);
    head.getWorldQuaternion(this._quat);
    this._dir.set(0, 0, -1).applyQuaternion(this._quat).normalize();
    this._ray.set(this._origin, this._dir);

    // Test creatures (skipped when creature manager is disabled)
    const creatureMeshes = this._cm?._creatures
      ?.filter(c => c.mesh && !c.fsm?.collapsed)
      ?.map(c => c.mesh) ?? [];
    const creatureHits = creatureMeshes.length
      ? this._ray.intersectObjects(creatureMeshes, false) : [];

    // Test buildings
    const buildingMeshes = this._tm ? this._tm.buildingMeshes : [];
    const buildingHits = buildingMeshes.length
      ? this._ray.intersectObjects(buildingMeshes, false) : [];

    // Flash the shoot beam regardless of what was hit
    this._beamOpacity = 1.0;
    this._beamMesh.material.opacity = 1.0;

    const bestCreature = creatureHits[0];
    const bestBuilding = buildingHits[0];

    if (!bestCreature && !bestBuilding) return;

    // Pick the closer of the two hit types
    if (bestCreature && (!bestBuilding || bestCreature.distance <= bestBuilding.distance)) {
      const target = this._cm._creatures.find(c => c.mesh === bestCreature.object);
      if (target) {
        this._cm.hitCreature(target);
        this._impactFlash(bestCreature.point);
      }
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
    this._world.scene.add(mesh);
    let t = 0;
    const tick = () => {
      t += 0.06;
      mesh.scale.setScalar(1 + t * 2.5);
      mat.opacity = Math.max(0, 1 - t * 2.5); mat.transparent = true;
      if (t < 0.45) requestAnimationFrame(tick);
      else { this._world.scene.remove(mesh); geo.dispose(); mat.dispose(); }
    };
    tick();
  }

  _buildingDebris(buildingPos, hitPoint) {
    this._impactFlash(hitPoint);

    const scene = this._world.scene;
    const pieces = [];
    const PIECE_COUNT = 8;

    for (let i = 0; i < PIECE_COUNT; i++) {
      const size = 0.7 + Math.random() * 2.2;
      const geo = new THREE.BoxGeometry(size, size * (0.5 + Math.random()), size);
      const grey = 0.30 + Math.random() * 0.28;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(grey, grey * 0.93, grey * 0.88),
        roughness: 0.9, metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);

      // Scatter from the hit point outward
      mesh.position.set(
        hitPoint.x + (Math.random() - 0.5) * 6,
        hitPoint.y + Math.random() * 4,
        hitPoint.z + (Math.random() - 0.5) * 6,
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      scene.add(mesh);

      pieces.push({
        mesh, geo, mat,
        vx: (Math.random() - 0.5) * 14,
        vy: 4 + Math.random() * 12,
        vz: (Math.random() - 0.5) * 14,
        rx: (Math.random() - 0.5) * 4,
        rz: (Math.random() - 0.5) * 4,
      });
    }

    let elapsed = 0;
    const DURATION = 1.6;
    const tick = () => {
      const dt = 0.016;
      elapsed += dt;
      let alive = false;
      for (const p of pieces) {
        p.vy -= 18 * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mesh.rotation.x += p.rx * dt;
        p.mesh.rotation.z += p.rz * dt;
        p.mat.opacity = Math.max(0, 1 - elapsed / DURATION);
        p.mat.transparent = true;
        if (p.mat.opacity > 0) alive = true;
      }
      if (alive) {
        requestAnimationFrame(tick);
      } else {
        for (const p of pieces) {
          scene.remove(p.mesh);
          p.geo.dispose();
          p.mat.dispose();
        }
      }
    };
    requestAnimationFrame(tick);
  }

  // ── Jetpack ───────────────────────────────────────────────────────────────

  _updateJetpack(delta) {
    const head = this._player?.head;
    if (!head) return;

    head.getWorldPosition(this._origin);
    const px = this._origin.x, pz = this._origin.z;
    const terrainY = getTerrainHeight(px, pz);

    // Initialise platform just below the player's feet on first frame
    if (this._platformY === null) {
      this._platformY = terrainY;
    }

    if (this._jetpackHeld) {
      this._platformY += JETPACK_RISE * delta;
      if (this._loco) this._loco.config.slidingSpeed.value = JETPACK_SPEED;
    } else {
      // Drop back to terrain level
      this._platformY -= JETPACK_FALL * delta;
      this._platformY  = Math.max(this._platformY, terrainY);
      if (this._loco) this._loco.config.slidingSpeed.value = NORMAL_SPEED;
    }

    // Keep platform centred under the player at the current platform height
    this._platMesh.position.set(px, this._platformY, pz);
    this._platMesh.updateWorldMatrix(true, false);
  }
}
