import {
  createSystem,
  LocomotionEnvironment,
  LocomotionSystem,
  InputComponent,
  Vector3,
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  Color,
  FogExp2,
  MathUtils,
} from '@iwsdk/core';

import { Sky } from 'three/examples/jsm/objects/Sky.js';

import { rebuildNoise } from './noise.js';
import { buildMaterials } from './materials.js';
import { TerrainManager } from './terrain-manager.js';
import { Atmosphere } from './atmosphere.js';
import { updateGrassTime } from './grass-generator.js';
import { initTrees, updateTreeWind } from './tree-generator.js';
import { CreatureManager } from './creatures/CreatureManager.js';
import { OceanManager } from './ocean.js';
import { PlayerAbilities } from './player-abilities.js';
import { LootManager } from './loot-manager.js';
import { LootHUD } from './loot-hud.js';
import { FEATURES } from './config/features.js';

let SEED = Math.floor(Math.random() * 99999);

export class WorldSystem extends createSystem({}, {}) {
  private _ambient!: AmbientLight;
  private _sun!: DirectionalLight;
  private _hemi!: HemisphereLight;
  private _sky!: Sky;
  private _sunDir!: Vector3;
  private _atmosphere!: Atmosphere;
  private _ocean!: OceanManager;
  private _terrainManager!: TerrainManager;
  private _creatureManager!: CreatureManager | null;
  private _lootManager!: LootManager;
  private _lootHUD!: LootHUD;
  private _playerPos!: Vector3;
  private _elapsed!: number;
  private _abilities!: PlayerAbilities | null;

  init() {
    const scene = this.world.scene;

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
    this._sun.shadow.camera.far = 2000;
    this._sun.shadow.camera.left = this._sun.shadow.camera.bottom = -700;
    this._sun.shadow.camera.right = this._sun.shadow.camera.top = 700;
    scene.add(this._sun);

    this._hemi = new HemisphereLight(0x88aacc, 0x334422, 0.6);
    scene.add(this._hemi);

    scene.fog = new FogExp2(0x7090b8, 0.0006);
    scene.background = new Color(0x7090b8);

    this._sky = new Sky();
    this._sky.scale.setScalar(200000);
    scene.add(this._sky);

    const su = this._sky.material.uniforms;
    su['turbidity'].value = 2;
    su['rayleigh'].value = 1.2;
    su['mieCoefficient'].value = 0.005;
    su['mieDirectionalG'].value = 0.8;

    this._sunDir = new Vector3();
    this._sunDir.setFromSphericalCoords(
      1,
      MathUtils.degToRad(88.5),
      MathUtils.degToRad(180),
    );
    su['sunPosition'].value.copy(this._sunDir);

    this._atmosphere = new Atmosphere(scene);
    this._ocean = new OceanManager(scene);
    this._terrainManager = new TerrainManager(scene, SEED, 'realistic');

    this._terrainManager.onChunkBuilt = (chunk: any) => {
      if (chunk.terrainMesh) {
        const entity = this.world.createTransformEntity(chunk.terrainMesh, {
          parent: this.world.sceneEntity,
          persistent: true,
        });
        entity.addComponent(LocomotionEnvironment, { type: 'static' });
        chunk._locomotionEntity = entity;
      }

      if (chunk.buildingCollisionMesh) {
        const cityEntity = this.world.createTransformEntity(chunk.buildingCollisionMesh, {
          parent: this.world.sceneEntity,
          persistent: true,
        });
        cityEntity.addComponent(LocomotionEnvironment, { type: 'static' });
        chunk._cityGroupEntity = cityEntity;
      }
    };

    this._terrainManager.onChunkRemoved = (chunk: any) => {
      if (chunk._locomotionEntity) {
        chunk._locomotionEntity.dispose();
        chunk._locomotionEntity = null;
      }
      if (chunk._cityGroupEntity) {
        chunk._cityGroupEntity.dispose();
        chunk._cityGroupEntity = null;
      }
    };

    // Set sliding speed — must be done here because features.locomotion
    // does not forward slidingSpeed to LocomotionSystem.
    const locoSys = this.world.getSystem(LocomotionSystem);
    if (locoSys) {
      locoSys.config.slidingSpeed.value  = 50;
      locoSys.config.comfortAssist.value = 0;
    }

    if (FEATURES.USE_CREATURES_V3) {
      this._creatureManager = new CreatureManager(scene, SEED, this._terrainManager);
    } else {
      this._creatureManager = null;
    }

    this._lootManager = new LootManager(scene, SEED);
    this._lootHUD = new LootHUD(this._lootManager);

    this._playerPos = new Vector3(0, 5, 0);
    this._elapsed = 0;
    this._abilities = null;

    this.cleanupFuncs.push(() => {
      // Terrain: calls onChunkRemoved for every chunk → disposes locomotion entities
      this._terrainManager?.rebuild(SEED, 'realistic');
      this._creatureManager?.clearAll();
      this._atmosphere?.dispose();
      this._ocean?.dispose();
      this.scene.remove(this._ambient, this._sun, this._hemi, this._sky);
      (this._sky?.material as any)?.dispose?.();
      this.scene.fog = null;
      this.scene.background = null;
    });
  }

  update(delta: number, time: number) {
    if (!this._abilities && (this as any).player?.head) {
      const locoSys = this.world.getSystem(LocomotionSystem);
      this._abilities = new PlayerAbilities(
        this.world,
        (this as any).player,
        locoSys,
        this._creatureManager,
        this._terrainManager,
      );
    }
    if (this._abilities) this._abilities.update(delta);

    if ((this as any).input?.gamepads?.right?.getButtonDown(InputComponent.A_Button)) {
      this._lootHUD.toggle();
    }

    (this as any).player.head.getWorldPosition(this._playerPos);

    this._terrainManager.update(this._playerPos.x, this._playerPos.z);

    updateGrassTime(delta, this._playerPos);
    updateTreeWind(time);

    this._atmosphere.update(delta, this._sunDir, 'realistic');
    this._atmosphere.clouds.position.copy(this._playerPos);

    this._sky.position.copy(this._playerPos);

    this._ocean.update(delta, this._playerPos);

    if (this._creatureManager) {
      this._creatureManager.update(delta, time, this._playerPos);
    }

    this._lootManager.update(delta, this._playerPos);

    this._elapsed += delta;
  }

  /** Returns the current player world position (used by the spawn panel UI). */
  getPlayerPos() {
    return this._playerPos.clone();
  }
}
