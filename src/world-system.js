// WorldSystem — IWSDK ECS system that owns the PlanetGen procedural environment.
//
// Responsibilities:
//   init()   — lighting, sky, atmosphere, ocean, terrain manager setup
//   update() — terrain streaming, grass/tree animation, atmosphere, ocean per-frame
//
// Terrain chunks get LocomotionEnvironment via onChunkBuilt so the IWSDK
// locomotion system can walk on the procedurally generated terrain.

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
// import { CreatureManager } from './creatures/CreatureManager.js'; // DISABLED
import { OceanManager } from './ocean.js';
import { PlayerAbilities } from './player-abilities.js';
import { LootManager } from './loot-manager.js';
import { LootHUD } from './loot-hud.js';

let SEED = Math.floor(Math.random() * 99999);

export class WorldSystem extends createSystem({}, {}) {
  init() {
    const scene = this.world.scene;

    // ── Procedural world init ──────────────────────────────────────────────
    rebuildNoise(SEED);
    buildMaterials('realistic');
    initTrees();

    // ── Lighting ───────────────────────────────────────────────────────────
    const ambient = new AmbientLight(0xffffff, 1.0);
    scene.add(ambient);
    this._ambient = ambient;

    this._sun = new DirectionalLight(0xfff4e0, 2.2);
    this._sun.position.set(400, 500, 300);
    this._sun.castShadow = true;
    this._sun.shadow.mapSize.set(2048, 2048);
    this._sun.shadow.camera.near = 1;
    this._sun.shadow.camera.far  = 2000;
    this._sun.shadow.camera.left
      = this._sun.shadow.camera.bottom = -700;
    this._sun.shadow.camera.right
      = this._sun.shadow.camera.top    = 700;
    scene.add(this._sun);

    scene.add(new HemisphereLight(0x88aacc, 0x334422, 0.6));

    // ── Sky & fog ──────────────────────────────────────────────────────────
    scene.fog = new FogExp2(0x7090b8, 0.0006);
    scene.background = new Color(0x7090b8);

    this._sky = new Sky();
    this._sky.scale.setScalar(200000);
    scene.add(this._sky);

    const su = this._sky.material.uniforms;
    su['turbidity'].value          = 2;
    su['rayleigh'].value           = 1.2;
    su['mieCoefficient'].value     = 0.005;
    su['mieDirectionalG'].value    = 0.8;

    this._sunDir = new Vector3();
    this._sunDir.setFromSphericalCoords(
      1,
      MathUtils.degToRad(88.5),
      MathUtils.degToRad(180),
    );
    su['sunPosition'].value.copy(this._sunDir);

    // ── Atmosphere (cloud dome) ────────────────────────────────────────────
    this._atmosphere = new Atmosphere(scene);

    // ── Ocean — low sea level, fills only the deepest valleys ─────────────
    this._ocean = new OceanManager(scene);

    // ── Terrain manager ────────────────────────────────────────────────────
    this._terrainManager = new TerrainManager(scene, SEED, 'realistic');

    // When a chunk is built, wrap its world-space terrain mesh in an IWSDK
    // entity and add LocomotionEnvironment so the player can walk on it.
    this._terrainManager.onChunkBuilt = (chunk) => {
      // Terrain collision — world-space mesh, one entity per chunk
      if (chunk.terrainMesh) {
        const entity = this.world.createTransformEntity(chunk.terrainMesh, {
          parent:     this.world.sceneEntity,
          persistent: true,
        });
        entity.addComponent(LocomotionEnvironment, { type: 'static' });
        chunk._locomotionEntity = entity;
      }

      // Building collision — position-only world-space mesh, compatible with mergeGeometries.
      // Kept separate from cityGroup to avoid vertIndex attribute conflicts from grass geometry.
      if (chunk.buildingCollisionMesh) {
        const cityEntity = this.world.createTransformEntity(chunk.buildingCollisionMesh, {
          parent:     this.world.sceneEntity,
          persistent: true,
        });
        cityEntity.addComponent(LocomotionEnvironment, { type: 'static' });
        chunk._cityGroupEntity = cityEntity;
      }
    };

    // Before a chunk is removed, destroy locomotion entities and dispose terrain geometry.
    this._terrainManager.onChunkRemoved = (chunk) => {
      if (chunk._locomotionEntity) {
        chunk._locomotionEntity.destroy();
        chunk._locomotionEntity = null;
      }
      if (chunk.terrainMesh) {
        chunk.terrainMesh.geometry.dispose();
      }
      if (chunk._cityGroupEntity) {
        chunk._cityGroupEntity.destroy();
        chunk._cityGroupEntity = null;
        if (chunk.buildingCollisionMesh) {
          chunk.buildingCollisionMesh.geometry.dispose();
        }
      }
    };

    // Set sliding speed — must be done here because features.locomotion
    // does not forward slidingSpeed to LocomotionSystem.
    const locoSys = this.world.getSystem(LocomotionSystem);
    if (locoSys) locoSys.config.slidingSpeed.value = 50;

    // ── Creature manager ───────────────────────────────────────────────────
    this._creatureManager = null; // new CreatureManager(scene, SEED, this._terrainManager); // DISABLED

    // ── Loot manager + HUD ─────────────────────────────────────────────────
    this._lootManager = new LootManager(scene, SEED);
    this._lootHUD     = new LootHUD(this._lootManager);

    // Pre-allocate player position vector (no allocations in update)
    this._playerPos = new Vector3(0, 5, 0);
    this._elapsed   = 0;

    // ── Player abilities (shoot + jetpack) — wired after first update ──────
    // PlayerAbilities needs this.player which is only available after init.
    this._abilities = null;
  }

  update(delta, time) {
    // Lazy-init abilities once this.player is available
    if (!this._abilities && this.player?.head) {
      const locoSys = this.world.getSystem(LocomotionSystem);
      this._abilities = new PlayerAbilities(
        this.world, this.player, locoSys,
        this._creatureManager, this._terrainManager,
      );
    }
    if (this._abilities) this._abilities.update(delta);

    // Controller A button toggles inventory panel
    if (this.input?.gamepads?.right?.getButtonDown(InputComponent.A_Button)) {
      this._lootHUD.toggle();
    }

    // Grab player head position (no allocation — copies into pre-allocated vector)
    this.player.head.getWorldPosition(this._playerPos);

    // Stream terrain chunks around player
    this._terrainManager.update(this._playerPos.x, this._playerPos.z);

    // Animate grass and trees
    updateGrassTime(delta, this._playerPos);
    updateTreeWind(time);

    // Animate atmosphere (clouds follow camera to always fill sky)
    this._atmosphere.update(delta, this._sunDir, 'realistic');
    this._atmosphere.clouds.position.copy(this._playerPos);

    // Sky dome follows camera
    this._sky.position.copy(this._playerPos);

    this._ocean.update(delta, this._playerPos, this._sunDir);

    // Update creatures (disabled)
    // this._creatureManager.update(delta, time, this._playerPos);

    // Update loot (hover animation + pickup detection)
    this._lootManager.update(delta, this._playerPos);

    this._elapsed += delta;
  }

  /** Returns the current player world position (used by the spawn panel UI). */
  getPlayerPos() {
    return this._playerPos.clone();
  }
}
