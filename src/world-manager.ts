import {
  Scene, PerspectiveCamera,
  AmbientLight, DirectionalLight, HemisphereLight,
  Color, FogExp2, MathUtils, Vector3,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { BvhPhysicsWorld, SimpleCharacter } from '@pmndrs/viverse';
import { Atmosphere } from './atmosphere.js';
import { FEATURES } from './config/features.js';
import { CreatureManager } from './creatures/CreatureManager.js';
import { updateGrassTime } from './grass-generator.js';
import { LootHUD } from './loot-hud.js';
import { LootManager } from './loot-manager.js';
import { buildMaterials } from './materials.js';
import { rebuildNoise, getTerrainHeight } from './noise.js';
import { OceanManager } from './ocean.js';
import { PlayerAbilities } from './player-abilities.js';
import { TerrainManager } from './terrain-manager.js';
import { initTrees, updateTreeWind } from './tree-generator.js';
import type { NpcManager } from './npc-manager.js';

let SEED = Math.floor(Math.random() * 99999);

export class WorldManager {
  private _ambient!:    AmbientLight;
  private _sun!:        DirectionalLight;
  private _hemi!:       HemisphereLight;
  private _sky!:        Sky;
  private _sunDir!:     Vector3;
  private _atmosphere!: Atmosphere;
  private _ocean!:      OceanManager;
  private _terrainMgr!: TerrainManager;
  private _creatures:   CreatureManager | null = null;
  private _lootMgr!:   LootManager;
  private _lootHUD!:   LootHUD;
  private _playerPos   = new Vector3(0, 5, 0);
  private _elapsed     = 0;
  private _abilities:  PlayerAbilities | null = null;

  constructor(
    private _scene:         Scene,
    private _physicsWorld:  BvhPhysicsWorld,
    private _camera:        PerspectiveCamera,
    private _character:     SimpleCharacter,
    private _getPlayerPos:  () => Vector3,
    private _npcManager:    NpcManager,
  ) {}

  init() {
    const scene = this._scene;

    rebuildNoise(SEED);
    buildMaterials('realistic');
    initTrees();

    const ambient = new AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    this._ambient = ambient;

    this._sun = new DirectionalLight(0xfff4e0, 1.6);
    this._sun.position.set(400, 500, 300);
    this._sun.castShadow = true;
    this._sun.shadow.mapSize.set(2048, 2048);
    this._sun.shadow.camera.near = 1;
    this._sun.shadow.camera.far  = 2000;
    this._sun.shadow.camera.left  = this._sun.shadow.camera.bottom = -700;
    this._sun.shadow.camera.right = this._sun.shadow.camera.top    =  700;
    scene.add(this._sun);

    this._hemi = new HemisphereLight(0x88aacc, 0x334422, 0.6);
    scene.add(this._hemi);

    scene.fog = new FogExp2(0x7090b8, 0.0006);
    scene.background = new Color(0x7090b8);

    this._sky = new Sky();
    this._sky.scale.setScalar(200000);
    scene.add(this._sky);

    const su = this._sky.material.uniforms;
    su['turbidity'].value       = 2;
    su['rayleigh'].value        = 1.2;
    su['mieCoefficient'].value  = 0.005;
    su['mieDirectionalG'].value = 0.8;

    this._sunDir = new Vector3();
    this._sunDir.setFromSphericalCoords(1, MathUtils.degToRad(88.5), MathUtils.degToRad(180));
    su['sunPosition'].value.copy(this._sunDir);

    this._atmosphere = new Atmosphere(scene);
    this._ocean      = new OceanManager(scene);
    this._terrainMgr = new TerrainManager(scene, SEED, 'realistic');

    this._terrainMgr.onChunkBuilt = (chunk: any) => {
      if (chunk.terrainMesh) {
        scene.add(chunk.terrainMesh);
        chunk.terrainMesh.updateWorldMatrix(true, true);
        this._physicsWorld.addBody(chunk.terrainMesh, false);
        chunk._physicsAdded = true;
      }
      if (chunk.buildingCollisionMesh) {
        scene.add(chunk.buildingCollisionMesh);
        chunk.buildingCollisionMesh.updateWorldMatrix(true, true);
        this._physicsWorld.addBody(chunk.buildingCollisionMesh, false);
        chunk._physicsCollisionAdded = true;
      }
    };

    this._terrainMgr.onChunkRemoved = (chunk: any) => {
      if (chunk._physicsAdded && chunk.terrainMesh) {
        this._physicsWorld.removeBody(chunk.terrainMesh);
        chunk._physicsAdded = false;
      }
      if (chunk._physicsCollisionAdded && chunk.buildingCollisionMesh) {
        this._physicsWorld.removeBody(chunk.buildingCollisionMesh);
        chunk._physicsCollisionAdded = false;
      }
    };

    if (FEATURES.USE_CREATURES_V3) {
      this._creatures = new CreatureManager(scene, SEED, this._terrainMgr);
    }

    this._lootMgr = new LootManager(scene, SEED);
    this._lootHUD = new LootHUD(this._lootMgr);

    this._abilities = new PlayerAbilities(
      scene,
      this._camera,
      this._character.physics,
      this._creatures,
      this._terrainMgr,
    );

    this._spawnNpcs();
  }

  update(delta: number, time: number) {
    this._playerPos.copy(this._getPlayerPos());

    if (this._abilities) this._abilities.update(delta);

    this._terrainMgr.update(this._playerPos.x, this._playerPos.z);
    updateGrassTime(delta, this._playerPos);
    updateTreeWind(time);

    this._atmosphere.update(delta, this._sunDir, 'realistic');
    this._atmosphere.clouds.position.copy(this._playerPos);
    this._sky.position.copy(this._playerPos);
    this._ocean.update(delta, this._playerPos);

    if (this._creatures) this._creatures.update(delta, time, this._playerPos);
    this._lootMgr.update(delta, this._playerPos);
    this._elapsed += delta;
  }

  getPlayerPos() { return this._playerPos.clone(); }

  private _spawnNpcs() {
    const spawns = [
      { x:  10, z:  0, name: 'Elder Kira',  dialogue: 'This world was shaped by ancient hands. Every ridge and valley has a story.' },
      { x:   0, z: 10, name: 'Merchant Dax', dialogue: 'Rare finds today. Strange things washing up from the deep terrain rifts.' },
      { x:  -8, z:  6, name: 'Scout Ren',   dialogue: 'Something large moved through the eastern sector last night. Stay alert.' },
      { x:   6, z: -9, name: 'Wanderer',    dialogue: 'I have walked every biome in this world. Nothing quite like the cliff edges at dusk.' },
    ];
    for (const s of spawns) {
      const y = getTerrainHeight(s.x, s.z) + 0.05;
      this._npcManager.addNpc({ x: s.x, z: s.z, y, name: s.name, dialogue: s.dialogue, modelUrl: '/gltf/robot/robot.gltf' });
    }
  }

  dispose() {
    this._terrainMgr?.rebuild?.(SEED, 'realistic');
    this._creatures?.clearAll();
    this._atmosphere?.dispose();
    this._ocean?.dispose();
    this._scene.remove(this._ambient, this._sun, this._hemi, this._sky);
    (this._sky?.material as any)?.dispose?.();
    this._scene.fog        = null;
    this._scene.background = null;
  }
}
