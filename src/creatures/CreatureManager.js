// CreatureManager.js — runtime manager for all live creatures.
//
// Analogous to TerrainManager: a plain JS class called each frame from WorldSystem.
// Owns a flat array of creature runtime objects (not ECS entities) for performance.
//
// Each runtime creature object:
// {
//   params, boneDescs, bones, skeleton, mesh, group,
//   position: Vector3,
//   velocity: Vector3,
//   facing:   number,  // Y rotation in radians
//   fsm: { state, prevState, timer, alertLevel, targetPos, wanderTarget, wanderTimer },
//   anim: { phase, footPhases, footTargets, footPlanted, breathPhase },
//   spawned: boolean,
// }

import * as THREE from 'three';
import { makeCreatureParams, MORPHOTYPE, NOPED_SUBTYPE, BEHAVIOUR_TYPE, SPAWN_PRESETS, BEHAVIOUR_PRESETS } from './CreatureParams.js';
import { generateCreature, disposeCreature } from './CreatureGenerator.js';
import { getTerrainHeight, isCityZone } from '../noise.js';
import { initSimplex3 } from './simplex3.js';
import { makeRNG } from './rng.js';
import { solve2Bone } from './ik.js';
import { getBiomeTagAt, BIOME_RECIPES } from './BiomeRecipe.js';
import { AFFINITY_TYPE, AffinityMap, generateAffinityMap } from './AffinityMap.js';
import { MODEL_CREATURE_CATALOG, preloadAllCreatureModels, rigCreatureModel } from './ModelCreatureRigger.js';

// ── Fixed creature pools ───────────────────────────────────────────────────────
// Each entry defines a pool of N model creatures that are spawned ONCE on startup
// and silently teleported back near the player when they drift too far away.
// No spawn/despawn churn — constant draw call count, no GC pressure.
//
// condition(x, z) controls where an individual may be repositioned:
//   — Exo only recycles to city tiles, octo only to water depressions, etc.
//   — If no valid point is found the creature stays where it is (naturally far away).

const CREATURE_POOLS = [
  { model: 'Elephant', count: 5, condition: (x,z) => !isCityZone(x,z) && getTerrainHeight(x,z) > 0 },
  { model: 'lizzy',    count: 14, condition: (x,z) => !isCityZone(x,z) && getTerrainHeight(x,z) > 0 },
  { model: 'steggy',   count: 12, condition: (x,z) => !isCityZone(x,z) && getTerrainHeight(x,z) > 0 },
  { model: 'gek',      count: 5, condition: (x,z) => !isCityZone(x,z) && getTerrainHeight(x,z) > 0 },
  { model: 'rex',      count: 3, condition: (x,z) => !isCityZone(x,z) && getTerrainHeight(x,z) > 0 },
  { model: 'apex',     count: 3, condition: (x,z) => !isCityZone(x,z) && getTerrainHeight(x,z) > 0 },
  { model: 'Exo',      count: 15, condition: (x,z) => isCityZone(x,z)                               },
  { model: 'octo',     count: 4, condition: (x,z) => getTerrainHeight(x,z) < -5                     },
  { model: 'skull',    count: 3, condition: ()    => true                                            },
];

// Per-pool recycle is also staggered across frames to avoid a spike every N seconds.
const RECYCLE_DIST    = 260;  // teleport when creature is this far from player
const POOL_NEAR       = 80;   // closest a recycled creature may appear
const POOL_FAR        = 200;  // furthest a recycled creature may appear
const POOL_FIND_TRIES = 28;   // candidate positions tried per recycle

// ── Constants ─────────────────────────────────────────────────────────────────

const UP        = new THREE.Vector3(0, 1, 0);
const _v1       = new THREE.Vector3();
const _v2       = new THREE.Vector3();
const _v3       = new THREE.Vector3();
const _quat     = new THREE.Quaternion();
const _targetQ  = new THREE.Quaternion();
const _poleVec  = new THREE.Vector3(0, -1, 0.3);

const GAIT_FREQ = {
  QUADRUPED_TROT:    2.5,
  QUADRUPED_GALLOP:  4.0,
  BIPED_WALK:        1.8,
  BIPED_HOP:         2.4,
  NOPED_UNDULATOR:   1.5,
  NOPED_FLOATER:     0.6,
};

const GALLOP_SPEED_THRESHOLD = 6; // m/s

// Diagonal foot pairs for trot gait: [FL+RR, FR+RL]
// Foot order in boneDescs: [spineSegs] + [neck/head/tail...] + FL,FR,RL,RR
// We resolve foot indices at spawn time.

// ── CreatureManager ──────────────────────────────────────────────────────────

export class CreatureManager {
  /**
   * @param {THREE.Scene} scene
   * @param {number} worldSeed
   * @param {TerrainManager} terrainManager
   */
  constructor(scene, worldSeed, terrainManager = null) {
    this._scene     = scene;
    this._creatures = [];
    this._worldSeed = worldSeed;
    this._terrainManager = terrainManager;

    // Pre-allocated temps for update loop
    this._playerPos = new THREE.Vector3();
    this._toPlayer  = new THREE.Vector3();
    this._midJoint  = new THREE.Vector3();

    // Seed the 3D simplex noise for vertex colours
    initSimplex3(worldSeed);

    this._affinitySystem = new AffinityMap();

    // Fixed-pool state
    this._poolsReady    = false;  // set true once preload + first playerPos known
    this._recycleOffset = 0;      // stagger recycling across frames

    // Kick off background preload of all GLB creature models
    preloadAllCreatureModels().then(() => {
      this._modelsReady = true;
      console.log('[CreatureManager] All model creatures preloaded.');
    });
  }

  /** Number of currently live creatures. */
  get count() { return this._creatures.length; }

  // ── Spawn ──────────────────────────────────────────────────────────────────

  /**
   * Spawn a batch of creatures around a world-space position.
   *
   * @param {{
   *   morphotype: string,     MORPHOTYPE.* or 'RANDOM'
   *   behaviourPreset: string,  key of BEHAVIOUR_PRESETS or 'RANDOM'
   *   surfaceType: string,    SURFACE_TYPE.* or undefined
   *   count: number,
   *   spread: number,         metres radius around origin
   *   seed: number,           base seed (creature i gets seed+i)
   *   origin: THREE.Vector3,  spawn centre
   * }} config
   */
  spawnBatch(config) {
    const {
      morphotype,
      behaviourPreset,
      surfaceType,
      count,
      spread,
      seed,
      origin,
    } = config;

    const morphotypes  = [MORPHOTYPE.QUADRUPED, MORPHOTYPE.BIPED, MORPHOTYPE.NOPED];
    const presetNames  = ['GRAZER', 'SPOOKED', 'STALKER', 'HUNTER', 'DRIFTER', 'SWARM'];

    for (let i = 0; i < count; i++) {
      const rng  = makeRNG(seed + i * 997);

      // V3: Sample biome at spawn point, with optional override from UI
      const spawnX = origin.x + (rng() - 0.5) * spread * 2;
      const spawnZ = origin.z + (rng() - 0.5) * spread * 2;
      
      let biomeTag = getBiomeTagAt(spawnX, spawnZ);
      if (config.biome && config.biome !== 'AUTO') {
        biomeTag = config.biome;
      }
      const recipe = BIOME_RECIPES[biomeTag] || BIOME_RECIPES.TEMPERATE;

      // Filter morphotype by recipe if RANDOM
      const mtype = morphotype === 'RANDOM'
        ? recipe.morphotypes[Math.floor(rng() * recipe.morphotypes.length)]
        : morphotype;
      
      const btype = behaviourPreset === 'RANDOM'
        ? presetNames[Math.floor(rng() * presetNames.length)]
        : behaviourPreset;

      // Create base params
      const params = makeCreatureParams(seed + i, mtype, btype);
      
      // V3: Apply Biome Recipe Constraints
      if (recipe) {
        // HSL Colour override
        const { hue, sat, light } = recipe.colourPalette;
        const h = (hue[0] + rng() * (hue[1] - hue[0])) / 360;
        const s = sat[0] + rng() * (sat[1] - sat[0]);
        const l = light[0] + rng() * (light[1] - light[0]);
        params.skinColorA = new THREE.Color().setHSL(h, s, l);
        params.skinColorB = params.skinColorA.clone().multiplyScalar(0.4); // Darker variant

        // Scale override
        params.scale = recipe.scaleRange[0] + rng() * (recipe.scaleRange[1] - recipe.scaleRange[0]);
        
        // Affinity overrides from biome
        params.affinityMap = generateAffinityMap(rng, recipe.affinitySeeds);
      }

      if (surfaceType) params.surfaceType = surfaceType;

      const spawnY = getTerrainHeight(spawnX, spawnZ) + params.bodyHeight * params.scale * 0.6;

      // Generate mesh with biome awareness
      const creatureData = generateCreature(params, biomeTag);
      creatureData.group.position.set(spawnX, spawnY, spawnZ);
      creatureData.group.rotation.order = 'YXZ'; // Y=facing, X=pitch, Z=roll
      this._scene.add(creatureData.group);

      // Identify foot bone indices for IK
      const footIndices = _findFootBoneIndices(creatureData.boneDescs);

      // Build foot target positions (world space)
      const footTargets = footIndices.map(fi => {
        const bd = creatureData.boneDescs[fi];
        return creatureData.group.localToWorld(bd.end.clone());
      });

      // Foot phase offsets — diagonal pairs for trot
      const footPhases = footIndices.map((_, i) => {
        // FL+RR at phase 0, FR+RL at phase PI
        return [0, Math.PI, Math.PI, 0][i % 4];
      });

      const creature = {
        params,
        recipe,
        biomeTag,
        boneDescs:   creatureData.boneDescs,
        bones:       creatureData.bones,
        skeleton:    creatureData.skeleton,
        mesh:        creatureData.mesh,
        group:       creatureData.group,
        footIndices,
        footTargets,
        footPhases,
        footPlanted: new Array(footIndices.length).fill(true),

        position: new THREE.Vector3(spawnX, spawnY, spawnZ),
        velocity: new THREE.Vector3(),
        facing:   rng() * Math.PI * 2,

        fsm: {
          alertLevel:    0,
          targetPos:     new THREE.Vector3(spawnX, spawnY, spawnZ),
          wanderTimer:    rng() * 12,
          desireVec:      new THREE.Vector3(),
          targetCooldown: rng() * 5,
          wanderOffset:   rng() * Math.PI * 2,
          resting:        false,
          restTimer:      0,
          _tPitch:        0,
          _tRoll:         0,
          collapsed:      false,
          collapseTimer:  0,
        },

        anim: {
          phase:       rng() * Math.PI * 2,   // random phase offset so herd doesn't sync
          breathPhase: rng() * Math.PI * 2,
          speed:       0,
        },
      };

      this._creatures.push(creature);
    }
  }

  // ── Spawn model creatures ─────────────────────────────────────────────────

  /**
   * Spawn creatures from full GLB models, auto-rigged at runtime.
   * Uses the same AI, movement, and animation systems as generated creatures.
   *
   * @param {{
   *   modelName: string,       key from MODEL_CREATURE_CATALOG (e.g. 'Elephant')
   *   count: number,
   *   spread: number,          metres radius
   *   seed: number,
   *   origin: THREE.Vector3,
   * }} config
   */
  spawnModelBatch(config) {
    const { modelName, count, spread, seed, origin } = config;
    const catalog = MODEL_CREATURE_CATALOG[modelName];
    if (!catalog) {
      console.warn(`[CreatureManager] Unknown model: ${modelName}`);
      return;
    }

    for (let i = 0; i < count; i++) {
      const rng = makeRNG(seed + i * 997);

      const angle  = rng() * Math.PI * 2;
      const dist   = rng() * spread;
      const spawnX = origin.x + Math.cos(angle) * dist;
      const spawnZ = origin.z + Math.sin(angle) * dist;
      const spawnY = getTerrainHeight(spawnX, spawnZ) + catalog.bodyHeight * catalog.scale * 0.5;

      // Build minimal params compatible with the animation system
      const params = {
        seed: seed + i,
        morphotype:    catalog.morphotype,
        subtype:       catalog.subtype || null,
        bodyLength:    catalog.bodyHeight * 1.8,
        bodyWidth:     catalog.bodyHeight * 0.6,
        bodyHeight:    catalog.bodyHeight,
        neckLength:    catalog.bodyHeight * 0.3,
        headScale:     0.5,
        tailLength:    catalog.bodyHeight * 0.8,
        tailSegments:  catalog.tailBones || 3,
        limbLength:    catalog.bodyHeight * 0.7,
        limbWidth:     catalog.bodyHeight * 0.12,
        footSize:      catalog.bodyHeight * 0.1,
        digitigrade:   false,
        spineSegments: catalog.spineBones,
        bodySegments:  10,
        scale:          catalog.scale,
        floatHeight:    3.0,
        tentacleCount:  catalog.tailBones || 6,
        stepHeightMult:  catalog.stepHeightMult  ?? 1.0,
        tailSwing:       catalog.tailSwing       ?? 1.0,
        shinBendWeight:  catalog.shinBendWeight  ?? 0.6,
        turnRateMult:    catalog.turnRateMult    ?? undefined,
        speedMult:       catalog.speedMult       ?? undefined,
        yOffset:         catalog.yOffset         ?? 0,
        behaviour:      BEHAVIOUR_PRESETS?.[catalog.behaviourPreset] || { fleeSpeed: 5, chaseSpeed: 8, idleWander: true, wanderRadius: 40 },
        affinityMap:    generateAffinityMap(rng, BIOME_RECIPES[catalog.biomeTag]?.affinitySeeds || {}),
      };

      const creatureData = rigCreatureModel(modelName, params);
      if (!creatureData) {
        console.warn(`[CreatureManager] rigCreatureModel returned null for ${modelName} — model may not be loaded yet.`);
        continue;
      }

      creatureData.group.position.set(spawnX, spawnY, spawnZ);
      creatureData.group.rotation.order = 'YXZ'; // Y=facing, X=pitch, Z=roll
      this._scene.add(creatureData.group);

      const footIndices = creatureData.boneDescs
        .reduce((a, bd, i) => { if (bd.role === 'foot') a.push(i); return a; }, []);
      const footTargets = footIndices.map(fi => {
        const bd = creatureData.boneDescs[fi];
        return creatureData.group.localToWorld(bd.end.clone());
      });

      const creature = {
        params,
        recipe:    BIOME_RECIPES[catalog.biomeTag] || BIOME_RECIPES.TEMPERATE,
        biomeTag:  catalog.biomeTag,
        boneDescs: creatureData.boneDescs,
        bones:     creatureData.bones,
        skeleton:  creatureData.skeleton,
        mesh:      creatureData.mesh,
        group:     creatureData.group,
        footIndices,
        footTargets,
        footPhases:  footIndices.map((_, j) => [0, Math.PI, Math.PI, 0][j % 4]),
        footPlanted: new Array(footIndices.length).fill(true),
        position: new THREE.Vector3(spawnX, spawnY, spawnZ),
        velocity: new THREE.Vector3(),
        facing:   rng() * Math.PI * 2,
        fsm: {
          alertLevel:     0,
          targetPos:      new THREE.Vector3(spawnX, spawnY, spawnZ),
          wanderTimer:    rng() * 12,
          desireVec:      new THREE.Vector3(),
          targetCooldown: rng() * 5,
          wanderOffset:   rng() * Math.PI * 2,
          resting:        false,
          restTimer:      0,
          _tPitch:        0,
          _tRoll:         0,
        },
        anim: {
          phase:       rng() * Math.PI * 2,
          breathPhase: rng() * Math.PI * 2,
          speed:       0,
        },
      };

      this._creatures.push(creature);
    }
  }

  // ── Clear ──────────────────────────────────────────────────────────────────

  /** Remove all creatures and dispose GPU resources. Re-initialises pools on next frame. */
  clearAll() {
    for (const c of this._creatures) disposeCreature({ mesh: c.mesh, group: c.group });
    this._creatures    = [];
    this._poolsReady   = false; // triggers re-init on next update if models loaded
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  /**
   * Update all creatures. Call from WorldSystem.update().
   * @param {number} delta     seconds since last frame
   * @param {number} time      total elapsed time
   * @param {THREE.Vector3} playerPos
   */
  update(delta, time, playerPos) {
    this._playerPos.copy(playerPos);

    // Initialise pools once models are loaded and we have a valid player position
    if (!this._poolsReady && this._modelsReady) {
      this._poolsReady = true;
      this._initCreaturePools(playerPos);
    }
    if (this._poolsReady) this._recycleDistantCreatures(playerPos);

    const toRecycle = [];

    for (const c of this._creatures) {
      // ── Collapsed (shot) creature — bone-based crumple ────────────────
      if (c.fsm.collapsed) {
        c.fsm.collapseTimer -= delta;
        this._animateCollapse(c, delta);
        if (c.fsm.collapseTimer <= 0) toRecycle.push(c);
        continue;
      }

      this._updateBehaviour(c, delta);
      this._updateMovement(c, delta);
      this._updateTerrain(c, delta);
      this._updateAnimation(c, delta, time);
    }

    // Recycle collapsed creatures — reset bones + teleport far away for recycler
    for (const c of toRecycle) {
      // Reset all bone rotations to rest pose
      for (const bone of c.bones) {
        bone.rotation.set(0, 0, 0);
        bone.scale.set(1, 1, 1);
      }
      c.fsm.collapsed    = false;
      c.fsm.collapseTimer = 0;
      c.group.rotation.set(0, 0, 0);
      c.fsm.resting      = false;
      c.fsm.alertLevel   = 0;
      c.fsm._tPitch      = 0;
      c.fsm._tRoll       = 0;
      c.anim.speed       = 0;
      // Force-recycle: push creature far away so recycler repositions it this frame
      c.position.set(
        this._playerPos.x + 2000,
        0,
        this._playerPos.z + 2000,
      );
      c.group.position.copy(c.position);
    }
  }

  // ── Fixed creature pools ──────────────────────────────────────────────────

  /** Spawn all pool entries once around the player on startup. */
  _initCreaturePools(playerPos) {
    for (const entry of CREATURE_POOLS) {
      if (!MODEL_CREATURE_CATALOG[entry.model]) continue;
      const before = this._creatures.length;
      this.spawnModelBatch({
        modelName: entry.model,
        count:     entry.count,
        spread:    POOL_FAR,
        seed:      this._worldSeed ^ entry.model.charCodeAt(0),
        origin:    playerPos.clone(),
      });
      // Tag each creature so the recycler knows its placement condition
      for (let i = before; i < this._creatures.length; i++) {
        this._creatures[i]._poolCondition = entry.condition;
      }
    }
  }

  /**
   * Silently teleport pool creatures that have drifted beyond RECYCLE_DIST
   * back to a fresh valid position near the player.
   * Staggered: processes ~⅓ of the list per frame to spread the CPU cost.
   */
  _recycleDistantCreatures(playerPos) {
    if (this._creatures.length === 0) return;
    const stride = Math.max(1, Math.ceil(this._creatures.length / 3));
    const start  = this._recycleOffset % this._creatures.length;
    const end    = Math.min(start + stride, this._creatures.length);
    this._recycleOffset = end >= this._creatures.length ? 0 : end;

    for (let i = start; i < end; i++) {
      const c = this._creatures[i];
      if (!c._poolCondition) continue; // manually spawned — leave alone

      const dx = c.position.x - playerPos.x;
      const dz = c.position.z - playerPos.z;
      if (dx * dx + dz * dz < RECYCLE_DIST * RECYCLE_DIST) continue;

      const pt = this._findPoolPoint(playerPos, c._poolCondition);
      if (!pt) continue;

      const groundY = getTerrainHeight(pt.x, pt.z);
      const bodyOff = c.params.bodyHeight * c.params.scale * 0.5 + (c.params.yOffset ?? 0);
      c.position.set(pt.x, groundY + bodyOff, pt.z);
      c.group.position.copy(c.position);
      c.facing             = Math.random() * Math.PI * 2;
      c.group.rotation.y   = c.facing;
      c.fsm.targetPos.copy(c.position);
      c.fsm.wanderTimer    = Math.random() * 8;
      c.fsm.resting        = false;
      c.fsm.alertLevel     = 0;
      c.fsm._tPitch        = 0;
      c.fsm._tRoll         = 0;
      c.anim.speed         = 0;
    }
  }

  /** Find a position in a ring around the player satisfying condition. */
  _findPoolPoint(playerPos, condition) {
    for (let i = 0; i < POOL_FIND_TRIES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = POOL_NEAR + Math.random() * (POOL_FAR - POOL_NEAR);
      const x = playerPos.x + Math.cos(angle) * r;
      const z = playerPos.z + Math.sin(angle) * r;
      if (condition(x, z)) return { x, z };
    }
    return null;
  }

  // ── Collapse animation ────────────────────────────────────────────────────

  /**
   * Drive all bones into a crumpled/fallen pose.
   * Progress 0→1 over the first 0.7 s; then held until recycle.
   */
  _animateCollapse(c, delta) {
    const progress = Math.min(1, (4.0 - c.fsm.collapseTimer) / 0.7);
    const ease     = progress * progress * (3 - 2 * progress); // smoothstep
    const speed    = delta * 14;
    const descs    = c.boneDescs;
    const bones    = c.bones;

    for (const bd of descs) {
      const bone = bones[bd.id];
      if (!bone) continue;

      switch (bd.role) {
        case 'spine': {
          const frac = descs.filter(d => d.role === 'spine').indexOf(bd) /
                       Math.max(1, descs.filter(d => d.role === 'spine').length - 1);
          // Sag to one side and crumple forward
          bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, (frac - 0.5) * 1.4 * ease, speed);
          bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, 0.5 * ease, speed);
          break;
        }
        case 'limb_upper':
          // Legs splay outward
          bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, 0.9 * ease, speed);
          bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, 0.4 * ease, speed);
          break;
        case 'limb_lower':
          // Shins buckle inward
          bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, -0.7 * ease, speed);
          break;
        case 'head':
          bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, 0.8 * ease, speed);
          break;
        case 'tail': {
          const ti = descs.filter(d => d.role === 'tail').indexOf(bd);
          bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, (ti + 1) * 0.3 * ease, speed);
          bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, 0.4 * ease, speed);
          break;
        }
      }
    }
    c.mesh.skeleton.update();
  }

  // ── Hit / collapse ────────────────────────────────────────────────────────

  /** Mark a creature as hit — it collapses, lies on the floor, then recycles. */
  hitCreature(c) {
    if (c.fsm.collapsed) return;
    c.fsm.collapsed     = true;
    c.fsm.collapseTimer = 4.0;
    c.anim.speed        = 0;
    c.fsm.resting       = true; // stop wander logic
  }

  // ── Behaviour ──────────────────────────────────────────────────────────────

  _updateBehaviour(c, delta) {
    const pPos    = this._playerPos;
    const pos     = c.position;
    const affinityMap = c.params.affinityMap;
    const sameSpeciesW = affinityMap.weights[AFFINITY_TYPE.SAME_SPECIES] ?? 0;

    // ── Alert level ───────────────────────────────────────────────────────
    const distToPlayer = pos.distanceTo(pPos);
    const threatWeight = Math.abs(affinityMap.weights[AFFINITY_TYPE.PLAYER_THREAT] ?? 0);
    const proximityFactor = Math.max(0, 1 - distToPlayer / 15);
    if (distToPlayer < 12) {
      c.fsm.alertLevel = THREE.MathUtils.lerp(c.fsm.alertLevel, proximityFactor * threatWeight, delta * 3);
    } else {
      c.fsm.alertLevel = THREE.MathUtils.lerp(c.fsm.alertLevel, 0, delta * 0.5);
    }

    // ── SEPARATION — personal space, evaluated every frame ────────────────
    // Solitary creatures (negative SAME_SPECIES) have a larger personal bubble.
    const personalSpace = (3.5 + c.params.bodyWidth * c.params.scale)
                        * (sameSpeciesW < -0.1 ? 2.0 : 1.0);

    let sepX = 0, sepZ = 0, sepCount = 0;
    for (const other of this._creatures) {
      if (other === c) continue;
      const dx = pos.x - other.position.x;
      const dz = pos.z - other.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < personalSpace * personalSpace && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const strength = Math.pow(1 - d / personalSpace, 2); // quadratic: strong at centre
        sepX += (dx / d) * strength;
        sepZ += (dz / d) * strength;
        sepCount++;
      }
    }

    if (sepCount > 0) {
      // Override target: flee personal space immediately, aim 2× radius ahead
      const sepLen = Math.sqrt(sepX * sepX + sepZ * sepZ) || 1;
      const fleeScale = personalSpace * 2 / sepLen;
      c.fsm.targetPos.set(
        pos.x + sepX * fleeScale,
        0,
        pos.z + sepZ * fleeScale,
      );
      c.fsm.targetPos.y = getTerrainHeight(c.fsm.targetPos.x, c.fsm.targetPos.z);
      c.fsm.desireVec.set(sepX / sepLen, 0, sepZ / sepLen);
      // Brief cooldown so the creature doesn't immediately re-flock after clearing
      c.fsm.targetCooldown = 1.5 + Math.random();
      return;
    }

    // ── REST — stop at each wander destination before moving again ───────
    if (c.fsm.resting) {
      c.fsm.restTimer -= delta;
      c.fsm.desireVec.set(0, 0, 0); // signals _updateMovement to idle
      if (c.fsm.restTimer > 0) return; // still resting
      c.fsm.resting = false;          // rest over — fall through to pick next target
    }

    // ── DESIRE — re-evaluate only when target reached or cooldown expired ─
    c.fsm.targetCooldown -= delta;
    const distToTarget = pos.distanceTo(c.fsm.targetPos);
    if (c.fsm.targetCooldown > 0 && distToTarget > 3.5) return; // still on course

    // Build nearby tagged objects
    const nearby = [{ tag: AFFINITY_TYPE.PLAYER, pos: pPos }];
    if (distToPlayer < 12) {
      nearby.push({ tag: AFFINITY_TYPE.PLAYER_THREAT, pos: pPos });
    }

    // Trees / plants from terrain chunks
    if (this._terrainManager) {
      const cx = Math.floor(pos.x / this._terrainManager.chunkSize);
      const cz = Math.floor(pos.z / this._terrainManager.chunkSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const chunk = this._terrainManager._chunks.get(`${cx+dx}_${cz+dz}`);
          if (chunk?._treePositions) {
            for (const tp of chunk._treePositions) {
              if (pos.distanceTo(tp.pos) < 25) {
                nearby.push({ tag: AFFINITY_TYPE.PLANT, pos: tp.pos });
              }
            }
          }
        }
      }
    }

    // Water affinity
    if (getTerrainHeight(pos.x, pos.z) < 2.5) {
      nearby.push({ tag: AFFINITY_TYPE.WATER, pos: new THREE.Vector3(pos.x, 0, pos.z) });
    }

    // Herd cohesion: only add flockmates that are in the 8-30m band (not too close, not too far).
    // This creates loose spacing rather than pile-ups.
    const HERD_MIN = personalSpace * 1.5;  // closer than this → separation handles it
    const HERD_MAX = sameSpeciesW > 0.2 ? 35 : 20;
    for (const other of this._creatures) {
      if (other === c) continue;
      const d = pos.distanceTo(other.position);
      if (d > HERD_MIN && d < HERD_MAX) {
        nearby.push({ tag: AFFINITY_TYPE.SAME_SPECIES, pos: other.position });
      }
    }

    const desire = affinityMap.computeDesireVector(c.group, nearby);
    c.fsm.desireVec.copy(desire);

    // ── Target selection ──────────────────────────────────────────────────
    if (desire.length() < 0.08) {
      // No strong attraction/repulsion — wander independently
      c.fsm.wanderTimer -= delta;
      if (c.fsm.wanderTimer <= 0) {
        // Each creature gets its own angle offset so herds spread out naturally
        const angle = c.fsm.wanderOffset + Math.random() * Math.PI * 2;
        const dist  = 25 + Math.random() * 45;
        c.fsm.targetPos.set(
          pos.x + Math.cos(angle) * dist,
          0,
          pos.z + Math.sin(angle) * dist,
        );
        c.fsm.targetPos.y = getTerrainHeight(c.fsm.targetPos.x, c.fsm.targetPos.z);
        c.fsm.wanderOffset += Math.PI * (0.5 + Math.random());
        c.fsm.wanderTimer = 12 + Math.random() * 18;
        c.fsm.desireVec.set(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(0.4);
      } else if (distToTarget < 4 && !c.fsm.resting) {
        // Arrived at wander destination — rest before next leg
        c.fsm.resting   = true;
        c.fsm.restTimer = 2 + Math.random() * 6; // 2–8 s rest
        c.fsm.wanderTimer = 0; // pick new target immediately after rest
      }
    } else {
      // Seek/flee: set a real destination 15–30 m ahead, not a per-frame micro-step
      const desireLen  = desire.length();
      const desireNorm = _v1.copy(desire).normalize();
      const targetDist = 15 + desireLen * 12; // stronger desire → aim further
      c.fsm.targetPos.set(
        pos.x + desireNorm.x * targetDist,
        0,
        pos.z + desireNorm.z * targetDist,
      );
      c.fsm.targetPos.y = getTerrainHeight(c.fsm.targetPos.x, c.fsm.targetPos.z);
      c.fsm.targetCooldown = 2.5 + Math.random() * 2.5; // re-check in 2.5–5 s
    }
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  _updateMovement(c, delta) {
    const profile = c.params.behaviour;
    const fsm     = c.fsm;
    const pos     = c.position;
    const morph   = c.params.morphotype;
    // params.speedMult (per-model override) takes priority over biome recipe
    const speedMult = c.params.speedMult ?? (c.recipe ? c.recipe.speedMult : 1.0);

    const GLOBAL_SPEED = 0.5;

    // During rest: decelerate to stop, skip movement logic
    if (c.fsm.resting) {
      c.anim.speed = THREE.MathUtils.lerp(c.anim.speed, 0, delta * 4);
      c.group.position.copy(pos);
      c.group.rotation.y = c.facing;
      return;
    }

    // NOPED floaters/undulators move differently
    if (morph === MORPHOTYPE.NOPED) {
      if (c.params.subtype === NOPED_SUBTYPE.UNDULATOR) {
        const driftSpeed = 1.2 * speedMult * GLOBAL_SPEED;
        pos.x += Math.cos(c.facing) * driftSpeed * delta;
        pos.z += Math.sin(c.facing) * driftSpeed * delta;
        c.anim.speed = driftSpeed;
        if (Math.random() < delta * 0.05) c.facing += (Math.random() - 0.5) * 1.5;
      } else if (c.params.subtype === NOPED_SUBTYPE.FLOATER) {
        pos.x += Math.cos(c.facing) * 0.5 * speedMult * GLOBAL_SPEED * delta;
        pos.z += Math.sin(c.facing) * 0.5 * speedMult * GLOBAL_SPEED * delta;
        c.anim.speed = 0;
        if (Math.random() < delta * 0.03) c.facing += (Math.random() - 0.5) * 1.0;
      }
      c.group.position.copy(pos);
      return;
    }

    // Speed based on desire magnitude, alert level, and biome mult
    let baseSpeed = fsm.desireVec.length() * 5.0;
    if (fsm.alertLevel > 0.5) baseSpeed = profile.fleeSpeed || 8.0;

    let targetSpeed = baseSpeed * speedMult * GLOBAL_SPEED * (1.0 + fsm.alertLevel * 0.5);

    // Smooth speed
    c.anim.speed = THREE.MathUtils.lerp(c.anim.speed, targetSpeed, delta * 2);

    // Direction toward target
    _v1.subVectors(fsm.targetPos, pos);
    _v1.y = 0;
    const dist = _v1.length();

    if (dist > 0.5 && c.anim.speed > 0.1) {
      _v1.normalize();
      const targetFacing = Math.atan2(_v1.x, _v1.z);
      const angleDiff = _angleDiff(targetFacing, c.facing);
      // Global 50% turn rate reduction; params.turnRateMult for per-creature tuning
      const turnRate = delta * 2.0 * (c.params.turnRateMult ?? 1.0);
      c.facing += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnRate);

      const spd = Math.min(c.anim.speed, dist / delta);
      pos.x += Math.sin(c.facing) * spd * delta;
      pos.z += Math.cos(c.facing) * spd * delta;
    }

    c.group.position.copy(pos);
    c.group.rotation.y = c.facing;
  }

  // ── Terrain ────────────────────────────────────────────────────────────────

  _updateTerrain(c, delta = 0.016) {
    const morph  = c.params.morphotype;
    const params = c.params;
    const pos    = c.position;
    const biome  = c.biomeTag;
    const fsm    = c.fsm;

    // ── Height ────────────────────────────────────────────────────────────
    if (morph === MORPHOTYPE.NOPED && params.subtype === NOPED_SUBTYPE.FLOATER) {
      const floatHeight = { AQUATIC: 0.2, TOXIC: 1.5, VOLCANIC: 2.5 }[biome]
        || params.floatHeight || 3.0;
      const groundY = getTerrainHeight(pos.x, pos.z);
      pos.y = THREE.MathUtils.lerp(pos.y, groundY + floatHeight, 0.05);
    } else {
      const groundY = getTerrainHeight(pos.x, pos.z);
      pos.y = groundY + params.bodyHeight * params.scale * 0.5 + (params.yOffset ?? 0);
    }
    c.group.position.y = pos.y;

    // ── Terrain slope alignment (pitch + roll) ────────────────────────────
    // Sample terrain in the creature's local forward and right directions.
    // Floaters hover and stay level; all grounded creatures tilt with slope.
    if (morph === MORPHOTYPE.NOPED && params.subtype === NOPED_SUBTYPE.FLOATER) {
      // Gently return to level
      fsm._tPitch = THREE.MathUtils.lerp(fsm._tPitch, 0, delta * 2);
      fsm._tRoll  = THREE.MathUtils.lerp(fsm._tRoll,  0, delta * 2);
    } else {
      const sd = Math.max(1.2, (params.bodyLength || 1.5) * params.scale * 0.45);

      const fwdX = Math.sin(c.facing), fwdZ = Math.cos(c.facing);
      const rgtX = Math.cos(c.facing), rgtZ = -Math.sin(c.facing);

      const hC = getTerrainHeight(pos.x, pos.z);
      const hF = getTerrainHeight(pos.x + fwdX * sd, pos.z + fwdZ * sd);
      const hR = getTerrainHeight(pos.x + rgtX * sd, pos.z + rgtZ * sd);

      // Pitch: nose tilts up on uphill, down on downhill.
      // With YXZ Euler, negative rotation.x raises the nose.
      const rawPitch = -Math.atan2(hF - hC, sd);
      // Roll: body tilts toward the higher side.
      const rawRoll  =  Math.atan2(hR - hC, sd);

      // Clamp to ±35° to avoid extreme angles on very steep terrain
      const CLAMP = 0.61; // ~35°
      const tPitch = Math.max(-CLAMP, Math.min(CLAMP, rawPitch));
      const tRoll  = Math.max(-CLAMP, Math.min(CLAMP, rawRoll));

      // Smooth — faster response when moving, slower when still
      const rate = 4 + c.anim.speed * 2;
      fsm._tPitch = THREE.MathUtils.lerp(fsm._tPitch, tPitch, delta * rate);
      fsm._tRoll  = THREE.MathUtils.lerp(fsm._tRoll,  tRoll,  delta * rate);
    }

    // Apply (rotation.y = facing is set in _updateMovement; order = YXZ)
    c.group.rotation.x = fsm._tPitch;
    c.group.rotation.z = fsm._tRoll;
  }

  // ── Animation ─────────────────────────────────────────────────────────────

  _updateAnimation(c, delta, time) {
    const morph = c.params.morphotype;
    const anim  = c.anim;
    const bones = c.bones;
    const descs = c.boneDescs;
    const speed = anim.speed;
    const alert = c.fsm.alertLevel;

    if (morph === MORPHOTYPE.NOPED) {
      this._animateNoped(c, delta, time);
      return;
    }

    // Gait frequency scaled by speed and biome
    let baseFreq = morph === MORPHOTYPE.BIPED
      ? (speed > GALLOP_SPEED_THRESHOLD ? GAIT_FREQ.BIPED_HOP : GAIT_FREQ.BIPED_WALK)
      : (speed > GALLOP_SPEED_THRESHOLD ? GAIT_FREQ.QUADRUPED_GALLOP : GAIT_FREQ.QUADRUPED_TROT);

    // Bipeds need a faster phase rate — speed/4 at walking pace barely moves.
    // Bipeds also use a crisper minimum so steps are always visible.
    const phaseFactor = morph === MORPHOTYPE.BIPED
      ? Math.max(0.35, speed / 2.5)
      : Math.max(0.10, speed / 4);
    anim.phase += delta * baseFreq * Math.PI * 2 * phaseFactor;

    // Spine — travelling wave + vertical bob ──────────────────────────────
    const spineIds = descs.filter(d => d.role === 'spine').map(d => d.id);
    const spineN   = Math.max(1, spineIds.length - 1);
    const speedFactor = Math.min(1.5, speed / 4);

    for (let i = 0; i < spineIds.length; i++) {
      const bone = bones[spineIds[i]];
      const frac = i / spineN;
      const wavePhase = anim.phase - i * 0.6;
      const envelope = Math.sin(frac * Math.PI);

      if (morph === MORPHOTYPE.BIPED) {
        // Hip rock (Z = lateral tilt): hips swing one way, shoulders counter.
        // A vertical spine needs Z rotation for side-to-side lean, not Y (which twists).
        const hipAmt = 0.07 * Math.min(1, speed / 3);
        bone.rotation.z = Math.sin(anim.phase) * hipAmt * (1 - frac * 1.8);
        bone.rotation.y = 0; // suppress twist on vertical spine
      } else {
        // Quadruped — keep travelling lateral sway on Y
        const swayAmt = (0.08 + alert * 0.05) * speedFactor * envelope;
        bone.rotation.y = Math.sin(wavePhase) * swayAmt;
      }

      // Vertical bob
      const bobAmt = 0.02 * speedFactor * envelope;
      bone.position.y += Math.sin(wavePhase * 2) * bobAmt;

      // V3 Posture: Alert lean
      const threatAffinity = c.params.affinityMap.weights[AFFINITY_TYPE.PLAYER_THREAT] || 0;
      const postureAngle = threatAffinity > 0.3 
        ? THREE.MathUtils.lerp(0, -0.2, alert) // Aggressive lean
        : THREE.MathUtils.lerp(0, 0.15, alert); // FEAR lean
      bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, postureAngle, delta * 3);
    }

    // ── Head tracking (V3 Weighted) ──────────────────────────────────────────────
    const headIds = descs.filter(d => d.role === 'head').map(d => d.id);
    if (headIds.length > 0) {
      const headBone = bones[headIds[0]];
      const playerAffinity = Math.abs(c.params.affinityMap.weights[AFFINITY_TYPE.PLAYER] || 0.2);
      const lookWeight = playerAffinity * (0.3 + alert * 0.7);

      if (alert > 0.1 || playerAffinity > 0.5) {
        _v1.copy(this._playerPos).sub(c.group.position).normalize();
        const yaw   = Math.atan2(_v1.x, _v1.z) - c.facing;
        const pitch = -Math.atan2(_v1.y, Math.sqrt(_v1.x * _v1.x + _v1.z * _v1.z));
        _targetQ.setFromEuler(new THREE.Euler(pitch * 0.5, yaw * 0.6 * lookWeight, 0));
        headBone.quaternion.slerp(_targetQ, delta * 4 * lookWeight);
      } else {
        const driftY = Math.sin(time * 0.4) * 0.2;
        _targetQ.setFromEuler(new THREE.Euler(0, driftY, 0));
        headBone.quaternion.slerp(_targetQ, delta * 1.0);
      }
    }

    // Neck posture shift
    const neckIds = descs.filter(d => d.role === 'neck').map(d => d.id);
    for (let i = 0; i < neckIds.length; i++) {
        const bone = bones[neckIds[i]];
        const tilt = alert * -0.25; 
        bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, tilt, delta * 2.5);
    }

    // ── Tail wave ─────────────────────────────────────────────────────────
    // c.params.tailSwing scales amplitude — default 1.0, 2.0+ for dramatic swoosh.
    const tailSwing = c.params.tailSwing ?? 1.0;
    const tailIds   = descs.filter(d => d.role === 'tail').map(d => d.id);
    const tailN     = tailIds.length;
    for (let i = 0; i < tailN; i++) {
      const bone    = bones[tailIds[i]];
      const tipFrac = (i + 1) / tailN;           // 0→1 from base to tip
      // Idle tail expressive, less when running
      const baseAmt = (speed < 1.0 ? 0.20 : 0.10) * tailSwing;
      // Amplitude grows toward the tip (whip effect)
      const amp     = baseAmt * (0.3 + tipFrac * 0.9);
      const laggedPh = anim.phase * 1.3 - i * 0.55;  // travelling wave base→tip
      bone.rotation.y = Math.sin(laggedPh) * amp;
      bone.rotation.z = Math.sin(laggedPh * 0.7 + 0.4) * amp * 0.45;
    }

    // IK and skeletal update
    if (c.footIndices.length > 0) this._solveFootIK(c, delta);
    c.mesh.skeleton.update();
  }

  _animateNoped(c, delta, time) {
    const { subtype } = c.params;
    const anim  = c.anim;
    const bones = c.bones;
    const descs = c.boneDescs;

    if (subtype === NOPED_SUBTYPE.UNDULATOR) {
      const wl   = c.params.undulatorWavelength || 0.6;
      const amp  = c.params.undulatorAmplitude  || 0.5;
      anim.phase += delta * GAIT_FREQ.NOPED_UNDULATOR * Math.PI * 2;

      descs.forEach((bd, i) => {
        if (bd.role === 'spine' && bones[i]) {
          bones[i].rotation.y = Math.sin(anim.phase + i * wl * Math.PI * 2) * amp;
        }
      });
    } else if (subtype === NOPED_SUBTYPE.FLOATER) {
      anim.phase += delta * GAIT_FREQ.NOPED_FLOATER * Math.PI * 2;

      // Bob vertically
      const bob = Math.sin(anim.phase) * 0.3;
      c.group.position.y = c.position.y + bob;

      // Tentacle oscillation
      descs.forEach((bd, i) => {
        if (bd.role === 'tail' && bones[i]) {
          const offset = (bd.tentacleIndex || 0) * Math.PI * 2 / (c.params.tentacleCount || 6);
          bones[i].rotation.x = Math.sin(anim.phase + offset) * 0.4;
          bones[i].rotation.z = Math.cos(anim.phase + offset) * 0.25;
        }
      });
    } else if (subtype === NOPED_SUBTYPE.ROLLER) {
      // Spin in direction of movement
      const rollSpeed = c.anim.speed;
      if (bones[0]) {
        bones[0].rotation.z += delta * rollSpeed * 2;
      }
    } else {
      // RADIAL — arms pulse
      anim.phase += delta * 0.8;
      descs.forEach((bd, i) => {
        if (bd.role === 'tail' && bones[i]) {
          bones[i].rotation.y = Math.sin(anim.phase + i * 1.2) * 0.3;
        }
      });
    }

    c.mesh.skeleton?.update();
  }

  _solveFootIK(c, delta) {
    const { boneDescs, bones, footIndices, footTargets, footPhases, anim, params, group } = c;
    const speed  = anim.speed;
    const phase  = anim.phase;
    const stepH  = params.bodyHeight * params.scale * 0.6 * (params.stepHeightMult ?? 1.0);

    // How much the shin bends relative to a full IK solve.
    // 1.0 = full bend (default), lower = stiffer lower leg (e.g. 0.15 for heavy quadrupeds).
    const shinBend = params.shinBendWeight ?? 0.6;

    for (let fi = 0; fi < footIndices.length; fi++) {
      const footBoneId = footIndices[fi];
      const footDesc   = boneDescs[footBoneId];
      const footPh     = (phase + footPhases[fi]) % (Math.PI * 2);
      const isLift     = footPh < Math.PI;

      if (speed < 0.3) continue;

      // ── Foot target (world space) ─────────────────────────────────────
      if (isLift) {
        const liftFrac = footPh / Math.PI;
        const footDest = group.localToWorld(footDesc.end.clone());
        footDest.y += Math.sin(liftFrac * Math.PI) * stepH;

        // Bipeds: arc the foot forward during lift to produce actual stride.
        // The foot swings in a half-sine arc from plant → forward → plant.
        if (params.morphotype === MORPHOTYPE.BIPED && speed > 0.4) {
          const stride = params.bodyHeight * params.scale * 0.65 * Math.min(1, speed / 3);
          const arc    = Math.sin(liftFrac * Math.PI);
          footDest.x  += Math.sin(c.facing) * stride * arc;
          footDest.z  += Math.cos(c.facing) * stride * arc;
        }

        footTargets[fi].lerp(footDest, delta * 10);
      } else {
        const plantPos = group.localToWorld(footDesc.end.clone());
        plantPos.y = getTerrainHeight(plantPos.x, plantPos.z);
        footTargets[fi].lerp(plantPos, delta * 14);
      }

      // ── Walk up the chain: foot → shin → thigh ───────────────────────
      // IK root is the THIGH (limb_upper), not the knee — this is what makes
      // the thigh do the main swinging work.
      const shinBoneId  = boneDescs[footBoneId]?.parent;          // limb_lower
      if (shinBoneId == null) continue;
      const thighBoneId = boneDescs[shinBoneId]?.parent;           // limb_upper
      if (thighBoneId == null) continue;

      const thighDesc = boneDescs[thighBoneId];
      const shinDesc  = boneDescs[shinBoneId];

      const rootPos = group.localToWorld(thighDesc.start.clone());
      const target  = footTargets[fi].clone();
      const len1    = thighDesc.start.distanceTo(thighDesc.end) * params.scale;
      const len2    = shinDesc.start.distanceTo(shinDesc.end) * params.scale;

      solve2Bone(rootPos, target, len1, len2, _poleVec, this._midJoint);

      const thighBone = bones[thighBoneId];
      const shinBone  = bones[shinBoneId];
      if (!thighBone || !shinBone) continue;

      // Thigh: full IK rotation — carries the leg through the stride
      _v1.subVectors(this._midJoint, rootPos).normalize();
      thighBone.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, -1, 0),
        thighBone.parent.worldToLocal(_v1.clone().add(rootPos))
          .sub(thighBone.parent.worldToLocal(rootPos.clone())).normalize(),
      );

      // Shin: partial IK — blend between rest (identity) and full solve.
      // shinBend = 0 → shin stays completely straight, thigh absorbs all motion.
      _v2.subVectors(target, this._midJoint).normalize();
      _quat.setFromUnitVectors(
        new THREE.Vector3(0, -1, 0),
        shinBone.parent.worldToLocal(_v2.clone().add(this._midJoint))
          .sub(shinBone.parent.worldToLocal(this._midJoint.clone())).normalize(),
      );
      shinBone.quaternion.identity().slerp(_quat, shinBend);

      // Foot bone: no rotation — stays flat/in rest pose always.
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Find all 'foot' bone indices in a boneDescs array. */
function _findFootBoneIndices(boneDescs) {
  return boneDescs.reduce((acc, bd, i) => {
    if (bd.role === 'foot') acc.push(i);
    return acc;
  }, []);
}

/** Return the shortest angle difference between two angles in radians. */
function _angleDiff(a, b) {
  let d = a - b;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
