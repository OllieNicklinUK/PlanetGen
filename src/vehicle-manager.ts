import {
  Scene, Vector3, Quaternion,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { getTerrainHeight } from './noise.js';
import { AmmoVehicle, loadAmmoJS } from './ammo-vehicle.js';
import type { BvhPhysicsWorld, SimpleCharacter } from '@pmndrs/viverse';

const AUTO_MOUNT_RANGE = 3.0;
const APPROACH_RANGE   = 7.0;
const DISMOUNT_CD      = 3.0;
const LAND_SPEED       = 20.0;

const SHIP_ACCEL       = 48;
const SHIP_VERT_ACCEL  = 28;
const SHIP_YAW_ACCEL   = 2.2;
const SHIP_DRAG        = 0.55;
const SHIP_YAW_DRAG    = 5.0;
const SHIP_MAX_SPEED   = 90;
const CAR_MAX_STEER    = 0.42;

interface VehicleDef {
  key: string; url: string; label: string;
  spawn: Vector3; scale: number; cockpitY: number;
  flight: boolean; speed: number; turnSpeed: number; riseSpeed: number;
  meshOffsetYaw: number; meshYOffset: number;
  physics: 'tank' | 'ship' | 'car';
}

interface VehicleState {
  def: VehicleDef; mesh: any; pos: Vector3; yaw: number; yawRate: number;
  velocity: Vector3; fwdVel: number; latVel: number; steerAngle: number;
  yVel: number; landing: boolean; ammoVehicle: any;
}

const VEHICLE_DEFS: VehicleDef[] = [
  { key: 'mech', url: `${import.meta.env.BASE_URL}mechs/mech1.glb`, label: 'MECH', spawn: new Vector3(28, 0, 0), scale: 1.0, cockpitY: 14.0, flight: false, speed: 8.0, turnSpeed: 1.4, riseSpeed: 0, meshOffsetYaw: Math.PI / 2, meshYOffset: 0, physics: 'tank' },
  { key: 'ship', url: `${import.meta.env.BASE_URL}mechs/Ship.glb`,  label: 'SHIP', spawn: new Vector3(-28, 0, 0), scale: 1.0, cockpitY: 2.8, flight: true, speed: 100.0, turnSpeed: 1.8, riseSpeed: 40.0, meshOffsetYaw: Math.PI, meshYOffset: 2, physics: 'ship' },
  { key: 'car',  url: `${import.meta.env.BASE_URL}mechs/1981_dmc_delorean.glb`, label: 'CAR', spawn: new Vector3(0, 0, 28), scale: 100.0, cockpitY: -0.9, flight: false, speed: 0, turnSpeed: 0, riseSpeed: 0, meshOffsetYaw: Math.PI, meshYOffset: 0, physics: 'car' },
];

export class VehicleManager {
  private _vehicles:      VehicleState[] = [];
  private _mounted:       VehicleState | null = null;
  private _mountCD        = 0;
  private _ready          = false;
  private _playerPos      = new Vector3();
  private _fwd            = new Vector3();
  private _dismountPos    = new Vector3();
  private _carQuat        = new Quaternion();
  private _posLockTimer   = 0;
  private _playerLanding  = false;
  private _prompt!:       HTMLDivElement;
  private _mountedHUD!:   HTMLDivElement;
  private _keys           = { w: false, a: false, s: false, d: false, q: false, e: false };
  private _Ammo:          any = null;
  private _cleanups:      (() => void)[] = [];

  constructor(
    private _scene:        Scene,
    private _physicsWorld: BvhPhysicsWorld,
    private _character:    SimpleCharacter,
    private _getPlayerPos: () => Vector3,
    private _setPlayerPos: (pos: {x:number;y:number;z:number}) => void,
    public onMounted:      ((v: boolean) => void) | null = null,
  ) {}

  init() {
    this._prompt     = this._createOverlay('bottom');
    this._mountedHUD = this._createOverlay('top');

    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') this._keys.w = true;
      if (e.code === 'KeyA') this._keys.a = true;
      if (e.code === 'KeyS') this._keys.s = true;
      if (e.code === 'KeyD') this._keys.d = true;
      if (e.code === 'KeyQ') this._keys.q = true;
      if (e.code === 'KeyE') this._keys.e = true;
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') this._keys.w = false;
      if (e.code === 'KeyA') this._keys.a = false;
      if (e.code === 'KeyS') this._keys.s = false;
      if (e.code === 'KeyD') this._keys.d = false;
      if (e.code === 'KeyQ') this._keys.q = false;
      if (e.code === 'KeyE') this._keys.e = false;
    };
    document.addEventListener('keydown', onDown);
    document.addEventListener('keyup', onUp);
    this._cleanups.push(
      () => document.removeEventListener('keydown', onDown),
      () => document.removeEventListener('keyup', onUp),
    );

    this._loadVehicles();
  }

  private _loadVehicles() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    Promise.all([
      loadAmmoJS(),
      ...VEHICLE_DEFS.map((def) => loader.loadAsync(def.url).catch(() => null)),
    ]).then(([Ammo, ...gltfs]) => {
      this._Ammo = Ammo;

      (gltfs as any[]).forEach((gltf, i) => {
        if (!gltf) return;
        const def  = VEHICLE_DEFS[i];
        const mesh = gltf.scene.clone();
        mesh.scale.setScalar(def.scale);

        const tx = def.spawn.x, tz = def.spawn.z;
        const ty = getTerrainHeight(tx, tz);
        mesh.position.set(tx, ty + def.meshYOffset, tz);
        mesh.rotation.y = def.meshOffsetYaw;
        this._scene.add(mesh);

        const ammoVehicle = def.physics === 'car' ? new AmmoVehicle(Ammo, tx, ty, tz) : null;

        this._vehicles.push({
          def, mesh,
          pos: new Vector3(tx, ty, tz),
          yaw: 0, yawRate: 0, velocity: new Vector3(),
          fwdVel: 0, latVel: 0, steerAngle: 0, yVel: 0,
          landing: false, ammoVehicle,
        });
      });

      this._ready = true;
    }).catch((err: unknown) => console.error('[VehicleManager] load failed:', err));
  }

  update(delta: number) {
    if (!this._ready) return;

    this._mountCD = Math.max(0, this._mountCD - delta);
    this._playerPos.copy(this._getPlayerPos());

    if (this._posLockTimer > 0) {
      this._posLockTimer -= delta;
      this._setPlayerPos(this._dismountPos);
    }

    // O key = dismount (no VR B button)
    const oDown = this._keys.e && this._mounted;

    if (this._mounted) {
      this._hideOverlay(this._prompt);

      if (this._playerLanding) {
        this._doPlayerLanding(delta);
      } else {
        this._driveMounted(delta);
        this._showOverlay(this._mountedHUD, `IN ${this._mounted.def.label}  —  [E] Exit`);
        if (oDown && this._mountCD <= 0) {
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
          this._showOverlay(this._prompt, `${hit.vehicle.def.label}  —  ${(hit.dist - AUTO_MOUNT_RANGE).toFixed(1)}m`);
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
      if (v.pos.y <= floorY) { v.pos.y = floorY; v.landing = false; }
      v.mesh.position.set(v.pos.x, v.pos.y + v.def.meshYOffset, v.pos.z);
      v.mesh.rotation.y = v.yaw + v.def.meshOffsetYaw;
    }
  }

  get isMounted() { return this._mounted !== null; }

  private _mount(vehicle: VehicleState) {
    this._mounted = vehicle;
    this._mountCD = DISMOUNT_CD;
    this._keys.e  = false;
    this._setPlayerPos({ x: vehicle.pos.x, y: vehicle.pos.y + vehicle.def.cockpitY, z: vehicle.pos.z });
    this.onMounted?.(true);
  }

  private _dismount() {
    const v = this._mounted!;
    this._mounted       = null;
    this._playerLanding = false;
    this._mountCD       = DISMOUNT_CD;
    this._keys.e        = false;

    const landX = v.pos.x, landZ = v.pos.z;
    const landY = getTerrainHeight(landX, landZ);
    this._dismountPos.set(landX, landY, landZ);
    this._posLockTimer = 0.5;
    this._setPlayerPos(this._dismountPos);
    if (v.def.flight) v.landing = true;
    this.onMounted?.(false);
  }

  private _doPlayerLanding(delta: number) {
    const v     = this._mounted!;
    const floorY = getTerrainHeight(v.pos.x, v.pos.z);
    v.pos.y -= LAND_SPEED * delta;
    if (v.pos.y <= floorY) { v.pos.y = floorY; this._playerLanding = false; this._dismount(); return; }
    v.mesh.position.set(v.pos.x, v.pos.y + v.def.meshYOffset, v.pos.z);
    v.mesh.rotation.y = v.yaw + v.def.meshOffsetYaw;
    this._setPlayerPos({ x: v.pos.x, y: v.pos.y + v.def.cockpitY, z: v.pos.z });
    this._showOverlay(this._mountedHUD, 'LANDING...');
  }

  private _driveMounted(delta: number) {
    const v   = this._mounted!;
    const def = v.def;
    const K   = this._keys;

    if (def.flight) {
      const yawInput = (K.a ? 1 : 0) - (K.d ? 1 : 0);
      v.yawRate += yawInput * SHIP_YAW_ACCEL * delta;
      v.yawRate *= Math.exp(-SHIP_YAW_DRAG * delta);
      v.yaw += v.yawRate * delta;

      this._fwd.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
      const fwdInput = (K.w ? 1 : 0) - (K.s ? 1 : 0);
      v.velocity.x += this._fwd.x * fwdInput * SHIP_ACCEL * delta;
      v.velocity.z += this._fwd.z * fwdInput * SHIP_ACCEL * delta;
      const vertInput = (K.q ? 1 : 0) - (K.e ? 1 : 0);
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
      const steerInput = (K.d ? 1 : 0) - (K.a ? 1 : 0);
      av.setSteering(steerInput * CAR_MAX_STEER);
      const accel = K.w ? 1 : 0;
      const brake = K.s ? 1 : 0;
      const speed = av.getSpeed();
      if (accel > 0)      { av.setEngine(15000); av.setBrake(0); }
      else if (brake > 0) { av.setEngine(speed < -0.5 ? 0 : -4000); av.setBrake(speed < -0.5 ? 500 : 0); }
      else                { av.setEngine(0); av.setBrake(0); }
      av.refreshTerrainIfNeeded(v.pos.x, v.pos.z);
      av.update(delta);
      const tf = av.getTransform();
      v.pos.set(tf.px, tf.py, tf.pz);
      this._carQuat.set(tf.qx, tf.qy, tf.qz, tf.qw);

    } else {
      const keyTurn = (K.d ? 1 : 0) - (K.a ? 1 : 0);
      v.yaw -= keyTurn * def.turnSpeed * delta;
      this._fwd.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
      const throttle = (K.w ? 1 : 0) - (K.s ? 1 : 0);
      v.pos.x += this._fwd.x * throttle * def.speed * delta;
      v.pos.z += this._fwd.z * throttle * def.speed * delta;
      v.pos.y = getTerrainHeight(v.pos.x, v.pos.z);
    }

    v.mesh.position.set(v.pos.x, v.pos.y + v.def.meshYOffset, v.pos.z);
    if (def.physics === 'car') {
      this._carQuat.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), def.meshOffsetYaw));
      v.mesh.quaternion.copy(this._carQuat);
    } else {
      v.mesh.rotation.y = v.yaw + v.def.meshOffsetYaw;
    }

    const cockpitX = v.pos.x, cockpitZ = v.pos.z, cockpitY = v.pos.y + v.def.cockpitY;
    if (def.physics === 'car') {
      const carYaw = Math.atan2(2*(this._carQuat.w*this._carQuat.y+this._carQuat.z*this._carQuat.x), 1-2*(this._carQuat.y**2+this._carQuat.x**2));
      const FOLLOW_BACK = 7, FOLLOW_HEIGHT = 3.0;
      this._setPlayerPos({ x: v.pos.x - Math.sin(carYaw)*FOLLOW_BACK, y: v.pos.y + FOLLOW_HEIGHT, z: v.pos.z - Math.cos(carYaw)*FOLLOW_BACK });
    } else {
      this._setPlayerPos({ x: cockpitX, y: cockpitY, z: cockpitZ });
    }
  }

  private _nearestVehicle() {
    let best: VehicleState | null = null, bestDist = Infinity;
    for (const v of this._vehicles) {
      const d = this._playerPos.distanceTo(v.pos);
      if (d < bestDist) { bestDist = d; best = v; }
    }
    return best ? { vehicle: best, dist: bestDist } : null;
  }

  private _createOverlay(position: 'top' | 'bottom'): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;${position==='top'?'top:20px':'bottom:28%'};left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.72);border:1px solid rgba(255,255,255,0.18);border-radius:6px;padding:7px 20px;color:#fff;font-family:monospace;font-size:14px;pointer-events:none;z-index:998;display:none;white-space:nowrap;`;
    document.body.appendChild(el);
    this._cleanups.push(() => el.remove());
    return el;
  }
  private _showOverlay(el: HTMLDivElement, text: string) { if (el.textContent !== text) el.textContent = text; el.style.display = 'block'; }
  private _hideOverlay(el: HTMLDivElement) { el.style.display = 'none'; }

  dispose() {
    for (const v of this._vehicles) this._scene.remove(v.mesh);
    this._vehicles = [];
    this._mounted  = null;
    for (const fn of this._cleanups) fn();
    this._cleanups = [];
  }
}
