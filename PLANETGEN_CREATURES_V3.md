# PlanetGen — Creature System v2
**Implementation Plan | Claude Code Brief**

---

## Context & Assumptions

The **procedural creature generation stage is complete and working**. The following already exist and must not be modified:

- `src/creatures/CreatureGenerator.ts` — builds skeleton, tube geometry, vertex colours, skinned mesh from `CreatureParams`
- `src/creatures/rng.ts` — `mulberry32` seeded RNG
- `src/creatures/noise.ts` — simplex3 for vertex colour patterns
- `src/creatures/ik.ts` — FABRIK IK solver
- `src/creatures/CreatureParams.ts` — `CreatureParams` and `BehaviourProfile` types

This spec covers everything **after** generation: the assembly pipeline upgrades, the biome-driven constraint/recipe system, tag-based affinity behaviour, animation, terrain integration, and spawn UI. This replaces the v1 FSM-preset approach and the old plain `BehaviourProfile` with a data-driven NMS-style system.

Creatures integrate with the IWSDK ECS — each creature is an entity, all logic runs as Systems, player position comes from `XROriginComponent`.

---

## What Changes From v1

| v1 | v2 |
|---|---|
| Pure tube geometry only | Tube body + descriptor part assembly (heads, tails, limb endings) |
| Hardcoded FSM preset profiles (GRAZER, HUNTER…) | Tag affinity weight vectors — behaviour emerges from data |
| Colour picked freely from seed | Colour constrained by biome recipe |
| No biome awareness | All generation filtered through `BiomeRecipe` |
| `BehaviourProfile.type` string enum | `AffinityMap` — per-tag float weights |

---

## Part 1 — Descriptor Part Assembly

### Overview

Artists (or procedural generators) produce a small bank of low-poly mesh parts. The assembly system selects and attaches parts from this bank to the generated tube skeleton, driven by seed + biome tag constraints. This is the NMS approach: curated parts × procedural selection = huge apparent variety.

### Part Banks

Each bank is a folder of `.glb` files. Parts are tagged with compatible morphotypes and biome affinities.

```
src/creatures/parts/
  heads/
    head_blunt_A.glb          # tags: [QUADRUPED, BIPED], biomes: [ARID, TEMPERATE]
    head_elongated_B.glb      # tags: [QUADRUPED], biomes: [ANY]
    head_wide_C.glb           # tags: [BIPED, NOPED_RADIAL], biomes: [AQUATIC, MARSH]
    head_eyeless_D.glb        # tags: [QUADRUPED, BIPED], biomes: [TOXIC, CAVE]
    head_beak_E.glb           # tags: [BIPED], biomes: [ARCTIC, TEMPERATE]
    head_alien_F.glb          # tags: [ANY], biomes: [ANY]
  tails/
    tail_stub.glb
    tail_fin.glb              # biomes: [AQUATIC, MARSH]
    tail_whip.glb
    tail_club.glb             # biomes: [ARID, VOLCANIC]
    tail_fan.glb              # biomes: [TEMPERATE, JUNGLE]
  limb_endings/
    foot_pad.glb
    foot_claw.glb             # biomes: [ARID, VOLCANIC, TOXIC]
    foot_hoof.glb             # biomes: [TEMPERATE, ARCTIC]
    foot_fin.glb              # biomes: [AQUATIC, MARSH]
    foot_talon.glb            # biomes: [BIPED only]
  accessories/
    horn_single.glb
    horn_dual.glb
    frill_neck.glb
    spine_ridge.glb
    antenna.glb               # biomes: [TOXIC, CAVE]
    biolum_spots.glb          # emissive — biomes: [CAVE, TOXIC, DEEP_SPACE]
```

Minimum viable bank: **6 heads, 5 tails, 5 limb endings, 6 accessories**. More parts multiply variety without code changes.

### Part Descriptor Format

Each part is described in `src/creatures/parts/parts-manifest.json`:

```json
{
  "heads": [
    {
      "id": "head_blunt_A",
      "file": "heads/head_blunt_A.glb",
      "attachBone": "head",
      "compatibleMorphotypes": ["QUADRUPED", "BIPED"],
      "biomeAffinity": ["ARID", "TEMPERATE", "JUNGLE"],
      "weight": 1.0
    }
  ],
  "tails": [ ... ],
  "limbEndings": [ ... ],
  "accessories": [ ... ]
}
```

### Assembly Logic (`CreatureAssembler.ts`)

Called after the generator has built the base tube skeleton + mesh:

```typescript
function assembleParts(
  skeleton: Bone[],
  params: CreatureParams,
  biomeTag: BiomeTag,
  rng: () => number
): THREE.Group {

  const manifest = loadPartsManifest()

  // Filter each bank to parts compatible with this morphotype + biome
  const validHeads = manifest.heads.filter(p =>
    p.compatibleMorphotypes.includes(params.morphotype) &&
    (p.biomeAffinity.includes(biomeTag) || p.biomeAffinity.includes('ANY'))
  )

  // Weighted random selection from filtered pool
  const selectedHead = weightedPick(validHeads, rng)

  // Load GLB, scale to match headScale param, attach to head bone
  attachPart(selectedHead, skeleton.find(b => b.name === 'head'), params.headScale)

  // Repeat for tail, limb endings (one per limb), accessories (0–2)
  // Accessory count: floor(rng() * 3) — 0, 1, or 2
  // Accessory attach point: random spine bone
}
```

**Scaling rule**: Parts must scale to fit the generated body. The head GLB's bounding box is normalised to 1 unit at import; `attachPart` then scales it by `params.headScale * bodyWidth`. This ensures a small creature gets a proportionally small head regardless of which head mesh was selected.

**Colour tinting**: After attachment, vertex colours on the part mesh are tinted to blend with `params.skinColorA`. Parts do not use textures — they rely on vertex colour + the same low-poly aesthetic as the tube body.

---

## Part 2 — Biome Recipe System

### Overview

Every creature spawned into a biome is filtered through a `BiomeRecipe` — a constraint object that controls which morphotypes, colour ranges, part pools, and behaviour affinities are legal for that environment. This is the NMS "recipe" system: the world shapes the creature, not just the seed.

### BiomeTag Enum

```typescript
type BiomeTag =
  | 'TEMPERATE'
  | 'ARID'
  | 'ARCTIC'
  | 'JUNGLE'
  | 'AQUATIC'
  | 'MARSH'
  | 'TOXIC'
  | 'VOLCANIC'
  | 'CAVE'
  | 'DEEP_SPACE'  // for NOPED FLOATER zones at altitude
```

These map directly to the biome IDs already assigned per chunk in `HeightmapComponent.biomes`.

### BiomeRecipe Definition

```typescript
interface BiomeRecipe {
  biomeTag: BiomeTag

  // Which morphotypes are legal in this biome
  allowedMorphotypes: Array<'QUADRUPED' | 'BIPED' | 'NOPED'>

  // Colour constraints — creatures must pick from within these HSL ranges
  colourPalette: {
    hueRange:  [number, number]   // 0–360
    satRange:  [number, number]   // 0–1
    lightRange:[number, number]   // 0–1
  }

  // Affinity seeds — base values for tag affinity weights in this biome
  // These get noise-perturbed per creature but stay within range
  affinitySeeds: Partial<AffinityMap>

  // Multipliers on creature params
  scaleRange:   [number, number]  // min/max world scale
  speedMult:    number            // multiplier on all movement speeds
  aggression:   number            // 0–1, shifts affinity toward PLAYER_THREAT
}
```

### Preset Recipes

```typescript
const BIOME_RECIPES: Record<BiomeTag, BiomeRecipe> = {

  TEMPERATE: {
    allowedMorphotypes: ['QUADRUPED', 'BIPED', 'NOPED'],
    colourPalette: { hueRange: [60, 160], satRange: [0.2, 0.7], lightRange: [0.3, 0.7] },
    affinitySeeds: { PLANT: 0.6, WATER: 0.3, PLAYER_THREAT: -0.2 },
    scaleRange: [0.5, 2.0], speedMult: 1.0, aggression: 0.2
  },

  ARID: {
    allowedMorphotypes: ['QUADRUPED', 'NOPED'],
    colourPalette: { hueRange: [20, 50], satRange: [0.1, 0.5], lightRange: [0.5, 0.8] },
    affinitySeeds: { PLANT: 0.2, WATER: 0.9, PLAYER_THREAT: 0.1 },
    scaleRange: [0.3, 3.5], speedMult: 1.3, aggression: 0.4
  },

  ARCTIC: {
    allowedMorphotypes: ['QUADRUPED', 'BIPED'],
    colourPalette: { hueRange: [180, 240], satRange: [0.0, 0.3], lightRange: [0.6, 0.95] },
    affinitySeeds: { WARMTH: 0.8, PLAYER_THREAT: 0.0 },
    scaleRange: [1.0, 4.0], speedMult: 0.8, aggression: 0.3
  },

  JUNGLE: {
    allowedMorphotypes: ['QUADRUPED', 'BIPED', 'NOPED'],
    colourPalette: { hueRange: [80, 180], satRange: [0.4, 1.0], lightRange: [0.2, 0.6] },
    affinitySeeds: { PLANT: 0.8, PLAYER_THREAT: 0.3 },
    scaleRange: [0.2, 2.5], speedMult: 1.2, aggression: 0.5
  },

  AQUATIC: {
    allowedMorphotypes: ['NOPED', 'QUADRUPED'],  // QUADRUPED = sea creatures
    colourPalette: { hueRange: [160, 260], satRange: [0.3, 0.9], lightRange: [0.2, 0.7] },
    affinitySeeds: { WATER: 1.0, PLAYER_THREAT: 0.0 },
    scaleRange: [0.5, 5.0], speedMult: 0.9, aggression: 0.2
  },

  TOXIC: {
    allowedMorphotypes: ['QUADRUPED', 'BIPED', 'NOPED'],
    colourPalette: { hueRange: [60, 120], satRange: [0.6, 1.0], lightRange: [0.3, 0.6] },
    affinitySeeds: { PLAYER_THREAT: 0.7, PLANT: 0.1 },
    scaleRange: [0.3, 2.0], speedMult: 1.5, aggression: 0.8
  },

  VOLCANIC: {
    allowedMorphotypes: ['QUADRUPED', 'NOPED'],
    colourPalette: { hueRange: [0, 30], satRange: [0.5, 1.0], lightRange: [0.2, 0.5] },
    affinitySeeds: { PLAYER_THREAT: 0.5, WARMTH: 0.3 },
    scaleRange: [1.0, 5.0], speedMult: 0.7, aggression: 0.7
  },

  CAVE: {
    allowedMorphotypes: ['QUADRUPED', 'BIPED', 'NOPED'],
    colourPalette: { hueRange: [240, 320], satRange: [0.0, 0.4], lightRange: [0.05, 0.35] },
    affinitySeeds: { PLAYER_THREAT: 0.2, LIGHT: -0.8 },
    scaleRange: [0.2, 1.5], speedMult: 1.1, aggression: 0.4
  },
}
```

### Recipe Application

When `CreatureSpawnSystem` creates a creature entity, it:

1. Samples the biome at the spawn position from `HeightmapComponent.biomes`
2. Looks up the `BiomeRecipe` for that biome
3. Filters `allowedMorphotypes` — if the user's spawn panel selected `RANDOM`, pick from `allowedMorphotypes`; if they selected a specific morphotype not in `allowedMorphotypes`, skip that spawn point and try adjacent terrain
4. Generates `CreatureParams` via the existing generator, then **overrides**:
   - `skinColorA` / `skinColorB` — picked from `colourPalette` using seeded RNG
   - `scale` — clamped to `scaleRange`
   - `behaviour` affinities — seeded from `affinitySeeds` (see Part 3)

---

## Part 3 — Tag Affinity Behaviour

### Overview

Replaces the v1 FSM preset profiles. Each creature has an `AffinityMap` — a set of float weights keyed by world-object tags. Behaviour is not scripted; it **emerges** from the creature seeking high-affinity things and avoiding low-affinity things. NMS uses this exact approach.

### AffinityMap

```typescript
interface AffinityMap {
  PLANT:         number   // -1 to +1  (grazer vs. ignores plants)
  WATER:         number   // affinity for water bodies
  PLAYER:        number   // positive = curious, negative = avoids
  PLAYER_THREAT: number   // positive = aggression/charge, negative = flee
  SAME_SPECIES:  number   // positive = flocking, negative = solitary
  LIGHT:         number   // positive = phototropic, negative = shade-seeking
  WARMTH:        number   // thermotropic (relevant on ARCTIC / VOLCANIC biomes)
  ELEVATION:     number   // positive = seeks high ground, negative = low ground
  SOUND:         number   // player footstep / action noise response
}
```

All values in range `[-1.0, 1.0]`. Generated from `BiomeRecipe.affinitySeeds` + noise perturbation per creature:

```typescript
function generateAffinityMap(seeds: Partial<AffinityMap>, rng: () => number): AffinityMap {
  const base: AffinityMap = {
    PLANT: 0, WATER: 0, PLAYER: 0, PLAYER_THREAT: 0,
    SAME_SPECIES: 0, LIGHT: 0, WARMTH: 0, ELEVATION: 0, SOUND: 0
  }
  for (const key of Object.keys(base) as Array<keyof AffinityMap>) {
    const seed = seeds[key] ?? 0
    // Perturb by ±0.3 using RNG, clamp to [-1, 1]
    base[key] = Math.max(-1, Math.min(1, seed + (rng() - 0.5) * 0.6))
  }
  return base
}
```

### Emergent Behaviour Profiles

These arise from the affinity values — no code branching required:

| Emergent type | Key affinities |
|---------------|---------------|
| Grazer | `PLANT: +0.8`, `PLAYER: -0.2`, `PLAYER_THREAT: -0.5` |
| Skittish prey | `PLAYER: -0.7`, `PLAYER_THREAT: -0.9`, `SOUND: -0.8` |
| Curious | `PLAYER: +0.6`, `PLAYER_THREAT: -0.3` |
| Predator | `PLAYER_THREAT: +0.8`, `SOUND: +0.6` |
| Solitary drifter | `SAME_SPECIES: -0.5`, `PLAYER: 0`, `ELEVATION: +0.3` |
| Flocking bird | `SAME_SPECIES: +0.9`, `PLAYER: -0.4` |
| Phototropic alien | `LIGHT: +0.9`, `PLAYER: 0` |

### AffinityBehaviourSystem Logic

Each frame, per creature:

```typescript
// Build a desire vector from all tagged objects in radius
function computeDesireVector(
  creature: Entity,
  affinity: AffinityMap,
  worldObjects: TaggedObject[],  // includes player, plants, water, other creatures
  radius: number
): THREE.Vector3 {

  const desire = new THREE.Vector3()

  for (const obj of worldObjects) {
    if (distanceTo(creature, obj) > radius) continue

    // Get the affinity weight for this object's tag
    const weight = affinity[obj.tag] ?? 0
    if (Math.abs(weight) < 0.05) continue  // dead zone, ignore

    const dir = directionTo(creature, obj).normalize()
    const distFactor = 1 - (distanceTo(creature, obj) / radius)  // closer = stronger

    // Positive affinity = move toward, negative = move away
    desire.addScaledVector(dir, weight * distFactor)
  }

  return desire
}
```

Steering velocity = `lerp(currentVelocity, desireVector * maxSpeed, dt * turnRate)`.

The player is always in the `worldObjects` list with tags `PLAYER` and `PLAYER_THREAT`. When the player moves fast (footstep speed > threshold), the `SOUND` tag fires an additional impulse.

### Alert Level

Keep the v1 `alertLevel` float (0–1) but drive it from affinity rather than FSM state:

```typescript
// Alert rises when nearby negative-affinity objects are close
alertLevel += dt * Math.max(0, -affinity.PLAYER * playerProximityFactor)
alertLevel -= dt * 0.3  // natural decay
alertLevel = clamp(alertLevel, 0, 1)

// At high alert: animation speed up, posture shift, vocalisation trigger
```

### Updated `CreatureFSMComponent`

Simplify — we only need three states now, driven by affinity thresholds:

```typescript
class CreatureFSMComponent extends Component {
  static schema = {
    // 'WANDER' | 'ATTRACTED' | 'REPELLED'
    state:      { type: 'string', default: 'WANDER' },
    alertLevel: { type: 'float',  default: 0 },
    desireVec:  { type: 'object', default: null },  // current THREE.Vector3 desire
    velocity:   { type: 'object', default: null },  // current movement velocity
    wanderTarget: { type: 'object', default: null },
    wanderTimer:  { type: 'float', default: 0 },
  }
}
```

State transitions:
- `desire.length() < 0.1` → `WANDER` (pick random wander target)
- `desire.length() >= 0.1 AND net affinity > 0` → `ATTRACTED`
- `desire.length() >= 0.1 AND net affinity < 0` → `REPELLED`

---

## Part 4 — Animation System

**No changes to the FABRIK IK solver or gait phase logic from v1.** The following additions/changes only:

### Affinity-Driven Animation Modifiers

```typescript
// Speed scales with alertLevel and desire magnitude
animSpeed = baseAnimSpeed
           * recipe.speedMult
           * (1 + alertLevel * 0.8)
           * (1 + desireVec.length() * 0.5)

// Posture: at high alertLevel, spine rotates forward (aggressive lean) or backward (fear)
// Aggressive lean: PLAYER_THREAT > 0.5
// Fear lean: PLAYER affinity < -0.5
const postureAngle = affinity.PLAYER_THREAT > 0.5
  ? lerp(0, -0.3, alertLevel)   // forward lean
  : lerp(0, +0.2, alertLevel)   // backward recoil
spineRoot.rotation.x = lerp(spineRoot.rotation.x, postureAngle, dt * 4)
```

### Head Tracking (updated)

In v1, head tracked player only in AWARE/CIRCLE states. In v2, head tracking is continuous and weighted by `affinity.PLAYER`:

```typescript
if (Math.abs(affinity.PLAYER) > 0.2) {
  const lookWeight = Math.abs(affinity.PLAYER) * alertLevel
  const targetDir = playerPos.clone().sub(headBone.position).normalize()
  // Slerp head bone toward player, weighted by affinity magnitude
  headBone.quaternion.slerp(lookQuaternion(targetDir), dt * 3 * lookWeight)
}
```

Predators track intensely (`PLAYER_THREAT: +0.8` → high `lookWeight`). Passive grazers barely glance.

---

## Part 5 — Terrain Integration

No changes to v1 terrain system logic. One addition:

### Biome-Aware Hover Height (NOPED FLOATER)

```typescript
// FLOATER hover height varies by biome
const floatHeight = {
  AQUATIC: 0,          // skims surface
  CAVE: 1.5,
  DEEP_SPACE: 8.0,
  DEFAULT: 3.0,
}[biomeTag] ?? 3.0

creature.position.y = groundY + floatHeight + sin(phase * bobFreq) * bobAmt
```

---

## Part 6 — Spawn Control UI

Extend the v1 spawn panel with biome awareness:

```
┌─────────────────────────────────────┐
│  CREATURE SPAWNER                   │
│                                     │
│  Biome      [AUTO ▼]  ← reads chunk │
│  Morphotype [AUTO] [QUAD] [BI] [NO] │
│  Count      ──●──── 12              │
│  Spread (m) ──●──── 80              │
│  Seed       [ 42069      ] [🎲]      │
│                                     │
│  [SPAWN BATCH]   [CLEAR ALL]        │
│                                     │
│  Quick Presets:                     │
│  [Grazing Herd]  [Toxic Swarm]      │
│  [Arctic Pack]   [Drifter Cloud]    │
│  [Mixed Biome]   [Apex Hunters]     │
└─────────────────────────────────────┘
```

**Biome selector**: `AUTO` reads the biome at the player's current position from `HeightmapComponent`. Manual override allows forcing a recipe regardless of terrain (useful for debugging).

**Updated Quick Presets**:

```typescript
const PRESETS = {
  'Grazing Herd': {
    morphotype: 'AUTO', biome: 'TEMPERATE', count: 12, spread: 60
  },
  'Toxic Swarm': {
    morphotype: 'AUTO', biome: 'TOXIC', count: 20, spread: 30
  },
  'Arctic Pack': {
    morphotype: 'QUADRUPED', biome: 'ARCTIC', count: 6, spread: 50
  },
  'Drifter Cloud': {
    morphotype: 'NOPED', biome: 'AUTO', count: 15, spread: 50
  },
  'Mixed Biome': {
    morphotype: 'AUTO', biome: 'AUTO', count: 25, spread: 100
  },
  'Apex Hunters': {
    morphotype: 'AUTO', biome: 'AUTO', count: 3, spread: 80,
    affinityOverride: { PLAYER_THREAT: 0.9 }
  },
}
```

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/creatures/parts/parts-manifest.json` | **Create** | Part bank descriptor |
| `src/creatures/CreatureAssembler.ts` | **Create** | Part attachment logic |
| `src/creatures/BiomeRecipe.ts` | **Create** | `BiomeRecipe` type + all preset recipes |
| `src/creatures/AffinityMap.ts` | **Create** | `AffinityMap` type + `generateAffinityMap()` |
| `src/creatures/parts/*.glb` | **Create** | Minimum 6 heads, 5 tails, 5 limb endings, 6 accessories |
| `src/ecs/components.ts` | **Modify** | Replace old FSM schema with simplified 3-state version; add `AffinityMap` field to `CreatureComponent` |
| `src/ecs/systems/CreatureSpawnSystem.ts` | **Modify** | Add biome sampling, recipe lookup, apply colour + scale overrides |
| `src/ecs/systems/CreatureGeneratorSystem.ts` | **Modify** | After base mesh built, call `CreatureAssembler.assembleParts()` |
| `src/ecs/systems/CreatureBehaviourSystem.ts` | **Rewrite** | Replace FSM with `computeDesireVector()` affinity system |
| `src/ecs/systems/CreatureAnimSystem.ts` | **Modify** | Add affinity-driven posture + head tracking changes |
| `src/ui/CreatureSpawner.ts` | **Modify** | Add biome selector + updated presets |

**Do not modify**: `CreatureGenerator.ts`, `rng.ts`, `noise.ts`, `ik.ts`, `CreatureTerrainSystem.ts`, `CreatureFlockSystem.ts`, `CreatureAnimSystem.ts` (gait/IK sections).

---

## System Registration Order

Unchanged from v1 — no new systems added, `CreatureBehaviourSystem` is rewritten in place:

```typescript
world.registerSystem(CreatureSpawnSystem)
world.registerSystem(CreatureGeneratorSystem)   // now calls assembler after generation
world.registerSystem(CreatureTerrainSystem)
world.registerSystem(CreatureBehaviourSystem)   // now affinity-based, not FSM
world.registerSystem(CreatureFlockSystem)
world.registerSystem(CreatureAnimSystem)
```

---

## Performance Notes

Part assembly adds one `GLTFLoader` call per creature at spawn time — not per frame. Cache loaded GLBs in a `Map<string, THREE.Group>` keyed by part ID so each GLB is only parsed once.

```typescript
const partCache = new Map<string, THREE.Group>()

async function loadPart(id: string): Promise<THREE.Group> {
  if (partCache.has(id)) return partCache.get(id)!.clone()
  const gltf = await gltfLoader.loadAsync(`/creatures/parts/${id}.glb`)
  partCache.set(id, gltf.scene)
  return gltf.scene.clone()
}
```

Affinity computation is O(n × m) where n = creatures and m = world objects in radius. Cap `worldObjects` radius at 30m and use a spatial grid to avoid full-scene iteration. At 50 creatures and ~20 nearby objects per creature this is negligible.

---

## Definition of Done

- [ ] `pnpm build` passes with no TypeScript errors
- [ ] Part GLBs load and attach to generated skeleton at correct bone with correct scale
- [ ] Head, tail, limb ending, and accessory parts all visible on spawned creatures
- [ ] Spawning in TEMPERATE biome produces earth-tone creatures; TOXIC produces vivid/saturated ones
- [ ] Spawning in AQUATIC biome never produces BIPED morphotype (recipe filtering works)
- [ ] Two creatures from same seed + biome are visually identical
- [ ] Two creatures from same seed, different biomes are visually different (colour + parts differ)
- [ ] Grazer-affinity creature wanders toward plants, ignores player at distance
- [ ] Predator-affinity creature turns toward and moves toward player when in range
- [ ] Skittish creature moves away rapidly when player approaches
- [ ] Alert level rises with proximity, drives visible posture change
- [ ] Head tracks player weighted by affinity magnitude (predator stares, grazer glances)
- [ ] Biome selector AUTO correctly reads current chunk biome
- [ ] All 6 presets spawn creatures that look and behave correctly for their intended type
- [ ] Part GLBs cached — spawning 20 creatures of same morphotype causes only 1 load per unique part
- [ ] No THREE.js memory leaks on CLEAR ALL (parts disposed alongside tube mesh)
- [ ] 50 creatures at 30fps on mid-range laptop
