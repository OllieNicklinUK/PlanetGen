import {
  WebGLRenderer, Scene, PerspectiveCamera, Vector3, Clock,
  PCFSoftShadowMap,
} from 'three';
import { signal } from '@preact/signals-core';
import { BvhPhysicsWorld, SimpleCharacter } from '@pmndrs/viverse';

import { NpcManager }              from './npc-manager.js';
import { WorldManager }            from './world-manager.js';
import { VehicleManager }          from './vehicle-manager.js';
import { SnowWorldManager, getSnowHeight } from './snow-world-manager.js';
import { LobbyManager, LOBBY_Y }   from './lobby-manager.js';
import { PolygonStreamingManager } from './polygon-streaming-manager.js';
import { LevelBuilderManager }     from './level-builder-manager.js';
import { EditorCameraManager, BuilderGlobals } from './editor-camera-manager.js';
import { createCreatureSpawnerUI } from './ui/creature-spawner.js';
import { getTerrainHeight }        from './noise.js';

const _urlMode = new URLSearchParams(window.location.search).get('mode');

// ─── Sub-path fix for GitHub Pages ────────────────────────────────────────────
// Third-party bundles (polygon-streaming) have hardcoded root-relative paths
// like /lib/basis_transcoder.js that break when deployed under /PlanetGen/.
// Intercept fetch + XHR and prepend the Vite base prefix to any root-relative
// URL that doesn't already include it.
{
  const base = import.meta.env.BASE_URL; // '/PlanetGen/' in prod, '/' locally
  if (base && base !== '/') {
    const prefix = base.replace(/\/$/, '');
    const rewrite = (url: string) =>
      url.startsWith('/') && !url.startsWith(base) ? prefix + url : url;

    const _fetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
      _fetch(typeof input === 'string' ? rewrite(input) : input, init);

    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async = true, ...rest: any[]) {
      return _open.call(this, method, typeof url === 'string' ? rewrite(url) : url, async, ...rest);
    };
  }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById('scene-container') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = PCFSoftShadowMap;

// ─── Scene + Camera ───────────────────────────────────────────────────────────

const scene  = new Scene();
const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 8000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Physics + Character ──────────────────────────────────────────────────────

const physicsWorld = new BvhPhysicsWorld();
const character    = new SimpleCharacter(camera, physicsWorld, canvas, {
  model:    false,
  movement: { walk: { speed: 9 }, run: { speed: 20 } },
});
scene.add(character);

function getPlayerPos(): Vector3 { return character.position.clone(); }

function setPlayerPos(pos: { x: number; y: number; z: number }) {
  character.position.set(pos.x, pos.y, pos.z);
  character.physics.applyVelocity(
    new Vector3(-character.physics.inputVelocity.x, 0, -character.physics.inputVelocity.z),
  );
}

// ─── Camera perspective (Numpad 1 = FPS, Numpad 2 = 3rd person) ───────────────

const FPS_CAM_OPTIONS = {
  zoom: { minDistance: 0, maxDistance: 0 },
  characterBaseOffset: [0, 1.6, 0] as [number, number, number],
};

let camOptions: typeof FPS_CAM_OPTIONS | undefined = undefined; // default: 3rd person

function setCameraMode(mode: 'fps' | '3rd') {
  if (mode === 'fps') {
    camOptions = FPS_CAM_OPTIONS;
    character.cameraBehavior.zoomDistance = 0;
  } else {
    camOptions = undefined;
    character.cameraBehavior.zoomDistance = 4;
  }
  (character as any).options.cameraBehavior = camOptions;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Numpad1') setCameraMode('fps');
  else if (e.code === 'Numpad2') setCameraMode('3rd');
});

// ─── Mode: builder (?mode=builder) ───────────────────────────────────────────

if (_urlMode === 'builder') {

  character.position.set(0, 2, 0);

  const globals: BuilderGlobals = {
    builderActive: signal(false),
    builderView:   signal('plan'),
  };
  const editorCam = new EditorCameraManager(canvas, camera, globals);
  editorCam.init();
  const builder = new LevelBuilderManager(scene, physicsWorld, camera, renderer, globals, editorCam);
  builder.activate();

  const clock = new Clock();
  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    builder.update(delta);
    renderer.render(scene, camera);
  });

// ─── Mode: lobby (?mode=lobby) ────────────────────────────────────────────────

} else if (_urlMode === 'lobby') {

  character.position.set(0, LOBBY_Y + 1.5, 0);

  let worldMgr:    WorldManager    | null = null;
  let vehicleMgr:  VehicleManager  | null = null;
  let snowMgr:     SnowWorldManager| null = null;
  let streamingMgr: PolygonStreamingManager | null = null;
  let charUpdateEnabled = true;

  function ensureStreaming() {
    if (snowMgr || streamingMgr) return;
    streamingMgr = new PolygonStreamingManager(scene, physicsWorld, camera, renderer, getPlayerPos, () => camera);
    streamingMgr.init();
  }
  function destroyStreaming() { streamingMgr?.dispose(); streamingMgr = null; }
  function destroyWorld()     { worldMgr?.dispose?.(); worldMgr = null; vehicleMgr?.dispose?.(); vehicleMgr = null; charUpdateEnabled = true; }
  function destroySnow()      { snowMgr?.dispose?.(); snowMgr = null; charUpdateEnabled = true; }

  const npcMgr = new NpcManager(scene, camera, getPlayerPos);
  npcMgr.init();
  const lobby = new LobbyManager(scene, physicsWorld, camera, getPlayerPos, setPlayerPos);
  lobby.init();
  ensureStreaming();

  lobby.onReturnToLobby = () => { destroyWorld(); destroySnow(); ensureStreaming(); setPlayerPos({ x: 0, y: LOBBY_Y + 1.5, z: 0 }); };

  lobby.onEnterWorld = () => {
    destroySnow(); ensureStreaming();
    const nm = new NpcManager(scene, camera, getPlayerPos);
    nm.init();
    worldMgr = new WorldManager(scene, physicsWorld, camera, character, getPlayerPos, nm);
    worldMgr.init();
    vehicleMgr = new VehicleManager(scene, physicsWorld, character, getPlayerPos, setPlayerPos, (v) => { charUpdateEnabled = !v; });
    vehicleMgr.init();
    setPlayerPos({ x: 0, y: LOBBY_Y + 1.5, z: 0 });
    if ((worldMgr as any)._creatures) createCreatureSpawnerUI((worldMgr as any)._creatures, getPlayerPos);
  };

  lobby.onEnterSnow = () => {
    destroyWorld(); destroyStreaming();
    snowMgr = new SnowWorldManager(scene, physicsWorld, camera, character, getPlayerPos, setPlayerPos);
    snowMgr.init();
    const spawnY = getSnowHeight(0, 0) + 2;
    setPlayerPos({ x: 0, y: spawnY, z: 0 });
    charUpdateEnabled = false;
  };

  const clock = new Clock(); let time = 0;
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.1); time += delta;
    if (charUpdateEnabled) { character.update(delta); } else { character.cameraBehavior.update(camera, character, delta, (ray, far) => physicsWorld.raycast(ray, far)?.distance, camOptions); }
    lobby.update(delta, time); streamingMgr?.update(); worldMgr?.update(delta, time); vehicleMgr?.update(delta); snowMgr?.update(delta, time); npcMgr.update(delta);
    renderer.render(scene, camera);
  });

// ─── Mode: snow (?mode=snow) ──────────────────────────────────────────────────

} else if (_urlMode === 'snow') {

  let charUpdateEnabled = false;
  const snowMgr = new SnowWorldManager(scene, physicsWorld, camera, character, getPlayerPos, setPlayerPos);
  snowMgr.init();
  const spawnY = getSnowHeight(0, 0) + 2;
  character.position.set(0, spawnY, 0);

  const clock = new Clock(); let time = 0;
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.1); time += delta;
    character.cameraBehavior.update(camera, character, delta, (ray, far) => physicsWorld.raycast(ray, far)?.distance, camOptions);
    snowMgr.update(delta, time);
    renderer.render(scene, camera);
  });

// ─── Default: procedural world + lobby + polygon streaming ───────────────────
// Player spawns in the 40 m flat safe zone at origin.  Lobby portals are placed
// there.  Procedural terrain + city starts beyond ~50 m.  The polygon-streamed
// Nexus environment loads alongside it (with BVH collision injected).

} else {

  let charUpdateEnabled = false;
  let vehicleMgr:   VehicleManager        | null = null;
  let snowMgr:      SnowWorldManager      | null = null;
  let streamingMgr: PolygonStreamingManager | null = null;

  // 1. Procedural world — rebuildNoise + buildMaterials + TerrainManager
  const npcMgr = new NpcManager(scene, camera, getPlayerPos);
  npcMgr.init();

  const worldMgr = new WorldManager(scene, physicsWorld, camera, character, getPlayerPos, npcMgr);
  worldMgr.init();

  // 2. Polygon-streamed environment with injected BVH collision
  streamingMgr = new PolygonStreamingManager(
    scene, physicsWorld, camera, renderer,
    getPlayerPos,
    () => camera,   // player head ≈ camera in third-person
  );
  streamingMgr.init();

  // 3. Lobby portals on the flat safe zone (no extra sky/lights/floor)
  const lobby = new LobbyManager(scene, physicsWorld, camera, getPlayerPos, setPlayerPos);
  lobby.init({ worldMode: true });

  lobby.onEnterWorld = () => {
    setPlayerPos({ x: 0, y: LOBBY_Y - 1, z: 0 });
  };

  lobby.onEnterSnow = () => {
    if (snowMgr) return;
    // Tear down heavy systems before entering snow world
    streamingMgr?.dispose(); streamingMgr = null;
    worldMgr.dispose?.();
    snowMgr = new SnowWorldManager(scene, physicsWorld, camera, character, getPlayerPos, setPlayerPos);
    snowMgr.init();
    setPlayerPos({ x: 0, y: getSnowHeight(0, 0) + 2, z: 0 });
    charUpdateEnabled = false;
  };

  // Spawn above the landing point in fly mode (charUpdateEnabled = false so the
  // player can look around freely).  Physics only enables once BOTH gates pass:
  //   gate 1 — collider has been registered with the physics world (async GLTF load)
  //   gate 2 — at least 5 s have elapsed (lets streaming geometry visually appear)
  // A 30 s hard fallback prevents the player being frozen forever if the load fails.
  character.position.set(0, LOBBY_Y + 8, 0);

  let _colliderGate = false;
  let _timeGate     = false;
  const _tryDrop = () => { if (_colliderGate && _timeGate) charUpdateEnabled = true; };

  streamingMgr.onColliderReady = () => { _colliderGate = true; _tryDrop(); };
  setTimeout(() => { _timeGate = true; _tryDrop(); }, 5000);
  setTimeout(() => { charUpdateEnabled = true; }, 30_000); // hard fallback

  vehicleMgr = new VehicleManager(scene, physicsWorld, character, getPlayerPos, setPlayerPos, (mounted) => {
    charUpdateEnabled = !mounted;
  });
  vehicleMgr.init();

  if ((worldMgr as any)._creatures) {
    createCreatureSpawnerUI((worldMgr as any)._creatures, getPlayerPos);
  }

  const clock = new Clock(); let time = 0;
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.1); time += delta;
    if (charUpdateEnabled) {
      character.update(delta);
    } else {
      character.cameraBehavior.update(camera, character, delta, (ray, far) => physicsWorld.raycast(ray, far)?.distance, camOptions);
    }
    worldMgr.update(delta, time);
    streamingMgr?.update();
    vehicleMgr?.update(delta);
    snowMgr?.update(delta, time);
    lobby.update(delta, time);
    npcMgr.update(delta);
    renderer.render(scene, camera);
  });
}
