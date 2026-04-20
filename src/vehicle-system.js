// VehicleSystem — loadable mech and ship vehicles near player spawn.
//
// SPAWNING
//   mech1.glb  spawns at (+15, terrain, 0) — right of origin
//   Ship.glb   spawns at (-15, terrain, 0) — left of origin
//   Both use AssetManager for loading (caching, DRACO/KTX2 handled automatically).
//
// MOUNT / DISMOUNT
//   Walk within AUTO_MOUNT_RANGE metres → vehicle mounts automatically.
//   While mounted, press B (right Quest controller) or O (keyboard) to exit.
//   A 3-second cooldown after dismounting lets the player walk clear before
//   the vehicle can re-trigger.
//
// CONTROLS WHILE MOUNTED
//   All vehicles  — right thumbstick X         : yaw
//   Mech          — right thumbstick Y         : forward / backward
//   Ship          — left  trigger (analog)     : forward thrust
//                   right trigger (analog)     : ascend
//                   left  squeeze (analog)     : descend
//
// PLAYER POSITIONING
//   Two-part approach:
//   1. XROrigin.position.x/z is forced to match the vehicle every frame so
//      the locomotion system's downward raycast always finds the platform.
//   2. An invisible kinematic LocomotionEnvironment platform sits at cockpit
//      height; the locomotion system keeps the player standing on it (handles Y).
//   Locomotion slidingSpeed is zeroed while mounted.
//
// SCALE NOTE
//   Default scale is 1.0 for both models.  Adjust VEHICLE_DEFS[].scale and
//   VEHICLE_DEFS[].cockpitY if the models need size correction.

import * as THREE from 'three';
import {
  createSystem,
  LocomotionEnvironment,
  LocomotionSystem,
  InputComponent,
  AssetManager,
} from '@iwsdk/core';
import { getTerrainHeight } from './noise.js';
import { AmmoVehicle, loadAmmoJS } from './ammo-vehicle.js';

// ── Constants ──────────────────────────────────────────────────────────────

const AUTO_MOUNT_RANGE = 3.0;  // metres: walk this close → auto-mount
const APPROACH_RANGE   = 7.0;  // metres: show "approaching" indicator
const DISMOUNT_CD      = 3.0;  // seconds cooldown after dismount (lets player walk clear)
const LAND_SPEED       = 20.0; // m/s descent rate when auto-landing after dismount
const NORMAL_SPEED     = 50;   // locomotion sliding speed restored on foot

// ── Ship flight physics ───────────────────────────────────────────────────
// Velocity-based so the ship floats and drifts rather than stopping instantly.
// All drag values are exponential coefficients: vel *= exp(-drag * delta).

const SHIP_ACCEL      = 48;   // m/s²   forward / back linear acceleration
const SHIP_VERT_ACCEL = 28;   // m/s²   vertical (Q / E) acceleration
const SHIP_YAW_ACCEL  = 2.2;  // rad/s² yaw angular acceleration
const SHIP_DRAG       = 0.55; // linear velocity drag  (61 % remains after 1 s)
const SHIP_YAW_DRAG   = 5.0;  // yaw rate drag         (stops cleanly ~0.4 s after input)
const SHIP_MAX_SPEED  = 90;   // m/s    max linear speed clamp

// ── Car ground physics ────────────────────────────────────────────────────
// doofah-style bouncy arcade car: spring suspension at 4 wheel corners keeps
// the car hovering above terrain with a springy/floaty feel.  Airborne state
// cuts engine authority and drag so jumps feel weightless.  Terrain slope is
// sampled front/back/left/right each frame to pitch and roll the visual mesh.

const CAR_ENGINE     = 32;   // m/s²  engine acceleration
const CAR_BRAKE      = 55;   // m/s²  braking deceleration
const CAR_MAX_FWD    = 35;   // m/s   top speed forward
const CAR_MAX_REV    = 10;   // m/s   top speed reverse
const CAR_WHEELBASE  = 2.8;  // m     Ackermann geometry wheelbase
const CAR_MAX_STEER  = 0.42; // rad   max steering angle (~24°)
const CAR_STEER_SPD  = 4.0;  // steer tracking speed
const CAR_LAT_GRIP   = 6.0;  // lateral friction (lower than before → more drift)
// Suspension
const CAR_HOVER      = 0.5;  // m     target hover height above terrain
const CAR_SPRING     = 55.0; // spring stiffness (lower = softer / bouncier)
const CAR_DAMP       = 7.0;  // spring damping  (lower = more oscillation)
const CAR_GRAVITY    = 22.0; // m/s²  fall rate when fully airborne
const CAR_GRND_DRAG  = 2.2;  // horizontal velocity drag when grounded (exp)
const CAR_AIR_DRAG   = 0.2;  // horizontal drag when airborne (much less)

// ── Vehicle catalogue ──────────────────────────────────────────────────────

const VEHICLE_DEFS = [
  {
    key:          'mech',
    url:          '/mechs/mech1.glb',
    label:        'MECH',
    spawn:        new THREE.Vector3(28, 0, 0),
    scale:        1.0,
    cockpitY:     14.0,
    flight:       false,
    speed:        8.0,
    turnSpeed:    1.4,
    riseSpeed:    0,
    meshOffsetYaw: Math.PI / 2,
    meshYOffset:   0,
    physics:      'tank',
  },
  {
    key:          'ship',
    url:          '/mechs/Ship.glb',
    label:        'SHIP',
    spawn:        new THREE.Vector3(-28, 0, 0),
    scale:        1.0,
    cockpitY:     2.8,
    flight:       true,
    speed:        100.0,
    turnSpeed:    1.8,
    riseSpeed:    40.0,
    meshOffsetYaw: Math.PI,
    meshYOffset:   2,
    physics:      'ship',
  },
  {
    key:          'car',
    url:          '/mechs/1981_dmc_delorean.glb',
    label:        'CAR',
    spawn:        new THREE.Vector3(0, 0, 28),
    scale:        100.0,
    cockpitY:     -0.9,        // seated driver — eyes inside cabin (~0.9 m above road)
    flight:       false,
    speed:        0,
    turnSpeed:    0,
    riseSpeed:    0,
    meshOffsetYaw: Math.PI,    // GLB faces +Z; rotate 180° to match -Z movement
    meshYOffset:   0,
    physics:      'car',
  },
];

// ── VehicleSystem ──────────────────────────────────────────────────────────

export class VehicleSystem extends createSystem({}, {}) {
  init() {
    this._vehicles  = [];   // runtime state, populated after GLBs load
    this._mounted   = null; // currently mounted vehicle object, or null
    this._mountCD   = 0;    // time remaining in mount cooldown
    this._oKey      = false;
    this._ready     = false;

    // Pre-allocated scratch vectors — zero allocations in update()
    this._playerPos      = new THREE.Vector3();
    this._fwd            = new THREE.Vector3();
    this._dismountPos    = new THREE.Vector3();
    this._carQuat        = new THREE.Quaternion(); // car chassis rotation from Ammo // land position held after dismount
    this._posLockTimer   = 0;                   // seconds left forcing player to _dismountPos
    // Flight vehicle exit: player stays mounted while ship descends to terrain,
    // then dismounts at ground level — avoids locomotion worker altitude conflict.
    this._playerLanding  = false;

    // ── Kinematic platform ──────────────────────────────────────────────────
    // Invisible flat surface placed at cockpit height.  IWSDK locomotion
    // stands the player on it, so moving the platform moves the player.
    const platGeo  = new THREE.PlaneGeometry(4, 4);
    platGeo.rotateX(-Math.PI / 2);
    const platMat  = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this._platMesh = new THREE.Mesh(platGeo, platMat);
    this._platEntity = this.world.createTransformEntity(this._platMesh, {
      parent:     this.world.sceneEntity,
      persistent: true,
    });
    this._platEntity.addComponent(LocomotionEnvironment, { type: 'kinematic' });

    // Park well below terrain so it has no effect until a vehicle is mounted
    this._platMesh.position.set(0, -20, 0);
    this._platMesh.updateWorldMatrix(true, false);

    // ── DOM overlays ────────────────────────────────────────────────────────
    this._prompt     = this._createOverlay('bottom');  // approach prompt
    this._mountedHUD = this._createOverlay('top');     // in-vehicle banner

    // ── Keyboard input ──────────────────────────────────────────────────────
    // WASD drives the mech (mirrors thumbstick).  O exits any vehicle.
    this._keys = { w: false, a: false, s: false, d: false, q: false, e: false };
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyW') this._keys.w = true;
      if (e.code === 'KeyA') this._keys.a = true;
      if (e.code === 'KeyS') this._keys.s = true;
      if (e.code === 'KeyD') this._keys.d = true;
      if (e.code === 'KeyQ') this._keys.q = true;
      if (e.code === 'KeyE') this._keys.e = true;
      if (e.code === 'KeyO' && !e.repeat) this._oKey = true;
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW') this._keys.w = false;
      if (e.code === 'KeyA') this._keys.a = false;
      if (e.code === 'KeyS') this._keys.s = false;
      if (e.code === 'KeyD') this._keys.d = false;
      if (e.code === 'KeyQ') this._keys.q = false;
      if (e.code === 'KeyE') this._keys.e = false;
    });

    // ── Load vehicle models asynchronously ──────────────────────────────────
    // Vehicles appear when models finish loading; world starts immediately.
    this._loadVehicles();
  }

  // ── Asset loading ──────────────────────────────────────────────────────────

  _loadVehicles() {
    // Load Ammo.js (script-tag loader) and all GLBs in parallel
    Promise.all([
      loadAmmoJS(),
      ...VEHICLE_DEFS.map((def) => AssetManager.loadGLTF(def.url, def.key)),
    ])
      .then(([Ammo, ...gltfs]) => {
        this._Ammo = Ammo;

        gltfs.forEach((gltf, i) => {
          const def  = VEHICLE_DEFS[i];
          const mesh = gltf.scene.clone();
          mesh.scale.setScalar(def.scale);

          // Snap spawn Y to terrain surface
          const tx = def.spawn.x, tz = def.spawn.z;
          const ty = getTerrainHeight(tx, tz);
          mesh.position.set(tx, ty + def.meshYOffset, tz);
          mesh.rotation.y = def.meshOffsetYaw;

          const entity = this.world.createTransformEntity(mesh, {
            parent:     this.world.sceneEntity,
            persistent: true,
          });

          // For the car, create an Ammo.js btRaycastVehicle
          const ammoVehicle = def.physics === 'car'
            ? new AmmoVehicle(Ammo, tx, ty, tz)
            : null;

          this._vehicles.push({
            def,
            mesh,
            entity,
            pos:        new THREE.Vector3(tx, ty, tz),
            yaw:        0,
            yawRate:    0,
            velocity:   new THREE.Vector3(),
            fwdVel:     0,
            latVel:     0,
            steerAngle: 0,
            yVel:       0,
            landing:    false,
            ammoVehicle,   // btRaycastVehicle wrapper (car only, null otherwise)
          });
        });

        this._ready = true;
        console.log('[VehicleSystem] Vehicles spawned');
      })
      .catch((err) => {
        console.error('[VehicleSystem] Failed to load vehicle models:', err);
      });
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta) {
    if (!this._ready || !this.player?.head) return;

    this._mountCD = Math.max(0, this._mountCD - delta);

    // After dismounting, keep forcing player to the land position for several
    // frames while the locomotion worker's async result catches up.
    // Without this the worker applies a cached cockpit position and snaps the
    // player back to where the vehicle was before the dismount.
    if (this._posLockTimer > 0) {
      this._posLockTimer -= delta;
      this.player.position.copy(this._dismountPos);
    }

    this.player.head.getWorldPosition(this._playerPos);

    const bDown = this.input?.gamepads?.right?.getButtonDown(InputComponent.B_Button) ?? false;
    const oDown = this._oKey;
    this._oKey  = false;

    if (this._mounted) {
      // ── Mounted ─────────────────────────────────────────────────────────
      this._hideOverlay(this._prompt);

      if (this._playerLanding) {
        // Ship is descending with player aboard — no driving, just land
        this._doPlayerLanding(delta);
      } else {
        this._driveMounted(delta);
        this._showOverlay(this._mountedHUD, `IN ${this._mounted.def.label}  —  [B / O]  Exit`);

        if ((bDown || oDown) && this._mountCD <= 0) {
          if (this._mounted.def.flight) {
            // Flight vehicle: initiate descent with player still aboard.
            // Kill velocity so the ship drops straight down, not sideways.
            this._mounted.velocity.set(0, 0, 0);
            this._mounted.yawRate = 0;
            this._playerLanding = true;
          } else {
            // Ground vehicle: dismount immediately (already at terrain level)
            this._dismount();
          }
        }
      }

    } else {
      // ── On foot ─────────────────────────────────────────────────────────
      this._hideOverlay(this._mountedHUD);

      if (this._mountCD <= 0) {
        const hit = this._nearestVehicle();
        if (hit && hit.dist < AUTO_MOUNT_RANGE) {
          this._mount(hit.vehicle);
        } else if (hit && hit.dist < APPROACH_RANGE) {
          const m = Math.max(0, hit.dist - AUTO_MOUNT_RANGE).toFixed(1);
          this._showOverlay(this._prompt, `${hit.vehicle.def.label}  —  ${m}m`);
        } else {
          this._hideOverlay(this._prompt);
        }
      } else {
        this._hideOverlay(this._prompt);
      }
    }

    // ── Auto-landing loop — runs every frame for dismounted flight vehicles ──
    for (const v of this._vehicles) {
      if (!v.landing) continue;
      const floorY = getTerrainHeight(v.pos.x, v.pos.z);
      v.pos.y -= LAND_SPEED * delta;
      if (v.pos.y <= floorY) {
        v.pos.y   = floorY;
        v.landing = false;
      }
      v.mesh.position.set(v.pos.x, v.pos.y + v.def.meshYOffset, v.pos.z);
      // Keep mesh facing correct direction while landing
      v.mesh.rotation.y = v.yaw + v.def.meshOffsetYaw;
    }
  }

  // ── Player-initiated ship landing ─────────────────────────────────────────
  // Called every frame while the player is still aboard and the ship descends.
  // Dismounts automatically when the hull reaches terrain.

  _doPlayerLanding(delta) {
    const v      = this._mounted;
    const floorY = getTerrainHeight(v.pos.x, v.pos.z);

    v.pos.y -= LAND_SPEED * delta;
    if (v.pos.y <= floorY) {
      v.pos.y          = floorY;
      this._playerLanding = false;
      this._dismount();          // player is now at terrain level — clean exit
      return;
    }

    // Still descending — keep player locked in cockpit
    v.mesh.position.set(v.pos.x, v.pos.y + v.def.meshYOffset, v.pos.z);
    v.mesh.rotation.y        = v.yaw + v.def.meshOffsetYaw;
    this.player.position.x   = v.pos.x;
    this.player.position.y   = v.pos.y + v.def.cockpitY;
    this.player.position.z   = v.pos.z;
    this.player.rotation.y   = v.yaw;
    this._syncPlatform(v);

    this._showOverlay(this._mountedHUD, 'LANDING...');
  }

  // ── Mount / dismount ───────────────────────────────────────────────────────

  _mount(vehicle) {
    this._mounted = vehicle;
    this._mountCD = DISMOUNT_CD;

    // Zero out thumbstick locomotion — vehicle drive loop takes over
    const loco = this.world.getSystem(LocomotionSystem);
    if (loco) loco.config.slidingSpeed.value = 0;

    // Teleport the XROrigin directly into the cockpit.  We own all three
    // axes while mounted — the locomotion system runs first (priority -5)
    // then we override here (priority 0) so our values win at render time.
    this.player.position.x = vehicle.pos.x;
    this.player.position.y = vehicle.pos.y + vehicle.def.cockpitY;
    this.player.position.z = vehicle.pos.z;
    // Rotate XROrigin so the headset forward aligns with the vehicle's nose
    this.player.rotation.y = vehicle.yaw;

    this._syncPlatform(vehicle);
  }

  _dismount() {
    const v       = this._mounted;
    this._mounted       = null;
    this._playerLanding = false;  // clear in case dismount is called mid-landing
    this._mountCD       = DISMOUNT_CD;

    // Restore foot locomotion and reset XROrigin rotation
    const loco = this.world.getSystem(LocomotionSystem);
    if (loco) loco.config.slidingSpeed.value = NORMAL_SPEED;
    this.player.rotation.y = 0;

    // Land the player at the vehicle's XZ at terrain level.
    const landX = v.pos.x;
    const landZ = v.pos.z;
    const landY = getTerrainHeight(landX, landZ);

    // ── Tell the locomotion worker the new position ─────────────────────────
    // LocomotionSystem.update() does player.position.copy(locomotor.position)
    // every frame, so any direct .set() on player.position is overwritten.
    // The fix is locomotor.teleport() which posts MessageType.Teleport to the
    // physics worker, resetting its internal playerPosition to the new coords.
    // locomotor is TypeScript `private` (not JS #private) so it is accessible
    // via bracket notation at runtime.
    const locomotor = loco?.['locomotor'];
    if (locomotor) {
      locomotor.teleport(new THREE.Vector3(landX, landY, landZ));
    }

    // Also set player.position directly so there is no visible snap during
    // the one or two frames it takes the worker response to arrive and the
    // locomotor to lerp to the new targetPosition.
    this.player.position.set(landX, landY, landZ);
    this._dismountPos.set(landX, landY, landZ);
    this._posLockTimer = 0.5;   // cover the lerp convergence window

    // Park the kinematic platform directly under the player so the locomotion
    // worker finds a valid surface as soon as it resumes control.
    this._platMesh.position.set(landX, landY, landZ);
    this._platMesh.updateWorldMatrix(true, false);

    // Flight vehicles descend smoothly to terrain rather than snapping
    if (v.def.flight) v.landing = true;
  }

  // ── Vehicle drive loop ─────────────────────────────────────────────────────
  //
  // MECH  — W/S forward/back   A/D yaw   (thumbstick mirrors keyboard)
  //
  // SHIP  — W/S accelerate/reverse   A/D yaw   Q ascend   E descend
  //         Controller: left-trigger forward, right-trigger ascend,
  //         left-squeeze descend, thumbstick-X yaw
  //         Velocity-based physics: the ship floats and drifts rather than
  //         stopping instantly.  All inputs add to velocity; drag bleeds it
  //         off gradually so the ship feels like it's in air, not on rails.

  _driveMounted(delta) {
    const v        = this._mounted;
    const def      = v.def;
    const rightPad = this.input?.gamepads?.right;
    const leftPad  = this.input?.gamepads?.left;
    const axes     = rightPad?.getAxesValues(InputComponent.Thumbstick) ?? { x: 0, y: 0 };

    if (def.flight) {
      // ── Ship: velocity-based flight physics ─────────────────────────────

      // Yaw rate — A/D keyboard (left = +yaw) and thumbstick X
      const yawInput = (this._keys.a ? 1 : 0) - (this._keys.d ? 1 : 0) - axes.x;
      v.yawRate += yawInput * SHIP_YAW_ACCEL * delta;
      v.yawRate *= Math.exp(-SHIP_YAW_DRAG * delta);   // damp so it stops cleanly
      v.yaw    += v.yawRate * delta;

      // Current facing direction
      this._fwd.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));

      // Forward / back — W/S keyboard and left trigger
      const lTrigger = leftPad?.getButtonValue(InputComponent.Trigger) ?? 0;
      const fwdInput = (this._keys.w ? 1 : 0) + lTrigger - (this._keys.s ? 1 : 0);
      v.velocity.x += this._fwd.x * fwdInput * SHIP_ACCEL * delta;
      v.velocity.z += this._fwd.z * fwdInput * SHIP_ACCEL * delta;

      // Vertical — Q/E keyboard, right trigger / left squeeze controller
      const rTrigger = rightPad?.getButtonValue(InputComponent.Trigger) ?? 0;
      const lSqueeze = leftPad?.getButtonValue(InputComponent.Squeeze)  ?? 0;
      const vertInput = (this._keys.q ? 1 : 0) + rTrigger
                      - (this._keys.e ? 1 : 0) - lSqueeze;
      v.velocity.y += vertInput * SHIP_VERT_ACCEL * delta;

      // Drag — exponential decay so the ship floats rather than stopping rigidly
      v.velocity.multiplyScalar(Math.exp(-SHIP_DRAG * delta));

      // Speed clamp
      const spd = v.velocity.length();
      if (spd > SHIP_MAX_SPEED) v.velocity.multiplyScalar(SHIP_MAX_SPEED / spd);

      // Integrate position
      v.pos.x += v.velocity.x * delta;
      v.pos.y += v.velocity.y * delta;
      v.pos.z += v.velocity.z * delta;

      // Hard floor: never clip into terrain
      v.pos.y = Math.max(v.pos.y, getTerrainHeight(v.pos.x, v.pos.z) + 1.5);
    } else if (def.physics === 'car') {
      // ── Car: Ammo.js btRaycastVehicle (Bullet Physics via Emscripten) ─────
      // Full rigid-body simulation: 4-wheel suspension, tyre friction curves,
      // weight transfer, and collision against a btBvhTriangleMeshShape terrain.

      const av = v.ammoVehicle;
      if (!av) return; // Ammo not yet initialized — skip this frame

      const lTrigger = leftPad?.getButtonValue(InputComponent.Trigger)  ?? 0;
      const rTrigger = rightPad?.getButtonValue(InputComponent.Trigger) ?? 0;

      // ── Inputs → Ammo vehicle ─────────────────────────────────────────────
      const steerInput = (this._keys.a ? 1 : 0) - (this._keys.d ? 1 : 0) - axes.x;
      av.setSteering(steerInput * CAR_MAX_STEER);

      const accel = (this._keys.w ? 1 : 0) + lTrigger;
      const brake = (this._keys.s ? 1 : 0) + rTrigger;
      const speed = av.getSpeed();

      // W = forward always. S = brake if moving forward, reverse if stopped.
      // No speed-gated direction flip — that was capping speed at 0.5 m/s.
      if (accel > 0) {
        av.setEngine(8000);
        av.setBrake(0);
      } else if (brake > 0) {
        if (speed < -0.5) {
          av.setEngine(0);
          av.setBrake(500);
        } else {
          av.setEngine(-4000);
          av.setBrake(0);
        }
      } else {
        av.setEngine(0);
        av.setBrake(0);
      }

      // Step Ammo world
      av.refreshTerrainIfNeeded(v.pos.x, v.pos.z);
      av.update(delta);

      // ── Read back chassis transform ───────────────────────────────────────
      const tf = av.getTransform();
      v.pos.set(tf.px, tf.py, tf.pz);
      this._carQuat.set(tf.qx, tf.qy, tf.qz, tf.qw);

    } else {
      // ── Mech: tank controls ───────────────────────────────────────────────
      // Yaw: thumbstick X or keyboard A/D
      const keyTurn = (this._keys.d ? 1 : 0) - (this._keys.a ? 1 : 0);
      v.yaw -= (axes.x + keyTurn) * def.turnSpeed * delta;
      this._fwd.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));

      // Forward: thumbstick Y or keyboard W/S (both contribute)
      const keyFwd  = (this._keys.w ? 1 : 0) - (this._keys.s ? 1 : 0);
      const throttle = (-axes.y) + keyFwd;
      v.pos.x += this._fwd.x * throttle * def.speed * delta;
      v.pos.z += this._fwd.z * throttle * def.speed * delta;
      v.pos.y  = getTerrainHeight(v.pos.x, v.pos.z);
    }

    // Sync visual mesh
    v.mesh.position.set(v.pos.x, v.pos.y + v.def.meshYOffset, v.pos.z);
    if (def.physics === 'car') {
      // Ammo.js provides the full chassis quaternion — pitch, roll, and yaw
      // all come from the rigid body simulation.  Apply the meshOffsetYaw
      // by multiplying in a Y-rotation offset quaternion.
      this._carQuat.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), def.meshOffsetYaw,
        ),
      );
      v.mesh.quaternion.copy(this._carQuat);
    } else {
      v.mesh.rotation.y = v.yaw + v.def.meshOffsetYaw;
    }

    // Force the XROrigin to the cockpit position every frame (all three axes).
    // This system runs at priority 0, after the locomotion system at -5,
    // so our values win at render time regardless of what locomotion computed.
    this.player.position.x = v.pos.x;
    this.player.position.y = v.pos.y + v.def.cockpitY;
    this.player.position.z = v.pos.z;
    // For the car the yaw comes from Ammo's quaternion; for others use v.yaw
    if (v.def.physics === 'car') {
      this.player.rotation.y = Math.atan2(
        2 * (this._carQuat.w * this._carQuat.y + this._carQuat.z * this._carQuat.x),
        1 - 2 * (this._carQuat.y * this._carQuat.y + this._carQuat.x * this._carQuat.x),
      );
    } else {
      this.player.rotation.y = v.yaw;
    }

    // Sync kinematic platform to cockpit position
    this._syncPlatform(v);
  }

  _syncPlatform(v) {
    this._platMesh.position.set(v.pos.x, v.pos.y + v.def.cockpitY, v.pos.z);
    this._platMesh.updateWorldMatrix(true, false);
  }

  // ── Proximity ─────────────────────────────────────────────────────────────

  _nearestVehicle() {
    let best = null, bestDist = Infinity;
    for (const v of this._vehicles) {
      const dx = v.pos.x - this._playerPos.x;
      const dz = v.pos.z - this._playerPos.z;
      const d  = dx * dx + dz * dz;
      if (d < bestDist) { bestDist = d; best = v; }
    }
    return best ? { vehicle: best, dist: Math.sqrt(bestDist) } : null;
  }

  // ── DOM overlays ──────────────────────────────────────────────────────────

  _createOverlay(position) {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      position === 'top' ? 'top:20px' : 'bottom:28%',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.72)',
      'border:1px solid rgba(255,255,255,0.18)',
      'border-radius:6px',
      'padding:7px 20px',
      'color:#fff',
      'font-family:monospace',
      'font-size:14px',
      'pointer-events:none',
      'z-index:998',
      'display:none',
      'white-space:nowrap',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  _showOverlay(el, text) {
    if (el.textContent !== text) el.textContent = text;
    if (el.style.display === 'none') el.style.display = 'block';
  }

  _hideOverlay(el) {
    if (el.style.display !== 'none') el.style.display = 'none';
  }
}
