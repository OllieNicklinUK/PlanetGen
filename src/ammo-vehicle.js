// AmmoVehicle — btRaycastVehicle wrapper using Alon Zakai's Ammo.js
// (Bullet Physics via Emscripten: github.com/kripken/ammo.js)
//
// Provides a proper rigid-body vehicle simulation:
//   • 4-wheel suspension with spring/damper per wheel
//   • Tyre friction and lateral grip (no hand-rolled approximations)
//   • Weight transfer on braking / cornering
//   • Terrain collision via btBvhTriangleMeshShape sampled from getTerrainHeight()
//
// USAGE
//   const av = new AmmoVehicle(Ammo, spawnX, spawnY, spawnZ);
//   // each frame:
//   av.setEngine(engineForce);    // positive = forward
//   av.setSteering(steerAngle);   // radians, positive = left
//   av.setBrake(brakeForce);
//   av.update(delta);
//   const { pos, quat } = av.getTransform();  // sync to Three.js mesh
//
// TERRAIN
//   buildTerrain(cx, cz) creates a 64×64 grid (4 m/cell = 256×256 m coverage).
//   Call refreshTerrainIfNeeded(carX, carZ) each frame; it rebuilds only when
//   the car is more than 80 m from the terrain centre.

import { getTerrainHeight } from './noise.js';

// ── Ammo.js loader ───────────────────────────────────────────────────────────
// ammo.js is a CJS/UMD bundle that Vite's ESM bundler cannot import reliably.
// We serve it from /public/ammo.js as a plain script tag instead; the UMD
// wrapper sets window.Ammo, then we call window.Ammo() to get the initialised
// Bullet Physics module.
export function loadAmmoJS() {
  return new Promise((resolve, reject) => {
    if (typeof window.Ammo !== 'undefined') {
      resolve(typeof window.Ammo === 'function' ? window.Ammo() : window.Ammo);
      return;
    }
    const s    = document.createElement('script');
    s.src      = '/ammo.js';
    s.onload   = () => resolve(
      typeof window.Ammo === 'function' ? window.Ammo() : window.Ammo,
    );
    s.onerror  = () => reject(new Error('Failed to load /ammo.js'));
    document.head.appendChild(s);
  });
}

// ── Tuning ──────────────────────────────────────────────────────────────────

const CHASSIS_HALF  = [0.95, 0.25, 2.05];   // half-extents of collision box (m)
const CHASSIS_MASS  = 1200;                  // kg
const GRAVITY       = -15;                   // m/s²  (less floaty than real 9.8)

const WHEEL_RADIUS  = 0.36;                  // m
const SUSP_REST     = 0.25;                  // m  rest length
const SUSP_STIFF    = 50;                    // spring stiffness
const SUSP_DAMP_R   = 2.3;                   // relaxation damping
const SUSP_DAMP_C   = 4.4;                   // compression damping
const FRICTION_SLIP = 1.8;                   // tyre grip — lower reduces rolling resistance
const ROLL_INFL     = 0.05;                  // roll influence

const ENGINE_MAX    = 40000;                 // N — Bullet absorbs most internally; needs to be high
const BRAKE_MAX     = 1000;                  // N
const STEER_MAX     = 0.42;                  // max steering angle (rad)

// Wheel positions in chassis local space: [x, y, z, isFront]
const WHEEL_DEFS = [
  [-0.85,  0.0,  1.3,  true ],   // front-left
  [ 0.85,  0.0,  1.3,  true ],   // front-right
  [-0.85,  0.0, -1.4,  false],   // rear-left
  [ 0.85,  0.0, -1.4,  false],   // rear-right
];

const TERRAIN_GRID  = 24;   // cells per side (24×24 = 576 quads — fast to build)
const TERRAIN_STEP  = 8.0;  // metres per cell  → 192 m total coverage
const TERRAIN_RESET = 60;   // rebuild when car is this far from mesh centre

// ── AmmoVehicle ──────────────────────────────────────────────────────────────

export class AmmoVehicle {
  constructor(Ammo, spawnX, spawnY, spawnZ) {
    this._A = Ammo;

    this._engineForce  = 0;
    this._brakeForce   = 0;
    this._steerAngle   = 0;
    this._currentSteer = 0;    // smoothed steering angle

    this._terrainCX    = null;  // centre of current terrain mesh
    this._terrainCZ    = null;
    this._terrainBody  = null;

    // ── Physics world ───────────────────────────────────────────────────────
    const cfg        = new Ammo.btDefaultCollisionConfiguration();
    const dispatcher = new Ammo.btCollisionDispatcher(cfg);
    const broadphase = new Ammo.btDbvtBroadphase();
    const solver     = new Ammo.btSequentialImpulseConstraintSolver();
    this._world      = new Ammo.btDiscreteDynamicsWorld(
      dispatcher, broadphase, solver, cfg,
    );
    const grav = new Ammo.btVector3(0, GRAVITY, 0);
    this._world.setGravity(grav);
    Ammo.destroy(grav);

    // ── Terrain collision (built at first call to refreshTerrainIfNeeded) ───
    this.buildTerrain(spawnX, spawnZ);

    // ── Chassis rigid body ──────────────────────────────────────────────────
    const halfExt   = new Ammo.btVector3(...CHASSIS_HALF);
    const shape     = new Ammo.btBoxShape(halfExt);
    Ammo.destroy(halfExt);

    const startTf   = new Ammo.btTransform();
    startTf.setIdentity();
    // Spawn so wheel bottoms just touch the ground (no gap, no overlap)
    const origin = new Ammo.btVector3(spawnX, spawnY + SUSP_REST + WHEEL_RADIUS, spawnZ);
    startTf.setOrigin(origin);
    Ammo.destroy(origin);

    const localInertia = new Ammo.btVector3(0, 0, 0);
    shape.calculateLocalInertia(CHASSIS_MASS, localInertia);
    const motionState  = new Ammo.btDefaultMotionState(startTf);
    const rbInfo       = new Ammo.btRigidBodyConstructionInfo(
      CHASSIS_MASS, motionState, shape, localInertia,
    );
    this._chassis      = new Ammo.btRigidBody(rbInfo);
    Ammo.destroy(startTf);
    Ammo.destroy(localInertia);
    Ammo.destroy(rbInfo);

    this._chassis.setDamping(0.0, 0.05);  // zero linear damping — all speed control via engine/brake
    this._chassis.setActivationState(4); // DISABLE_DEACTIVATION

    this._world.addRigidBody(this._chassis);

    // ── btRaycastVehicle ────────────────────────────────────────────────────
    const tuning    = new Ammo.btVehicleTuning();
    const raycaster = new Ammo.btDefaultVehicleRaycaster(this._world);
    this._vehicle   = new Ammo.btRaycastVehicle(tuning, this._chassis, raycaster);
    // right = X (0), up = Y (1), forward = Z (2)
    this._vehicle.setCoordinateSystem(0, 1, 2);
    this._world.addAction(this._vehicle);

    // ── Wheels ──────────────────────────────────────────────────────────────
    const down = new Ammo.btVector3(0, -1, 0);
    const axle = new Ammo.btVector3(-1, 0, 0);

    for (const [wx, wy, wz, isFront] of WHEEL_DEFS) {
      const pos = new Ammo.btVector3(wx, wy, wz);
      this._vehicle.addWheel(pos, down, axle, SUSP_REST, WHEEL_RADIUS, tuning, isFront);
      Ammo.destroy(pos);
    }
    Ammo.destroy(down);
    Ammo.destroy(axle);

    for (let i = 0; i < WHEEL_DEFS.length; i++) {
      const wi = this._vehicle.getWheelInfo(i);
      wi.set_m_suspensionStiffness(SUSP_STIFF);
      wi.set_m_wheelsDampingRelaxation(SUSP_DAMP_R);
      wi.set_m_wheelsDampingCompression(SUSP_DAMP_C);
      wi.set_m_frictionSlip(FRICTION_SLIP);
      wi.set_m_rollInfluence(ROLL_INFL);
    }

    // Scratch transform for reading position each frame (no allocation in update)
    this._tf = new Ammo.btTransform();
  }

  // ── Terrain collision ──────────────────────────────────────────────────────

  buildTerrain(cx, cz) {
    const Ammo     = this._A;
    const halfSize = TERRAIN_GRID * TERRAIN_STEP * 0.5;
    const startX   = cx - halfSize;
    const startZ   = cz - halfSize;

    // Build a btBvhTriangleMeshShape from the same noise function used for
    // the visual terrain so physics and visuals match exactly.
    // 24×24 = 576 quads = 1152 triangles — builds in < 10 ms.
    const triMesh = new Ammo.btTriangleMesh(true, true);

    // Reuse three Ammo vectors for all triangles (no per-triangle allocation)
    const va = new Ammo.btVector3(0, 0, 0);
    const vb = new Ammo.btVector3(0, 0, 0);
    const vc = new Ammo.btVector3(0, 0, 0);

    for (let gx = 0; gx < TERRAIN_GRID; gx++) {
      for (let gz = 0; gz < TERRAIN_GRID; gz++) {
        const x0 = startX + gx * TERRAIN_STEP;
        const z0 = startZ + gz * TERRAIN_STEP;
        const x1 = x0 + TERRAIN_STEP;
        const z1 = z0 + TERRAIN_STEP;
        const y00 = getTerrainHeight(x0, z0);
        const y10 = getTerrainHeight(x1, z0);
        const y01 = getTerrainHeight(x0, z1);
        const y11 = getTerrainHeight(x1, z1);

        va.setValue(x0, y00, z0); vb.setValue(x1, y10, z0); vc.setValue(x0, y01, z1);
        triMesh.addTriangle(va, vb, vc, false);
        va.setValue(x1, y10, z0); vb.setValue(x1, y11, z1); vc.setValue(x0, y01, z1);
        triMesh.addTriangle(va, vb, vc, false);
      }
    }
    Ammo.destroy(va); Ammo.destroy(vb); Ammo.destroy(vc);

    const terrainShape = new Ammo.btBvhTriangleMeshShape(triMesh, true, true);

    if (this._terrainBody) {
      this._world.removeRigidBody(this._terrainBody);
    }

    const tf   = new Ammo.btTransform();
    tf.setIdentity();
    const ms   = new Ammo.btDefaultMotionState(tf);
    const zero = new Ammo.btVector3(0, 0, 0);
    const info = new Ammo.btRigidBodyConstructionInfo(0, ms, terrainShape, zero);
    this._terrainBody = new Ammo.btRigidBody(info);
    Ammo.destroy(tf); Ammo.destroy(zero); Ammo.destroy(info);

    this._world.addRigidBody(this._terrainBody);
    this._terrainCX = cx;
    this._terrainCZ = cz;
    console.log(`[AmmoVehicle] terrain built at (${cx.toFixed(0)}, ${cz.toFixed(0)})`);
  }

  refreshTerrainIfNeeded(carX, carZ) {
    if (
      this._terrainCX === null ||
      Math.hypot(carX - this._terrainCX, carZ - this._terrainCZ) > TERRAIN_RESET
    ) {
      this.buildTerrain(carX, carZ);
    }
  }

  // ── Inputs ─────────────────────────────────────────────────────────────────

  setEngine(force) {
    this._engineForce = Math.max(-ENGINE_MAX, Math.min(ENGINE_MAX, force));
  }

  setSteering(angle) {
    this._steerAngle = Math.max(-STEER_MAX, Math.min(STEER_MAX, angle));
  }

  setBrake(force) {
    this._brakeForce = Math.max(0, Math.min(BRAKE_MAX, force));
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta) {
    const v = this._vehicle;
    // Smooth steering
    const steerSpeed = 3.5;
    this._currentSteer += (this._steerAngle - this._currentSteer)
                        * Math.min(1, steerSpeed * delta);

    // ── DIRECTION NOTE ──────────────────────────────────────────────────────
    // With axle = (-1,0,0) and setCoordinateSystem(0,1,2), positive engine
    // force pushes the Bullet chassis in +Z. But the Three.js player faces -Z,
    // so we NEGATE the force: positive _engineForce = player-forward = Bullet -Z.
    const ef = -this._engineForce;

    // Front wheels: steering + engine (AWD for maximum traction on any surface)
    v.setSteeringValue(this._currentSteer, 0);
    v.setSteeringValue(this._currentSteer, 1);
    v.applyEngineForce(ef * 0.5, 0);   // front axle — 50% of torque
    v.applyEngineForce(ef * 0.5, 1);

    // Rear wheels: engine force
    v.applyEngineForce(ef, 2);
    v.applyEngineForce(ef, 3);

    // All wheels: braking
    v.setBrake(this._brakeForce * 0.6, 0);
    v.setBrake(this._brakeForce * 0.6, 1);
    v.setBrake(this._brakeForce, 2);
    v.setBrake(this._brakeForce, 3);

    // Step physics — up to 2 sub-steps for stability
    this._world.stepSimulation(delta, 2, 1 / 120);
  }

  // ── Read-back ──────────────────────────────────────────────────────────────

  /** World-space position and quaternion of the chassis. */
  getTransform() {
    const Ammo = this._A;
    this._chassis.getMotionState().getWorldTransform(this._tf);
    const o   = this._tf.getOrigin();
    const rot = this._tf.getRotation();
    return {
      px: o.x(),   py: o.y(),   pz: o.z(),
      qx: rot.x(), qy: rot.y(), qz: rot.z(), qw: rot.w(),
    };
  }

  /** World-space transform of one of the 4 wheels (for animated wheels). */
  getWheelTransform(i) {
    this._vehicle.updateWheelTransform(i, true);
    const wt  = this._vehicle.getWheelInfo(i).get_m_worldTransform();
    const o   = wt.getOrigin();
    const rot = wt.getRotation();
    return {
      px: o.x(), py: o.y(), pz: o.z(),
      qx: rot.x(), qy: rot.y(), qz: rot.z(), qw: rot.w(),
    };
  }

  /** Current speed in m/s (signed: positive = forward). */
  getSpeed() {
    // getCurrentSpeedKmHour is absent in ammo.js 0.0.10 — derive from chassis
    // linear velocity projected onto the chassis forward axis.
    const vel = this._chassis.getLinearVelocity();
    const tf  = this._chassis.getWorldTransform();
    const rot = tf.getRotation();
    // Forward vector of chassis (local +Z rotated by chassis quaternion)
    // Using quaternion-rotate: fwd = q * (0,0,1) * q^-1, simplified:
    const qx = rot.x(), qy = rot.y(), qz = rot.z(), qw = rot.w();
    const fwdX = 2*(qx*qz + qw*qy);
    const fwdY = 2*(qy*qz - qw*qx);
    const fwdZ = 1 - 2*(qx*qx + qy*qy);
    return vel.x()*fwdX + vel.y()*fwdY + vel.z()*fwdZ;
  }
}
