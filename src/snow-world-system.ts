// SnowWorldSystem — infinite mountain peak.
//
// Terrain: flat summit at PEAK_Y. Outside FLAT_RADIUS the terrain drops
// steeply — radial slope creates the impression of an infinite mountain.
// Standard IWSDK locomotion handles all player movement (same as PlanetGen).
// Deformation: vertex displacement stamps a snow trail as the player walks.
//
// Press P to open the parameter panel.

import {
  createSystem,
  LocomotionEnvironment,
  LocomotionSystem,
  InputComponent,
  Vector3,
  AmbientLight,
  DirectionalLight,
  Color,
  FogExp2,
  MeshStandardMaterial,
  TextureLoader,
  Mesh,
  InstancedMesh,
  BufferGeometry,
  BufferAttribute,
  RepeatWrapping,
  DoubleSide,
} from '@iwsdk/core';

import { rebuildNoise, simplex2 } from './noise.js';
import { initTrees, generatePinesForChunk, updateTreeWind } from './tree-generator.js';

// ── Fixed ────────────────────────────────────────────────────────────────────

const CHUNK_SIZE  = 128;   // m per chunk (smaller = finer detail near summit)
const CHUNK_SEGS  = 64;    // vertex subdivisions → 2 m spacing
const VIEW_RADIUS = 3;     // chunks streamed in every direction
const SNOW_SEED   = 77777;
const UV_TILE     = 3;     // snow texture repeats every 3 m

// Slope physics
const GRAVITY_ACCEL  = 28.0;
const DRAG           = 0.18;
const STEER_RATE     = 2.0;   // radians/sec at full stick — rotates velocity direction
const MAX_SPEED      = 64.0;

// Jump
const JUMP_SPEED     = 10.0;  // m/s initial upward velocity
const JUMP_GRAVITY   = 28.0;  // m/s² downward during jump

// Deformation
const DEFORM_RADIUS    = 3.5;
const DEFORM_MAX_DEPTH = 0.30;
const DEFORM_STEP      = 0.5;
const WAVE_AMP         = 0.007;
const WAVE_FREQ        = 3.5;

// ── Tweakable params ─────────────────────────────────────────────────────────

let P_FLAT_RADIUS = 40;   // m — radius of safe flat summit zone
let P_PEAK_Y      = 2;    // m — altitude of the summit
let P_SLOPE       = 0.55; // m drop per m of radial distance outside flat zone
let P_NOISE_AMP   = 6.0;  // amplitude of noise on the slopes (0 = smooth)
let P_AMBIENT     = 0.0;  // minimum
let P_SUN         = 0.3;  // minimum

// ── Height function ──────────────────────────────────────────────────────────

export function getSnowHeight(wx: number, wz: number): number {
  const r = Math.sqrt(wx * wx + wz * wz);

  // Terrain drops radially outside the flat zone
  const slopeDrop = Math.max(0, r - P_FLAT_RADIUS) * P_SLOPE;

  // Noise fades from 0 at the summit edge to full amplitude 30 m out
  const noiseFade = Math.min(1, Math.max(0, (r - P_FLAT_RADIUS) / 30));
  const large  = simplex2(wx * 0.015 + 10, wz * 0.015 + 10) * P_NOISE_AMP * noiseFade;
  const medium = simplex2(wx * 0.06  + 20, wz * 0.06  + 20) * (P_NOISE_AMP * 0.35) * noiseFade;

  return P_PEAK_Y - slopeDrop + large + medium;
}

// ── Chunk type ───────────────────────────────────────────────────────────────

interface RampLaunch { x: number; z: number; r2: number; vel: number; }

interface SnowChunk {
  entity:       any;
  mesh:         Mesh;
  originalY:    Float32Array;
  treeMeshes:   InstancedMesh[];
  rampEntities: any[];
  rampLaunches: RampLaunch[];
}

// ── System ───────────────────────────────────────────────────────────────────

export class SnowWorldSystem extends createSystem({}, {}) {
  private _chunks       = new Map<string, SnowChunk>();
  private _playerPos!:   Vector3;
  private _lastStampPos = new Vector3(Infinity, Infinity, Infinity);
  private _velX = 0;
  private _velZ = 0;
  private _physX = 0;  // authoritative physics position — independent of locomotor lerp
  private _physZ = 0;
  private _jumpVel     = 0;
  private _jumpY       = 0;
  private _isAirborne  = false;
  private _braking     = false;
  private _elapsed     = 0;
  private _slideDir!: Vector3;
  private _sharedMat:   MeshStandardMaterial | null = null;
  private _ambient!:    AmbientLight;
  private _sun!:        DirectionalLight;
  private _paramPanel:  HTMLDivElement | null = null;
  private _rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private _hasLanded    = false;  // true once player reaches terrain after spawn

  init() {
    rebuildNoise(SNOW_SEED);

    const scene = this.world.scene;
    scene.background = new Color(0xaac8e8);
    scene.fog        = new FogExp2(0xaac8e8, 0.004);

    this._ambient = new AmbientLight(0xd0e8ff, P_AMBIENT);
    scene.add(this._ambient);

    const sun = new DirectionalLight(0xfff8f0, P_SUN);
    sun.position.set(200, 500, -300);
    sun.castShadow           = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.far    = 1500;
    sun.shadow.camera.left   =
    sun.shadow.camera.bottom = -400;
    sun.shadow.camera.right  =
    sun.shadow.camera.top    =  400;
    this._sun = sun;
    scene.add(sun);

    const loco = this.world.getSystem(LocomotionSystem);
    if (loco) {
      loco.config.slidingSpeed.value    = 50;
      loco.config.maxDropDistance.value = 15;
      loco.config.comfortAssist.value   = 0;  // no vignette during slope sliding
    }

    this._playerPos = new Vector3(0, P_PEAK_Y + 5, 0);
    this._slideDir  = new Vector3();

    const loader = new TextureLoader();
    const loadTex = (path: string) => {
      const t = loader.load(path);
      (t as any).wrapS = (t as any).wrapT = RepeatWrapping;
      return t;
    };
    this._sharedMat = new MeshStandardMaterial({
      map:          loadTex('/textures/snow/snow-color.jpg'),
      normalMap:    loadTex('/textures/snow/snow-normal-gl.jpg'),
      roughnessMap: loadTex('/textures/snow/snow-roughness.jpg'),
      aoMap:        loadTex('/textures/snow/snow-ambientocclusion.jpg'),
      roughness: 1.0,
      metalness: 0.0,
      vertexColors: false,
    });

    initTrees(); // builds pine geometry if not already done

    // Space bar jump / S brake
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space' && !this._isAirborne && this._hasLanded) {
        const loco = this.world.getSystem(LocomotionSystem);
        if (!loco) return;
        this._jumpY      = getSnowHeight((this as any).player.position.x, (this as any).player.position.z) + 2;
        this._jumpVel    = JUMP_SPEED;
        this._isAirborne = true;
        loco.config.maxDropDistance.value = 0.5;
      }
      if (e.code === 'KeyS') this._braking = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyS') this._braking = false;
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup',   onKeyUp);
    this.cleanupFuncs.push(() => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup',   onKeyUp);
    });

    this._streamChunks(0, 0);
    this._createParamPanel();

    this.cleanupFuncs.push(() => {
      if (this._rebuildTimer !== null) { clearTimeout(this._rebuildTimer); this._rebuildTimer = null; }
      for (const [, c] of this._chunks) {
        c.entity.dispose();
        for (const m of c.treeMeshes) this.scene.remove(m);
        for (const e of c.rampEntities) e.dispose();
      }
      this._chunks.clear();
      this.scene.remove(this._ambient, this._sun);
      this.scene.fog = null;
      this.scene.background = null;
      this._paramPanel?.remove();
      this._paramPanel = null;
      const loco = this.world.getSystem(LocomotionSystem);
      if (loco) {
        loco.config.slidingSpeed.value    = 50;
        loco.config.maxDropDistance.value = 5;
        loco.config.comfortAssist.value   = 1;
      }
    });
  }

  update(delta: number, time: number) {
    const player = (this as any).player;
    const input  = (this as any).input;
    if (!player?.head) return;
    player.head.getWorldPosition(this._playerPos);
    this._elapsed += delta;
    updateTreeWind(this._elapsed);

    // Nudge worker until terrain BVH confirms a floor hit after spawn.
    if (!this._hasLanded) {
      const spx = player.position.x, spz = player.position.z;
      const terrainY = getSnowHeight(spx, spz);
      if (player.position.y < terrainY + 4) {
        this._hasLanded = true;
        this._physX = spx;   // seed physics position from actual landing point
        this._physZ = spz;
      } else {
        const loco = this.world.getSystem(LocomotionSystem);
        loco?.['locomotor']?.teleport(this._slideDir.set(spx, terrainY + 2, spz));
      }
      this._streamChunks(spx, spz);
      return;
    }

    // Use our own integrated position — never read player.position on the slope because
    // LocomotionSystem overwrites it each frame with the locomotor's lerped value, which
    // would create a one-frame-delay feedback loop and cause visible jitter.
    const px = this._physX;
    const pz = this._physZ;

    const r = Math.sqrt(px * px + pz * pz);
    if (r > P_FLAT_RADIUS && r > 0.01) {
      const nx = px / r;
      const nz = pz / r;

      this._velX += GRAVITY_ACCEL * P_SLOPE * nx * delta;
      this._velZ += GRAVITY_ACCEL * P_SLOPE * nz * delta;

      // Rotate velocity vector to steer — preserves speed, no force fighting.
      const axes = input?.gamepads?.left?.getAxesValues(InputComponent.Thumbstick) ?? { x: 0, y: 0 };
      if (Math.abs(axes.x) > 0.15) {
        const angle = axes.x * STEER_RATE * delta;
        const c = Math.cos(angle), s = Math.sin(angle);
        const rvx = this._velX * c - this._velZ * s;
        const rvz = this._velX * s + this._velZ * c;
        this._velX = rvx;
        this._velZ = rvz;
      }

      const drag = Math.exp(-(DRAG + (this._braking ? 4.0 : 0)) * delta);
      this._velX *= drag;
      this._velZ *= drag;
      const spd = Math.sqrt(this._velX ** 2 + this._velZ ** 2);
      if (spd > MAX_SPEED) { const s = MAX_SPEED / spd; this._velX *= s; this._velZ *= s; }

      this._physX += this._velX * delta;
      this._physZ += this._velZ * delta;

      const groundY = getSnowHeight(this._physX, this._physZ);
      const loco = this.world.getSystem(LocomotionSystem);

      // Ramp launch trigger — check all loaded chunk launch points.
      if (!this._isAirborne) {
        outer: for (const [, chunk] of this._chunks) {
          for (const launch of chunk.rampLaunches) {
            const dx = this._physX - launch.x;
            const dz = this._physZ - launch.z;
            if (dx * dx + dz * dz < launch.r2) {
              this._isAirborne = true;
              this._jumpY      = player.position.y + 0.5;
              this._jumpVel    = launch.vel;
              loco!.config.maxDropDistance.value = 0.5;
              break outer;
            }
          }
        }
      }

      if (this._isAirborne) {
        this._jumpVel -= JUMP_GRAVITY * delta;
        this._jumpY  += this._jumpVel * delta;
        if (this._jumpY <= groundY + 1.8) {
          this._isAirborne = false;
          this._jumpVel    = 0;
          loco!.config.maxDropDistance.value = 15;
          loco?.['locomotor']?.teleport(this._slideDir.set(this._physX, groundY + 2, this._physZ));
        } else {
          loco?.['locomotor']?.teleport(this._slideDir.set(this._physX, this._jumpY, this._physZ));
        }
      } else {
        loco?.['locomotor']?.teleport(this._slideDir.set(this._physX, groundY + 2, this._physZ));
      }
    } else {
      // Flat summit — let standard locomotion walk freely, sync our position from it.
      this._physX = player.position.x;
      this._physZ = player.position.z;
      this._velX  = 0;
      this._velZ  = 0;
    }

    this._streamChunks(this._physX, this._physZ);
    this._maybeStampDeformation();
  }

  /** Zero all sliding/jump state so teleports aren't fought by residual velocity. */
  resetPhysics() {
    this._velX       = 0;
    this._velZ       = 0;
    this._jumpVel    = 0;
    this._isAirborne = false;
    this._braking    = false;
    this._hasLanded  = false;
    this._physX      = 0;
    this._physZ      = 0;
  }

  // ── Deformation ────────────────────────────────────────────────────────────

  private _maybeStampDeformation() {
    if (this._playerPos.distanceTo(this._lastStampPos) < DEFORM_STEP) return;
    this._lastStampPos.copy(this._playerPos);
    this._stampAt(this._playerPos.x, this._playerPos.z);
  }

  private _stampAt(px: number, pz: number) {
    for (const [, chunk] of this._chunks) {
      const ox = chunk.mesh.position.x;
      const oz = chunk.mesh.position.z;
      if (Math.abs(px - ox) > CHUNK_SIZE / 2 + DEFORM_RADIUS) continue;
      if (Math.abs(pz - oz) > CHUNK_SIZE / 2 + DEFORM_RADIUS) continue;

      const pos   = chunk.mesh.geometry.attributes.position as any;
      const verts = pos.array as Float32Array;
      let   dirty = false;

      for (let i = 0; i < pos.count; i++) {
        const vx   = verts[i * 3]     + ox;
        const vz   = verts[i * 3 + 2] + oz;
        const dist = Math.sqrt((vx - px) ** 2 + (vz - pz) ** 2);
        if (dist >= DEFORM_RADIUS) continue;

        const t   = (DEFORM_RADIUS - dist) / DEFORM_RADIUS;
        const dip = t * t * t * DEFORM_MAX_DEPTH * Math.sin((dist / DEFORM_RADIUS) * Math.PI);
        const ripple = WAVE_AMP * Math.sin(WAVE_FREQ * dist);
        const newY   = verts[i * 3 + 1] - dip + ripple;
        verts[i * 3 + 1] = Math.max(chunk.originalY[i] - DEFORM_MAX_DEPTH, newY);
        dirty = true;
      }

      if (dirty) {
        pos.needsUpdate = true;
        chunk.mesh.geometry.computeVertexNormals();
      }
    }
  }

  // ── Chunk streaming ────────────────────────────────────────────────────────

  private _streamChunks(px: number, pz: number) {
    const cx = Math.round(px / CHUNK_SIZE);
    const cz = Math.round(pz / CHUNK_SIZE);

    const needed = new Set<string>();
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
      for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
        const key = `${cx + dx}_${cz + dz}`;
        needed.add(key);
        if (!this._chunks.has(key)) this._buildChunk(cx + dx, cz + dz);
      }
    }

    for (const [key, chunk] of this._chunks) {
      if (!needed.has(key)) {
        chunk.entity.dispose();
        for (const m of chunk.treeMeshes) this.scene.remove(m);
        for (const e of chunk.rampEntities) e.dispose();
        this._chunks.delete(key);
      }
    }
  }

  // ── Ramp geometry ─────────────────────────────────────────────────────────
  // Wedge that rises from z=0 (low/approach) to z=depth (high/launch) in local space.
  // Rotate mesh.rotation.y = atan2(wx, wz) to face radially outward at spawn position.
  private _buildRampGeo(w: number, d: number, h: number): BufferGeometry {
    const hw = w / 2;
    const pos = new Float32Array([
      -hw, 0, 0,   // 0 low-left
       hw, 0, 0,   // 1 low-right
      -hw, 0, d,   // 2 high-base-left
       hw, 0, d,   // 3 high-base-right
      -hw, h, d,   // 4 high-top-left
       hw, h, d,   // 5 high-top-right
    ]);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex([
      0, 4, 1,  1, 4, 5,   // slope surface
      2, 3, 5,  2, 5, 4,   // back wall
      0, 2, 4,             // left side
      1, 5, 3,             // right side
      0, 1, 3,  0, 3, 2,  // bottom
    ]);
    geo.computeVertexNormals();
    return geo;
  }

  private _buildRampsForChunk(cx: number, cz: number): { entities: any[]; launches: RampLaunch[] } {
    const entities: any[]      = [];
    const launches: RampLaunch[] = [];

    const worldOffX = cx * CHUNK_SIZE;
    const worldOffZ = cz * CHUNK_SIZE;

    // Inline seeded RNG — deterministic per chunk.
    let s = (SNOW_SEED ^ (cx * 0x9E3779B9) ^ (cz * 0x517CC1B7)) >>> 0;
    const rng = () => { s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b) ^ (s >>> 16)) >>> 0; return s / 4294967296; };

    const RAMP_SIZES = [
      { w: 8,  d: 3, h: 0.5, vel: 5  },   // small
      { w: 12, d: 5, h: 1.2, vel: 8  },   // medium
      { w: 16, d: 7, h: 2.2, vel: 12 },   // large
    ];
    const RED  = new MeshStandardMaterial({ color: 0xdd1111, roughness: 0.4, metalness: 0.2, side: DoubleSide });
    const BLUE = new MeshStandardMaterial({ color: 0x1133dd, roughness: 0.4, metalness: 0.2, side: DoubleSide });

    const MAX_CANDIDATES = 12;
    let placed = 0;
    for (let i = 0; i < MAX_CANDIDATES && placed < 3; i++) {
      const lx = (rng() - 0.5) * CHUNK_SIZE;
      const lz = (rng() - 0.5) * CHUNK_SIZE;
      const wx = worldOffX + lx;
      const wz = worldOffZ + lz;
      const dist = Math.sqrt(wx * wx + wz * wz);

      if (dist < P_FLAT_RADIUS + 10) continue; // keep ramps off the flat top

      const gy = getSnowHeight(wx, wz);

      const sizeIdx = Math.floor(rng() * RAMP_SIZES.length);
      const sz      = RAMP_SIZES[sizeIdx];
      const isRed   = rng() < 0.5;
      const mat     = isRed ? RED.clone() : BLUE.clone();

      const geo  = this._buildRampGeo(sz.w, sz.d, sz.h);
      const mesh = new Mesh(geo, mat);
      mesh.position.set(wx, gy, wz);
      mesh.rotation.y = Math.atan2(wx, wz); // face radially outward
      mesh.castShadow = true;

      const entity = this.world.createTransformEntity(mesh, { parent: this.world.sceneEntity, persistent: true });
      entity.addComponent(LocomotionEnvironment, { type: 'static' });
      entities.push(entity);

      // Launch trigger at the high (outward) edge of the ramp.
      const nx = dist > 0 ? wx / dist : 0;
      const nz = dist > 0 ? wz / dist : 1;
      launches.push({ x: wx + nx * sz.d, z: wz + nz * sz.d, r2: 9, vel: sz.vel });
      placed++;
    }

    return { entities, launches };
  }

  private _buildChunk(cx: number, cz: number) {
    const segs    = CHUNK_SEGS;
    const size    = CHUNK_SIZE;
    const vCount  = (segs + 1) * (segs + 1);
    const originX = cx * size;
    const originZ = cz * size;

    const positions = new Float32Array(vCount * 3);
    const uvs       = new Float32Array(vCount * 2);
    const origY     = new Float32Array(vCount);

    for (let row = 0; row <= segs; row++) {
      for (let col = 0; col <= segs; col++) {
        const i  = row * (segs + 1) + col;
        const lx = (col / segs - 0.5) * size;
        const lz = (row / segs - 0.5) * size;
        const wx = originX + lx;
        const wz = originZ + lz;
        const wy = getSnowHeight(wx, wz);

        positions[i * 3]     = lx;
        positions[i * 3 + 1] = wy;
        positions[i * 3 + 2] = lz;
        origY[i]             = wy;

        uvs[i * 2]     = wx / UV_TILE;
        uvs[i * 2 + 1] = wz / UV_TILE;
      }
    }

    const indices = new Uint16Array(segs * segs * 6);
    let idx = 0;
    for (let row = 0; row < segs; row++) {
      for (let col = 0; col < segs; col++) {
        const tl = row * (segs + 1) + col;
        const tr = tl + 1;
        const bl = tl + segs + 1;
        const br = bl + 1;
        indices[idx++] = tl; indices[idx++] = bl; indices[idx++] = tr;
        indices[idx++] = tr; indices[idx++] = bl; indices[idx++] = br;
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('uv',       new BufferAttribute(uvs,           2));
    geo.setAttribute('uv2',      new BufferAttribute(uvs.slice(),   2));
    geo.setIndex(Array.from(indices));
    geo.computeVertexNormals();

    const mat  = this._sharedMat ?? new MeshStandardMaterial({ roughness: 0.9 });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(originX, 0, originZ);
    mesh.receiveShadow = true;

    const entity = this.world.createTransformEntity(mesh, {
      parent: this.world.sceneEntity, persistent: true,
    });
    entity.addComponent(LocomotionEnvironment, { type: 'static' });

    const treeMeshes = (generatePinesForChunk(
      this.world.scene, cx, cz, CHUNK_SIZE, SNOW_SEED, getSnowHeight,
    ) as InstancedMesh[]) ?? [];

    const { entities: rampEntities, launches: rampLaunches } = this._buildRampsForChunk(cx, cz);

    this._chunks.set(`${cx}_${cz}`, { entity, mesh, originalY: origY, treeMeshes, rampEntities, rampLaunches });
  }

  // ── Terrain rebuild ────────────────────────────────────────────────────────

  private _scheduleRebuild() {
    if (this._rebuildTimer !== null) clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      this._rebuildTimer = null;
      for (const [, c] of this._chunks) c.entity.dispose();
      this._chunks.clear();
      this._lastStampPos.set(Infinity, Infinity, Infinity);
      this._streamChunks(this._playerPos.x, this._playerPos.z);
    }, 400);
  }

  // ── Param panel ────────────────────────────────────────────────────────────

  private _createParamPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed','top:50%','left:50%','transform:translate(-50%,-50%)',
      'background:rgba(0,5,20,0.94)','border:1px solid rgba(100,180,255,0.35)',
      'border-radius:10px','padding:22px 26px','color:#cceeff',
      'font-family:monospace','font-size:13px','min-width:360px',
      'z-index:9999','display:none','max-height:85vh','overflow-y:auto',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:bold;color:#88ddff;text-align:center;margin-bottom:18px;letter-spacing:1px;';
    title.textContent = '❄ SNOW MOUNTAIN PARAMETERS';
    panel.appendChild(title);

    type PD = { label: string; min: number; max: number; step: number;
                get: () => number; set: (v: number) => void; rebuild: boolean };

    const params: PD[] = [
      { label:'FLAT RADIUS  (safe zone m)',   min:5,   max:60,  step:1,    rebuild:true,
        get:()=>P_FLAT_RADIUS, set:(v)=>{P_FLAT_RADIUS=v;} },
      { label:'PEAK Y  (summit altitude)',    min:-10, max:10,  step:0.5,  rebuild:true,
        get:()=>P_PEAK_Y,      set:(v)=>{P_PEAK_Y=v;} },
      { label:'SLOPE  (drop per m outward)',  min:0,   max:2,   step:0.05, rebuild:true,
        get:()=>P_SLOPE,       set:(v)=>{P_SLOPE=v;} },
      { label:'NOISE AMP  (slope texture)',   min:0,   max:20,  step:0.5,  rebuild:true,
        get:()=>P_NOISE_AMP,   set:(v)=>{P_NOISE_AMP=v;} },
      { label:'AMBIENT  (instant)',           min:0,   max:4,   step:0.05, rebuild:false,
        get:()=>P_AMBIENT,     set:(v)=>{P_AMBIENT=v; if(this._ambient) this._ambient.intensity=v;} },
      { label:'SUN  (instant)',               min:0,   max:6,   step:0.1,  rebuild:false,
        get:()=>P_SUN,         set:(v)=>{P_SUN=v;     if(this._sun)     this._sun.intensity=v;} },
    ];

    const sections: Record<number, string> = {
      0:'MOUNTAIN SHAPE', 4:'LIGHTING',
    };

    params.forEach((p, idx) => {
      if (sections[idx]) {
        const s = document.createElement('div');
        s.style.cssText = 'font-size:10px;color:#556688;letter-spacing:2px;margin:14px 0 8px;text-transform:uppercase;border-top:1px solid rgba(100,150,200,0.2);padding-top:12px;';
        s.textContent = sections[idx];
        panel.appendChild(s);
      }
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:12px;';
      const lRow = document.createElement('div');
      lRow.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;';
      const lbl = document.createElement('span');
      lbl.textContent = p.label;
      const valEl = document.createElement('span');
      valEl.textContent = String(p.get());
      valEl.style.cssText = 'color:#88ddff;min-width:50px;text-align:right;';
      lRow.appendChild(lbl); lRow.appendChild(valEl);
      const slider = document.createElement('input');
      slider.type='range'; slider.min=String(p.min); slider.max=String(p.max);
      slider.step=String(p.step); slider.value=String(p.get());
      slider.style.cssText='width:100%;accent-color:#44aaff;';
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        p.set(v); valEl.textContent = String(v);
        if (p.rebuild) this._scheduleRebuild();
      });
      row.appendChild(lRow); row.appendChild(slider);
      panel.appendChild(row);
    });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;margin-top:18px;';
    const mkBtn = (txt: string, bg: string) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = `flex:1;padding:9px;background:${bg};color:#cceeff;border:1px solid rgba(100,180,255,0.3);border-radius:5px;cursor:pointer;font-family:monospace;font-size:13px;`;
      return b;
    };
    const rb = mkBtn('Rebuild Now', '#1a3a66');
    rb.addEventListener('click', () => this._scheduleRebuild());
    const cb = mkBtn('Close  [P]', '#1a1a2e');
    cb.addEventListener('click', () => { panel.style.display = 'none'; });
    btnRow.appendChild(rb); btnRow.appendChild(cb);
    panel.appendChild(btnRow);

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:8px;font-size:11px;color:#445566;text-align:center;';
    hint.textContent = 'Shape sliders rebuild 400 ms after release. Press P to toggle.';
    panel.appendChild(hint);

    document.body.appendChild(panel);
    this._paramPanel = panel;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !e.repeat)
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
  }
}
