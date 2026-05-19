import {
  Scene, PerspectiveCamera,
  AmbientLight, DirectionalLight,
  Color, FogExp2,
  Mesh, InstancedMesh, BufferGeometry, BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial,
  TextureLoader, RepeatWrapping, DoubleSide, Vector3,
} from 'three';
import type { BvhPhysicsWorld, SimpleCharacter } from '@pmndrs/viverse';
import { rebuildNoise, simplex2 } from './noise.js';
import { initTrees, generatePinesForChunk, updateTreeWind } from './tree-generator.js';

const CHUNK_SIZE   = 128;
const CHUNK_SEGS   = 64;
const VIEW_RADIUS  = 3;
const SNOW_SEED    = 77777;
const UV_TILE      = 3;

const GRAVITY_ACCEL = 28.0;
const DRAG          = 0.18;
const STEER_RATE    = 2.0;
const MAX_SPEED     = 64.0;

const JUMP_SPEED    = 10.0;
const JUMP_GRAVITY  = 28.0;

const DEFORM_RADIUS    = 3.5;
const DEFORM_MAX_DEPTH = 0.30;
const DEFORM_STEP      = 0.5;
const WAVE_AMP         = 0.007;
const WAVE_FREQ        = 3.5;

let P_FLAT_RADIUS = 40;
let P_PEAK_Y      = 2;
let P_SLOPE       = 0.55;
let P_NOISE_AMP   = 6.0;
let P_AMBIENT     = 0.0;
let P_SUN         = 0.3;

export function getSnowHeight(wx: number, wz: number): number {
  const r         = Math.sqrt(wx * wx + wz * wz);
  const slopeDrop = Math.max(0, r - P_FLAT_RADIUS) * P_SLOPE;
  const noiseFade = Math.min(1, Math.max(0, (r - P_FLAT_RADIUS) / 30));
  const large     = simplex2(wx * 0.015 + 10, wz * 0.015 + 10) * P_NOISE_AMP * noiseFade;
  const medium    = simplex2(wx * 0.06  + 20, wz * 0.06  + 20) * (P_NOISE_AMP * 0.35) * noiseFade;
  return P_PEAK_Y - slopeDrop + large + medium;
}

interface RampLaunch { x: number; z: number; r2: number; vel: number; }
interface SnowChunk {
  mesh:       Mesh;
  originalY:  Float32Array;
  treeMeshes: InstancedMesh[];
  rampMeshes: Mesh[];
  rampLaunches: RampLaunch[];
}

export class SnowWorldManager {
  private _chunks       = new Map<string, SnowChunk>();
  private _playerPos    = new Vector3(0, P_PEAK_Y + 5, 0);
  private _lastStampPos = new Vector3(Infinity, Infinity, Infinity);
  private _velX = 0; private _velZ = 0;
  private _physX = 0; private _physZ = 0;
  private _jumpVel = 0; private _jumpY = 0;
  private _isAirborne = false;
  private _braking    = false;
  private _elapsed    = 0;
  private _slideDir   = new Vector3();
  private _sharedMat: MeshStandardMaterial | null = null;
  private _ambient!:  AmbientLight;
  private _sun!:      DirectionalLight;
  private _paramPanel: HTMLDivElement | null = null;
  private _rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private _hasLanded  = false;
  private _cleanups:  (() => void)[] = [];

  // Track all BVH-registered meshes for cleanup
  private _physicsMeshes: Set<Mesh> = new Set();

  constructor(
    private _scene:        Scene,
    private _physicsWorld: BvhPhysicsWorld,
    private _camera:       PerspectiveCamera,
    private _character:    SimpleCharacter,
    private _getPlayerPos: () => Vector3,
    private _setPlayerPos: (pos: {x:number;y:number;z:number}) => void,
  ) {}

  init() {
    rebuildNoise(SNOW_SEED);

    this._scene.background = new Color(0xaac8e8);
    this._scene.fog        = new FogExp2(0xaac8e8, 0.004);

    this._ambient = new AmbientLight(0xd0e8ff, P_AMBIENT);
    this._scene.add(this._ambient);

    const sun = new DirectionalLight(0xfff8f0, P_SUN);
    sun.position.set(200, 500, -300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.far    = 1500;
    sun.shadow.camera.left   = sun.shadow.camera.bottom = -400;
    sun.shadow.camera.right  = sun.shadow.camera.top    =  400;
    this._sun = sun;
    this._scene.add(sun);

    this._playerPos.set(0, P_PEAK_Y + 5, 0);
    this._slideDir = new Vector3();

    const loader   = new TextureLoader();
    const loadTex  = (path: string) => {
      const t = loader.load(path);
      (t as any).wrapS = (t as any).wrapT = RepeatWrapping;
      return t;
    };
    this._sharedMat = new MeshStandardMaterial({
      map:          loadTex('/textures/snow/snow-color.jpg'),
      normalMap:    loadTex('/textures/snow/snow-normal-gl.jpg'),
      roughnessMap: loadTex('/textures/snow/snow-roughness.jpg'),
      aoMap:        loadTex('/textures/snow/snow-ambientocclusion.jpg'),
      roughness: 1.0, metalness: 0.0, vertexColors: false,
    });

    initTrees();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space' && !this._isAirborne && this._hasLanded) {
        const pos = this._getPlayerPos();
        this._jumpY      = getSnowHeight(pos.x, pos.z) + 2;
        this._jumpVel    = JUMP_SPEED;
        this._isAirborne = true;
      }
      if (e.code === 'KeyS') this._braking = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyS') this._braking = false;
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup',   onKeyUp);
    this._cleanups.push(
      () => document.removeEventListener('keydown', onKeyDown),
      () => document.removeEventListener('keyup',   onKeyUp),
    );

    this._streamChunks(0, 0);
    this._createParamPanel();

    this._cleanups.push(() => {
      if (this._rebuildTimer !== null) { clearTimeout(this._rebuildTimer); this._rebuildTimer = null; }
      for (const [, c] of this._chunks) this._removeChunk(c);
      this._chunks.clear();
      this._scene.remove(this._ambient, this._sun);
      this._scene.fog        = null;
      this._scene.background = null;
      this._paramPanel?.remove();
      this._paramPanel = null;
    });
  }

  update(delta: number, time: number) {
    this._camera.getWorldPosition(this._playerPos);
    this._elapsed += delta;
    updateTreeWind(this._elapsed);

    const charPos = this._getPlayerPos();

    if (!this._hasLanded) {
      const terrainY = getSnowHeight(charPos.x, charPos.z);
      if (charPos.y < terrainY + 4) {
        this._hasLanded = true;
        this._physX = charPos.x;
        this._physZ = charPos.z;
      } else {
        this._setPlayerPos({ x: charPos.x, y: terrainY + 2, z: charPos.z });
      }
      this._streamChunks(charPos.x, charPos.z);
      return;
    }

    const px = this._physX;
    const pz = this._physZ;
    const r  = Math.sqrt(px * px + pz * pz);

    if (r > P_FLAT_RADIUS && r > 0.01) {
      const nx = px / r, nz = pz / r;

      this._velX += GRAVITY_ACCEL * P_SLOPE * nx * delta;
      this._velZ += GRAVITY_ACCEL * P_SLOPE * nz * delta;

      // Keyboard steering: A/D rotate velocity direction
      const steerX = (document as any).__snowSteerX ?? 0;
      if (Math.abs(steerX) > 0.05) {
        const angle = steerX * STEER_RATE * delta;
        const c = Math.cos(angle), s = Math.sin(angle);
        const rvx = this._velX * c - this._velZ * s;
        const rvz = this._velX * s + this._velZ * c;
        this._velX = rvx; this._velZ = rvz;
      }

      const drag = Math.exp(-(DRAG + (this._braking ? 4.0 : 0)) * delta);
      this._velX *= drag; this._velZ *= drag;
      const spd = Math.sqrt(this._velX ** 2 + this._velZ ** 2);
      if (spd > MAX_SPEED) { const sc = MAX_SPEED / spd; this._velX *= sc; this._velZ *= sc; }

      this._physX += this._velX * delta;
      this._physZ += this._velZ * delta;

      const groundY = getSnowHeight(this._physX, this._physZ);

      if (!this._isAirborne) {
        outer: for (const [, chunk] of this._chunks) {
          for (const launch of chunk.rampLaunches) {
            const dx = this._physX - launch.x, dz = this._physZ - launch.z;
            if (dx * dx + dz * dz < launch.r2) {
              this._isAirborne = true;
              this._jumpY      = charPos.y + 0.5;
              this._jumpVel    = launch.vel;
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
          this._setPlayerPos({ x: this._physX, y: groundY + 2, z: this._physZ });
        } else {
          this._setPlayerPos({ x: this._physX, y: this._jumpY,   z: this._physZ });
        }
      } else {
        this._setPlayerPos({ x: this._physX, y: groundY + 2,   z: this._physZ });
      }
    } else {
      this._physX = charPos.x;
      this._physZ = charPos.z;
      this._velX  = 0; this._velZ = 0;
    }

    this._streamChunks(this._physX, this._physZ);
    this._maybeStampDeformation();
  }

  resetPhysics() {
    this._velX = this._velZ = this._jumpVel = 0;
    this._isAirborne = this._braking = this._hasLanded = false;
    this._physX = this._physZ = 0;
  }

  private _maybeStampDeformation() {
    if (this._playerPos.distanceTo(this._lastStampPos) < DEFORM_STEP) return;
    this._lastStampPos.copy(this._playerPos);
    this._stampAt(this._playerPos.x, this._playerPos.z);
  }

  private _stampAt(px: number, pz: number) {
    for (const [, chunk] of this._chunks) {
      const ox = chunk.mesh.position.x, oz = chunk.mesh.position.z;
      if (Math.abs(px - ox) > CHUNK_SIZE / 2 + DEFORM_RADIUS) continue;
      if (Math.abs(pz - oz) > CHUNK_SIZE / 2 + DEFORM_RADIUS) continue;
      const pos = chunk.mesh.geometry.attributes.position as any;
      const verts = pos.array as Float32Array;
      let dirty = false;
      for (let i = 0; i < pos.count; i++) {
        const vx = verts[i * 3] + ox, vz = verts[i * 3 + 2] + oz;
        const dist = Math.sqrt((vx - px) ** 2 + (vz - pz) ** 2);
        if (dist >= DEFORM_RADIUS) continue;
        const t      = (DEFORM_RADIUS - dist) / DEFORM_RADIUS;
        const dip    = t * t * t * DEFORM_MAX_DEPTH * Math.sin((dist / DEFORM_RADIUS) * Math.PI);
        const ripple = WAVE_AMP * Math.sin(WAVE_FREQ * dist);
        verts[i * 3 + 1] = Math.max(chunk.originalY[i] - DEFORM_MAX_DEPTH, verts[i * 3 + 1] - dip + ripple);
        dirty = true;
      }
      if (dirty) { pos.needsUpdate = true; chunk.mesh.geometry.computeVertexNormals(); }
    }
  }

  private _streamChunks(px: number, pz: number) {
    const cx = Math.round(px / CHUNK_SIZE), cz = Math.round(pz / CHUNK_SIZE);
    const needed = new Set<string>();
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
      for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
        const key = `${cx + dx}_${cz + dz}`;
        needed.add(key);
        if (!this._chunks.has(key)) this._buildChunk(cx + dx, cz + dz);
      }
    }
    for (const [key, chunk] of this._chunks) {
      if (!needed.has(key)) { this._removeChunk(chunk); this._chunks.delete(key); }
    }
  }

  private _removeChunk(c: SnowChunk) {
    this._physicsWorld.removeBody(c.mesh);
    this._scene.remove(c.mesh);
    for (const m of c.treeMeshes) this._scene.remove(m);
    for (const m of c.rampMeshes) { this._physicsWorld.removeBody(m); this._scene.remove(m); }
  }

  private _buildRampGeo(w: number, d: number, h: number): BufferGeometry {
    const hw = w / 2;
    const pos = new Float32Array([-hw,0,0, hw,0,0, -hw,0,d, hw,0,d, -hw,h,d, hw,h,d]);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex([0,4,1, 1,4,5, 2,3,5, 2,5,4, 0,2,4, 1,5,3, 0,1,3, 0,3,2]);
    geo.computeVertexNormals();
    return geo;
  }

  private _buildRampsForChunk(cx: number, cz: number): { meshes: Mesh[]; launches: RampLaunch[] } {
    const meshes:   Mesh[]       = [];
    const launches: RampLaunch[] = [];
    const worldOffX = cx * CHUNK_SIZE, worldOffZ = cz * CHUNK_SIZE;

    let s = (SNOW_SEED ^ (cx * 0x9E3779B9) ^ (cz * 0x517CC1B7)) >>> 0;
    const rng = () => { s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b) ^ (s >>> 16)) >>> 0; return s / 4294967296; };

    const RAMP_SIZES = [
      { w: 8,  d: 3, h: 0.5, vel: 5  },
      { w: 12, d: 5, h: 1.2, vel: 8  },
      { w: 16, d: 7, h: 2.2, vel: 12 },
    ];

    let placed = 0;
    for (let i = 0; i < 12 && placed < 3; i++) {
      const lx = (rng() - 0.5) * CHUNK_SIZE, lz = (rng() - 0.5) * CHUNK_SIZE;
      const wx = worldOffX + lx, wz = worldOffZ + lz;
      if (Math.sqrt(wx * wx + wz * wz) < P_FLAT_RADIUS + 10) continue;

      const gy  = getSnowHeight(wx, wz);
      const sz  = RAMP_SIZES[Math.floor(rng() * RAMP_SIZES.length)];
      const mat = new MeshStandardMaterial({ color: rng() < 0.5 ? 0xdd1111 : 0x1133dd, roughness: 0.4, metalness: 0.2, side: DoubleSide });
      const mesh = new Mesh(this._buildRampGeo(sz.w, sz.d, sz.h), mat);
      mesh.position.set(wx, gy, wz);
      mesh.rotation.y = Math.atan2(wx, wz);
      mesh.castShadow = true;
      this._scene.add(mesh);
      mesh.updateWorldMatrix(true, true);
      this._physicsWorld.addBody(mesh, false);
      meshes.push(mesh);

      const dist = Math.sqrt(wx * wx + wz * wz);
      const nx = dist > 0 ? wx / dist : 0, nz = dist > 0 ? wz / dist : 1;
      launches.push({ x: wx + nx * sz.d, z: wz + nz * sz.d, r2: 9, vel: sz.vel });
      placed++;
    }
    return { meshes, launches };
  }

  private _buildChunk(cx: number, cz: number) {
    const segs = CHUNK_SEGS, size = CHUNK_SIZE;
    const vCount = (segs + 1) * (segs + 1);
    const originX = cx * size, originZ = cz * size;

    const positions = new Float32Array(vCount * 3);
    const uvs       = new Float32Array(vCount * 2);
    const origY     = new Float32Array(vCount);

    for (let row = 0; row <= segs; row++) {
      for (let col = 0; col <= segs; col++) {
        const i  = row * (segs + 1) + col;
        const lx = (col / segs - 0.5) * size, lz = (row / segs - 0.5) * size;
        const wx = originX + lx, wz = originZ + lz;
        const wy = getSnowHeight(wx, wz);
        positions[i * 3] = lx; positions[i * 3 + 1] = wy; positions[i * 3 + 2] = lz;
        origY[i] = wy;
        uvs[i * 2] = wx / UV_TILE; uvs[i * 2 + 1] = wz / UV_TILE;
      }
    }

    const indices = new Uint16Array(segs * segs * 6);
    let idx = 0;
    for (let row = 0; row < segs; row++) {
      for (let col = 0; col < segs; col++) {
        const tl = row * (segs + 1) + col, tr = tl + 1, bl = tl + segs + 1, br = bl + 1;
        indices[idx++] = tl; indices[idx++] = bl; indices[idx++] = tr;
        indices[idx++] = tr; indices[idx++] = bl; indices[idx++] = br;
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('uv',  new BufferAttribute(uvs, 2));
    geo.setAttribute('uv2', new BufferAttribute(uvs.slice(), 2));
    geo.setIndex(Array.from(indices));
    geo.computeVertexNormals();

    const mat  = this._sharedMat ?? new MeshStandardMaterial({ roughness: 0.9 });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(originX, 0, originZ);
    mesh.receiveShadow = true;
    this._scene.add(mesh);
    mesh.updateWorldMatrix(true, true);
    this._physicsWorld.addBody(mesh, false);

    const treeMeshes = (generatePinesForChunk(this._scene, cx, cz, CHUNK_SIZE, SNOW_SEED, getSnowHeight) as InstancedMesh[]) ?? [];
    const { meshes: rampMeshes, launches: rampLaunches } = this._buildRampsForChunk(cx, cz);

    this._chunks.set(`${cx}_${cz}`, { mesh, originalY: origY, treeMeshes, rampMeshes, rampLaunches });
  }

  private _scheduleRebuild() {
    if (this._rebuildTimer !== null) clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      this._rebuildTimer = null;
      for (const [, c] of this._chunks) this._removeChunk(c);
      this._chunks.clear();
      this._lastStampPos.set(Infinity, Infinity, Infinity);
      this._streamChunks(this._playerPos.x, this._playerPos.z);
    }, 400);
  }

  private _createParamPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,5,20,0.94);border:1px solid rgba(100,180,255,0.35);border-radius:10px;padding:22px 26px;color:#cceeff;font-family:monospace;font-size:13px;min-width:360px;z-index:9999;display:none;max-height:85vh;overflow-y:auto;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:bold;color:#88ddff;text-align:center;margin-bottom:18px;letter-spacing:1px;';
    title.textContent = '❄ SNOW MOUNTAIN PARAMETERS';
    panel.appendChild(title);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'p' || e.key === 'P') panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };
    document.addEventListener('keydown', onKey);
    this._cleanups.push(() => document.removeEventListener('keydown', onKey));
    document.body.appendChild(panel);
    this._paramPanel = panel;
  }

  dispose() {
    for (const fn of this._cleanups) fn();
    this._cleanups = [];
  }
}
