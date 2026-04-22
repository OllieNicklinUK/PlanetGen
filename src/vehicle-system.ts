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

import {
  createSystem,
  LocomotionEnvironment,
  LocomotionSystem,
  InputComponent,
  AssetManager,
  Vector3,
  Quaternion,
  PlaneGeometry,
  MeshBasicMaterial,
  Mesh,
} from '@iwsdk/core';
import { getTerrainHeight } from './noise.js';
import { AmmoVehicle, loadAmmoJS } from './ammo-vehicle.js';

// ── Constants ──────────────────────────────────────────────────────────────

const AUTO_MOUNT_RANGE = 3.0;
const APPROACH_RANGE = 7.0;
const DISMOUNT_CD = 3.0;
const LAND_SPEED = 20.0;
const NORMAL_SPEED = 50;

// ── Ship flight physics ────────────────────────────────────────────────────

const SHIP_ACCEL = 48;
const SHIP_VERT_ACCEL = 28;
const SHIP_YAW_ACCEL = 2.2;
const SHIP_DRAG = 0.55;
const SHIP_YAW_DRAG = 5.0;
const SHIP_MAX_SPEED = 90;

// ── Car ground physics ─────────────────────────────────────────────────────

const CAR_MAX_STEER = 0.42;

// ── Vehicle catalogue ──────────────────────────────────────────────────────

interface VehicleDef {
  key: string;
  url: string;
  label: string;
  spawn: Vector3;
  scale: number;
  cockpitY: number;
  flight: boolean;
  speed: number;
  turnSpeed: number;
  riseSpeed: number;
  meshOffsetYaw: number;
  meshYOffset: number;
  physics: 'tank' | 'ship' | 'car';
}

interface VehicleState {
  def: VehicleDef;
  mesh: any;
  entity: any;
  pos: Vector3;
  yaw: number;
  yawRate: number;
  velocity: Vector3;
  fwdVel: number;
  latVel: number;
  steerAngle: number;
  yVel: number;
  landing: boolean;
  ammoVehicle: AmmoVehicle | null;
}

const VEHICLE_DEFS: VehicleDef[] = [
  {
    key: 'mech',
    url: '/mechs/mech1.glb',
    label: 'MECH',
    spawn: new Vector3(28, 0, 0),
    scale: 1.0,
    cockpitY: 14.0,
    flight: false,
    speed: 8.0,
    turnSpeed: 1.4,
    riseSpeed: 0,
    meshOffsetYaw: Math.PI / 2,
    meshYOffset: 0,
    physics: 'tank',
  },
  {
    key: 'ship',
    url: '/mechs/Ship.glb',
    label: 'SHIP',
    spawn: new Vector3(-28, 0, 0),
    scale: 1.0,
    cockpitY: 2.8,
    flight: true,
    speed: 100.0,
    turnSpeed: 1.8,
    riseSpeed: 40.0,
    meshOffsetYaw: Math.PI,
    meshYOffset: 2,
    physics: 'ship',
  },
  {
    key: 'car',
    url: '/mechs/1981_dmc_delorean.glb',
    label: 'CAR',
    spawn: new Vector3(0, 0, 28),
    scale: 100.0,
    cockpitY: -0.9,
    flight: false,
    speed: 0,
    turnSpeed: 0,
    riseSpeed: 0,
    meshOffsetYaw: Math.PI,
    meshYOffset: 0,
    physics: 'car',
  },
];

// ── VehicleSystem ──────────────────────────────────────────────────────────

export class VehicleSystem extends createSystem({}, {}) {
  private _vehicles!: VehicleState[];
  private _mounted!: VehicleState | null;
  private _mountCD!: number;
  private _oKey!: boolean;
  private _ready!: boolean;
  private _playerPos!: Vector3;
  private _fwd!: Vector3;
  private _dismountPos!: Vector3;
  private _carQuat!: Quaternion;
  private _posLockTimer!: number;
  private _playerLanding!: boolean;
  private _platMesh!: Mesh;
  private _platEntity!: any;
  private _prompt!: HTMLDivElement;
  private _mountedHUD!: HTMLDivElement;
  private _keys!: Record<string, boolean>;
  private _Ammo!: any;

  init() {
    this._vehicles = [];
    this._mounted = null;
    this._mountCD = 0;
    this._oKey = false;
    this._ready = false;

    this._playerPos = new Vector3();
    this._fwd = new Vector3();
    this._dismountPos = new Vector3();
    this._carQuat = new Quaternion();
    this._posLockTimer = 0;
    this._playerLanding = false;

    const platGeo = new PlaneGeometry(4, 4);
    platGeo.rotateX(-Math.PI / 2);
    const platMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this._platMesh = new Mesh(platGeo, platMat);
    this._platEntity = this.world.createTransformEntity(this._platMesh, {
      parent: this.world.sceneEntity,
      persistent: true,
    });
    this._platEntity.addComponent(LocomotionEnvironment, { type: 'kinematic' });

    this._platMesh.position.set(0, -20, 0);
    this._platMesh.updateWorldMatrix(true, false);

    this._prompt = this._createOverlay('bottom');
    this._mountedHUD = this._createOverlay('top');

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

    this._loadVehicles();
  }

  // ── Asset loading ──────────────────────────────────────────────────────────

  private _loadVehicles() {
    Promise.all([loadAmmoJS(), ...VEHICLE_DEFS.map((def) => AssetManager.loadGLTF(def.url, def.key))])
      .then(([Ammo, ...gltfs]) => {
        this._Ammo = Ammo;

        gltfs.forEach((gltf: any, i: number) => {
          const def = VEHICLE_DEFS[i];
          const mesh = gltf.scene.clone();
          mesh.scale.setScalar(def.scale);

          const tx = def.spawn.x,
            tz = def.spawn.z;
          const ty = getTerrainHeight(tx, tz);
          mesh.position.set(tx, ty + def.meshYOffset, tz);
          mesh.rotation.y = def.meshOffsetYaw;

          const entity = this.world.createTransformEntity(mesh, {
            parent: this.world.sceneEntity,
            persistent: true,
          });

          const ammoVehicle =
            def.physics === 'car' ? new AmmoVehicle(Ammo, tx, ty, tz) : null;

          this._vehicles.push({
            def,
            mesh,
            entity,
            pos: new Vector3(tx, ty, tz),
            yaw: 0,
            yawRate: 0,
            velocity: new Vector3(),
            fwdVel: 0,
            latVel: 0,
            steerAngle: 0,
            yVel: 0,
            landing: false,
            ammoVehicle,
          });
        });

        this._ready = true;
        console.log('[VehicleSystem] Vehicles spawned');
      })
      .catch((err: unknown) => {
        console.error('[VehicleSystem] Failed to load vehicle models:', err);
      });
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta: number) {
    const player = (this as any).player;
    const input = (this as any).input;
    if (!this._ready || !player?.head) return;

    this._mountCD = Math.max(0, this._mountCD - delta);

    if (this._posLockTimer > 0) {
      this._posLockTimer -= delta;
      player.position.copy(this._dismountPos);
    }

    player.head.getWorldPosition(this._playerPos);

    const bDown = input?.gamepads?.right?.getButtonDown(InputComponent.B_Button) ?? false;
    const oDown = this._oKey;
    this._oKey = false;

    if (this._mounted) {
      this._hideOverlay(this._prompt);

      if (this._playerLanding) {
        this._doPlayerLanding(delta);
      } else {
        this._driveMounted(delta);
        this._showOverlay(this._mountedHUD, `IN ${this._mounted.def.label}  —  [B / O]  Exit`);

        if ((bDown || oDown) && this._mountCD <= 0) {
          if (this._mounted.def.flight) {
            this._mounted.velocity.set(0, 0, 0);
            this._mounted.yawRate = 0;
            this._playerLanding = true;
          } else {
            this._dismount();
          }
        }
      }
    } else {
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

    for (const v of this._vehicles) {
      if (!v.landing) continue;
      const floorY = getTerrainHeight(v.pos.x, v.pos.z);
      v.pos.y -= LAND_SPEED * delta;
      if (v.pos.y <= floorY) {
        v.pos.y = floorY;
        v.landing = false;
      }
      v.mesh.position.set(v.pos.x, v.pos.y + v.def.meshYOffset, v.pos.z);
      v.mesh.rotation.y = v.yaw + v.def.meshOffsetYaw;
    }
  }

  // ── Player-initiated ship landing ──────────────────────────────────────────

  private _doPlayerLanding(delta: number) {
    const v = this._mounted!;
    const player = (this as any).player;
    const floorY = getTerrainHeight(v.pos.x, v.pos.z);

    v.pos.y -= LAND_SPEED * delta;
    if (v.pos.y <= floorY) {
      v.pos.y = floorY;
      this._playerLanding = false;
      this._dismount();
      return;
    }

    v.mesh.position.set(v.pos.x, v.pos.y + v.def.meshYOffset, v.pos.z);
    v.mesh.rotation.y = v.yaw + v.def.meshOffsetYaw;
    player.position.x = v.pos.x;
    player.position.y = v.pos.y + v.def.cockpitY;
    player.position.z = v.pos.z;
    player.rotation.y = v.yaw;
    this._syncPlatform(v);

    this._showOverlay(this._mountedHUD, 'LANDING...');
  }

  // ── Mount / dismount ───────────────────────────────────────────────────────

  private _mount(vehicle: VehicleState) {
    const player = (this as any).player;
    this._mounted = vehicle;
    this._mountCD = DISMOUNT_CD;

    const loco = this.world.getSystem(LocomotionSystem);
    if (loco) loco.config.slidingSpeed.value = 0;

    player.position.x = vehicle.pos.x;
    player.position.y = vehicle.pos.y + vehicle.def.cockpitY;
    player.position.z = vehicle.pos.z;
    player.rotation.y = vehicle.yaw;

    this._syncPlatform(vehicle);
  }

  private _dismount() {
    const v = this._mounted!;
    const player = (this as any).player;
    this._mounted = null;
    this._playerLanding = false;
    this._mountCD = DISMOUNT_CD;

    const loco = this.world.getSystem(LocomotionSystem);
    if (loco) loco.config.slidingSpeed.value = NORMAL_SPEED;
    player.rotation.y = 0;

    const landX = v.pos.x;
    const landZ = v.pos.z;
    const landY = getTerrainHeight(landX, landZ);

    // locomotor is TypeScript `private` (not JS #private) so accessible via bracket notation
    const locomotor = loco?.['locomotor'];
    if (locomotor) {
      locomotor.teleport(new Vector3(landX, landY, landZ));
    }

    player.position.set(landX, landY, landZ);
    this._dismountPos.set(landX, landY, landZ);
    this._posLockTimer = 0.5;

    this._platMesh.position.set(landX, landY, landZ);
    this._platMesh.updateWorldMatrix(true, false);

    if (v.def.flight) v.landing = true;
  }

  // ── Vehicle drive loop ─────────────────────────────────────────────────────

  private _driveMounted(delta: number) {
    const v = this._mounted!;
    const def = v.def;
    const player = (this as any).player;
    const input = (this as any).input;
    const rightPad = input?.gamepads?.right;
    const leftPad = input?.gamepads?.left;
    const axes = rightPad?.getAxesValues(InputComponent.Thumbstick) ?? { x: 0, y: 0 };

    if (def.flight) {
      const yawInput = (this._keys.a ? 1 : 0) - (this._keys.d ? 1 : 0) - axes.x;
      v.yawRate += yawInput * SHIP_YAW_ACCEL * delta;
      v.yawRate *= Math.exp(-SHIP_YAW_DRAG * delta);
      v.yaw += v.yawRate * delta;

      this._fwd.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));

      const lTrigger = leftPad?.getButtonValue(InputComponent.Trigger) ?? 0;
      const fwdInput = (this._keys.w ? 1 : 0) + lTrigger - (this._keys.s ? 1 : 0);
      v.velocity.x += this._fwd.x * fwdInput * SHIP_ACCEL * delta;
      v.velocity.z += this._fwd.z * fwdInput * SHIP_ACCEL * delta;

      const rTrigger = rightPad?.getButtonValue(InputComponent.Trigger) ?? 0;
      const lSqueeze = leftPad?.getButtonValue(InputComponent.Squeeze) ?? 0;
      const vertInput =
        (this._keys.q ? 1 : 0) + rTrigger - (this._keys.e ? 1 : 0) - lSqueeze;
      v.velocity.y += vertInput * SHIP_VERT_ACCEL * delta;

      v.velocity.multiplyScalar(Math.exp(-SHIP_DRAG * delta));

      const spd = v.velocity.length();
      if (spd > SHIP_MAX_SPEED) v.velocity.multiplyScalar(SHIP_MAX_SPEED / spd);

      v.pos.x += v.velocity.x * delta;
      v.pos.y += v.velocity.y * delta;
      v.pos.z += v.velocity.z * delta;

      v.pos.y = Math.max(v.pos.y, getTerrainHeight(v.pos.x, v.pos.z) + 1.5);
    } else if (def.physics === 'car') {
      const av = v.ammoVehicle;
      if (!av) return;

      const lTrigger = leftPad?.getButtonValue(InputComponent.Trigger) ?? 0;
      const rTrigger = rightPad?.getButtonValue(InputComponent.Trigger) ?? 0;

      const steerInput = (this._keys.d ? 1 : 0) - (this._keys.a ? 1 : 0) + axes.x;
      av.setSteering(steerInput * CAR_MAX_STEER);

      const accel = (this._keys.w ? 1 : 0) + lTrigger;
      const brake = (this._keys.s ? 1 : 0) + rTrigger;
      const speed = av.getSpeed();

      if (accel > 0) {
        av.setEngine(15000);
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

      av.refreshTerrainIfNeeded(v.pos.x, v.pos.z);
      av.update(delta);

      const tf = av.getTransform();
      v.pos.set(tf.px, tf.py, tf.pz);
      this._carQuat.set(tf.qx, tf.qy, tf.qz, tf.qw);
    } else {
      const keyTurn = (this._keys.d ? 1 : 0) - (this._keys.a ? 1 : 0);
      v.yaw -= (axes.x + keyTurn) * def.turnSpeed * delta;
      this._fwd.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));

      const keyFwd = (this._keys.w ? 1 : 0) - (this._keys.s ? 1 : 0);
      const throttle = -axes.y + keyFwd;
      v.pos.x += this._fwd.x * throttle * def.speed * delta;
      v.pos.z += this._fwd.z * throttle * def.speed * delta;
      v.pos.y = getTerrainHeight(v.pos.x, v.pos.z);
    }

    v.mesh.position.set(v.pos.x, v.pos.y + v.def.meshYOffset, v.pos.z);
    if (def.physics === 'car') {
      this._carQuat.multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), def.meshOffsetYaw),
      );
      v.mesh.quaternion.copy(this._carQuat);
    } else {
      v.mesh.rotation.y = v.yaw + v.def.meshOffsetYaw;
    }

    if (def.physics === 'car') {
      const carYaw = Math.atan2(
        2 * (this._carQuat.w * this._carQuat.y + this._carQuat.z * this._carQuat.x),
        1 - 2 * (this._carQuat.y * this._carQuat.y + this._carQuat.x * this._carQuat.x),
      );
      const FOLLOW_BACK = 7;
      const FOLLOW_HEIGHT = 3.0;
      player.position.x = v.pos.x - Math.sin(carYaw) * FOLLOW_BACK;
      player.position.y = v.pos.y + FOLLOW_HEIGHT;
      player.position.z = v.pos.z - Math.cos(carYaw) * FOLLOW_BACK;
      player.rotation.y = carYaw + Math.PI;
    } else {
      player.position.x = v.pos.x;
      player.position.y = v.pos.y + v.def.cockpitY;
      player.position.z = v.pos.z;
      player.rotation.y = v.yaw;
    }

    this._syncPlatform(v);
  }

  private _syncPlatform(v: VehicleState) {
    this._platMesh.position.set(v.pos.x, v.pos.y + v.def.cockpitY, v.pos.z);
    this._platMesh.updateWorldMatrix(true, false);
  }

  // ── Proximity ──────────────────────────────────────────────────────────────

  private _nearestVehicle(): { vehicle: VehicleState; dist: number } | null {
    let best: VehicleState | null = null;
    let bestDist = Infinity;
    for (const v of this._vehicles) {
      const dx = v.pos.x - this._playerPos.x;
      const dz = v.pos.z - this._playerPos.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best ? { vehicle: best, dist: Math.sqrt(bestDist) } : null;
  }

  // ── DOM overlays ───────────────────────────────────────────────────────────

  private _createOverlay(position: 'top' | 'bottom'): HTMLDivElement {
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

  private _showOverlay(el: HTMLDivElement, text: string) {
    if (el.textContent !== text) el.textContent = text;
    if (el.style.display === 'none') el.style.display = 'block';
  }

  private _hideOverlay(el: HTMLDivElement) {
    if (el.style.display !== 'none') el.style.display = 'none';
  }
}
