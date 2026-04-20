# PlanetGen — Procedural Creature System
**Implementation Plan | Claude Code Brief**

---

## Overview

A fully procedural creature system that generates, animates, and behaviourally drives exotic low-poly 3D animals in the PlanetGen scene. Every creature is defined by a **seed + morphotype**, making them deterministic, shareable, and infinitely varied. No pre-authored meshes or keyframe animations.

Creatures integrate with the existing IWSDK ECS refactor — each creature is an entity, behaviour runs as a System, and the player position comes from `XROriginComponent`.

---

## Morphotype Taxonomy

Three structural archetypes drive the skeleton generator:

### `QUADRUPED`
Four limbs, horizontal spine, optional tail.
Examples: mammals, reptiles, insectoids, exotic fauna.
- Spine: 4–8 vertebrae, slight S-curve
- Limbs: 4 × (upper + lower + foot), planted via IK
- Optional: tail (3–12 segments), neck (1–4 segments), wings (folded/spread)
- Gait: trot, gallop, scuttle (insect), slither-walk

### `BIPED`
Two legs, vertical or semi-vertical spine, two arms or wing-arms.
Examples: humanoids, theropods, birds, lanky aliens.
- Spine: 5–10 vertebrae, upright or forward-lean
- Legs: 2 × (thigh + shin + foot), digitigrade or plantigrade
- Arms: 2 × (upper + forearm + hand/claw), or vestigial
- Gait: walk, strafe, hop, drag (tail-dragging)

### `NOPED`
No locomotion limbs — floats, rolls, undulates, or hovers.
Examples: jellyfish-type, worm, slug, manta, rolling sphere creature.
- Body: single elongated or radially symmetric form
- Sub-types:
  - `FLOATER` — drifts via buoyancy oscillation
  - `UNDULATOR` — sinusoidal body wave (snake/eel)
  - `ROLLER` — rigid body rolls across terrain
  - `RADIAL` — radially symmetric (jellyfish, starfish)
- No IK needed — pure procedural animation

---

## Parameter Schema

Every creature is fully described by this seed-driven parameter object:

```typescript
interface CreatureParams {
  // Identity
  seed: number              // deterministic RNG seed
  morphotype: 'QUADRUPED' | 'BIPED' | 'NOPED'
  subtype?: string          // e.g. 'FLOATER', 'UNDULATOR', 'ROLLER', 'RADIAL'

  // Body proportions
  bodyLength: number        // 0.5 – 4.0  (metres)
  bodyWidth:  number        // 0.2 – 1.5
  bodyHeight: number        // 0.2 – 1.5
  neckLength: number        // 0 – 1.5
  headScale:  number        // 0.3 – 1.2  (relative to body)
  tailLength: number        // 0 – 3.0
  tailSegments: number      // 0 – 14

  // Limbs (QUADRUPED / BIPED only)
  limbCount:   number       // 2 or 4
  limbLength:  number       // 0.4 – 2.5  (upper segment)
  limbWidth:   number       // 0.05 – 0.3 (tube radius)
  footSize:    number       // 0.05 – 0.4
  digitigrade: boolean      // reverse-knee style

  // Geometry
  bodySegments:  number     // tube cross-section sides: 3–8 (low poly)
  spineSegments: number     // vertebrae count: 4–12
  tubeDetail:    number     // segments per bone length: 2–6

  // Surface
  skinColorA:  THREE.Color  // primary colour
  skinColorB:  THREE.Color  // secondary / pattern colour
  patternType: 'solid' | 'stripe' | 'spot' | 'noise' | 'iridescent'
  patternScale: number      // noise frequency

  // Behaviour
  behaviour: BehaviourProfile

  // Scale
  scale: number             // world-space uniform scale
}
```

---

## Behaviour Profiles

Each creature carries a `BehaviourProfile` that drives the FSM:

```typescript
interface BehaviourProfile {
  type: 'PASSIVE' | 'SKITTISH' | 'CURIOUS' | 'PREDATORY' | 'AMBIENT'

  // Awareness
  detectionRadius: number   // metres — how close player must be to trigger
  fovAngle:        number   // degrees — field of view for detection

  // Response
  fleeSpeed:    number      // m/s
  chaseSpeed:   number      // m/s (PREDATORY only)
  idleWander:   boolean     // roam randomly when unaware
  wanderRadius: number      // metres

  // Timing
  reactionDelay: number     // seconds before FSM transitions (0 = instant)
  idleAnimSpeed: number     // multiplier on idle oscillation frequency
}
```

### Preset profiles

| Name | Type | Notes |
|------|------|-------|
| `GRAZER` | PASSIVE | Wanders, ignores player, slow |
| `SPOOKED` | SKITTISH | Flees immediately on detection, fast scatter |
| `STALKER` | CURIOUS | Approaches slowly, stops at threshold, circles |
| `HUNTER` | PREDATORY | Charges if player enters range |
| `DRIFTER` | AMBIENT | NOPED floaters/undulators, pure idle animation |
| `SWARM` | PASSIVE | Small creatures, flocking rules active |

---

## System Architecture

```
ECS World
├── CreatureSpawnSystem       — reads SpawnConfig, creates creature entities
├── CreatureGeneratorSystem   — builds skeleton + skinned mesh from CreatureParams
├── CreatureAnimSystem        — procedural animation: gait, IK, idle oscillators
├── CreatureBehaviourSystem   — FSM: IDLE → AWARE → FLEE/CHASE/CIRCLE
├── CreatureFlockSystem       — separation/alignment/cohesion for SWARM type
└── CreatureTerrainSystem     — foot planting on heightmap, body tilt to slope
```

### New Components

```typescript
// Core creature data
class CreatureComponent extends Component {
  static schema = {
    params:    { type: 'object', default: null }, // CreatureParams
    skeleton:  { type: 'object', default: null }, // bone array
    meshBuilt: { type: 'boolean', default: false },
  }
}

// Behavioural state machine
class CreatureFSMComponent extends Component {
  static schema = {
    state:        { type: 'string', default: 'IDLE' }, // IDLE | AWARE | FLEE | CHASE | CIRCLE
    prevState:    { type: 'string', default: 'IDLE' },
    stateTimer:   { type: 'float',  default: 0 },
    targetPos:    { type: 'object', default: null },   // THREE.Vector3
    alertLevel:   { type: 'float',  default: 0 },      // 0–1, decays when player leaves
  }
}

// Animation state
class CreatureAnimComponent extends Component {
  static schema = {
    phase:        { type: 'float', default: 0 },  // gait cycle phase 0–2π
    speed:        { type: 'float', default: 0 },  // current movement speed
    footTargets:  { type: 'object', default: null }, // IK target Vector3[] per limb
    footPhases:   { type: 'object', default: null }, // phase offset per limb
  }
}

// Flocking (SWARM only)
class FlockMemberComponent extends Component {
  static schema = {
    flockId:    { type: 'string', default: '' },
    velocity:   { type: 'object', default: null }, // THREE.Vector3
  }
}
```

---

## Generation Pipeline

### Step 1 — Seeded RNG
Use a simple `mulberry32` seeded RNG so the same seed always produces the same creature:

```typescript
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
```

All `CreatureParams` values are derived from calls to this RNG after the seed is set.

### Step 2 — Skeleton Construction

Build a flat bone array. Each bone has `{ start, end, radius, parent }` in local space:

```
QUADRUPED skeleton build order:
1. Spine chain        (spineSegments bones along Z axis, sinusoidal Y offset)
2. Neck chain         (neckLength bones from front of spine, angled up)
3. Head bone          (single bone at neck tip)
4. Tail chain         (tailSegments bones from rear of spine)
5. ×4 Limb chains     (upper → lower → foot, parented to spine at limb attach points)

BIPED:
1. Spine chain        (more vertical, forward-lean controlled by param)
2. Neck + Head
3. ×2 Leg chains      (digitigrade or plantigrade based on param)
4. ×2 Arm chains      (or wing geometry)
5. Tail (optional)

NOPED — UNDULATOR:
1. Body chain         (10–20 segments along primary axis, all driven by sine wave)

NOPED — FLOATER:
1. Bell body          (radial geometry, no bones — pure vertex animation)

NOPED — ROLLER:
1. Single body bone   (sphere-ish hull, rotates with movement direction)
```

### Step 3 — Tube Geometry

For each bone, generate a low-poly extruded tube using `THREE.TubeGeometry` or a manual `BufferGeometry` pass:
- Cross-section is an N-gon where N = `bodySegments` (3 = triangle, 4 = diamond, 6 = hex, 8 = round-ish)
- Radius tapers along the bone (fatter at root, thinner at tip) via a bezier taper curve
- Head gets a scaled, pinched version of the body cross-section

### Step 4 — Vertex Colouring

After geometry is built, apply per-vertex colour based on `patternType`:

```typescript
// 'noise' pattern — simplex noise in 3D space
vertexColor = mix(skinColorA, skinColorB,
  smoothstep(0.3, 0.7, simplex3(pos.x * patternScale,
                                 pos.y * patternScale,
                                 pos.z * patternScale)))

// 'stripe' — based on vertex Y position
// 'spot'   — noise with sharper threshold
// 'iridescent' — colour shift based on view angle (normal dot camera)
```

Use `THREE.BufferAttribute` for `color` and set `vertexColors: true` on the material.

### Step 5 — Skinned Mesh Setup

Convert the generated geometry into a `THREE.SkinnedMesh`:
1. Create `THREE.Bone` objects matching the skeleton array
2. Compute skinning weights per vertex — each vertex is weighted to the nearest 1–2 bones by distance
3. Create `THREE.Skeleton` from bones
4. Bind to mesh

For NOPED FLOATER/UNDULATOR — skip skinning, drive vertex positions directly in the animation system each frame via a `Float32Array` morph target or direct buffer mutation.

---

## Animation System (`CreatureAnimSystem`)

Runs every frame. No keyframes — all motion is computed from phase + params.

### Gait (QUADRUPED / BIPED)

```
phase += delta * gaitFrequency * speed

Gait frequency by morphotype:
  QUADRUPED trot:   2.5 Hz
  QUADRUPED gallop: 4.0 Hz  (triggers above speed threshold)
  BIPED walk:       1.8 Hz
  BIPED hop:        1.2 Hz

Foot lift schedule (QUADRUPED trot — diagonal pairs):
  FL + RR lift at phase 0
  FR + RL lift at phase π

Per foot:
  if (liftPhase active):
    footTarget.y = groundY + stepHeight * sin(liftPhase)
    footTarget.xz = body_xz + strideVector * liftFraction
  else:
    footTarget stays planted (IK holds)
```

### IK Solver (FABRIK — 2 iterations sufficient for games)

```typescript
function solveFABRIK(bones: Bone[], target: Vector3, iterations = 2) {
  // Forward pass: reach toward target from tip
  // Backward pass: re-anchor at root
  // 2 iterations gives visually correct result for 2–3 bone chains
}
```

Apply to each limb chain every frame. Update bone quaternions from solved positions.

### Spine Procedural Motion

- **Body bob**: `spine[mid].position.y += sin(phase * 2) * 0.02 * speed`
- **Spine lateral sway**: each vertebra offsets X by `sin(phase + i * 0.4) * swayAmt`
- **Head tracking**: slerp head bone to face `playerPosition` when in AWARE/CIRCLE state, smoothed with `dt * 3`

### Idle Oscillators (all types)

When speed ≈ 0:
- Breathing: slow chest expansion via scale oscillation on mid-spine bones
- Micro-look: random slow head drift on Y and X axes
- Tail idle: sine wave along tail chain

### NOPED Animation

```
UNDULATOR: body[i].position = sin(phase + i * wavelength) * amplitude
FLOATER:   position.y += sin(phase * bobFreq) * bobAmt
           tentacles[i] rotate by sin(phase + i * π/tentacleCount) * spread
ROLLER:    body rotation += velocity.length() * delta
```

---

## Behaviour System (`CreatureBehaviourSystem`)

Runs every frame. Reads player position from `XROriginComponent`.

### FSM Transitions

```
IDLE ──(player enters detectionRadius AND in FOV)──► AWARE
AWARE ──(alertLevel > 0.8, type=SKITTISH/PREDATORY)──► FLEE or CHASE
AWARE ──(player leaves radius)──► IDLE (alertLevel decays)
FLEE ──(player distance > detectionRadius * 2)──► IDLE
CHASE ──(player distance < 1.5m)──► IDLE (attack event)
CIRCLE ──(CURIOUS type, maintains orbit radius)──► IDLE on timer
```

### Per-state logic

**IDLE:**
- If `idleWander`: pick random target within `wanderRadius` every 3–8s, walk toward it
- Graze animation if PASSIVE (head bobs down periodically)

**AWARE:**
- Face player (head + upper spine turn)
- alertLevel += dt * 2; alertLevel decays at dt * 0.5 when player out of range
- Posture shift: raise head, stiffen spine

**FLEE:**
- Velocity = normalize(pos - playerPos) * fleeSpeed
- Scatter: add random perpendicular component (prevents all creatures running same direction)
- Trigger gallop/fast-gait animation speed

**CHASE:**
- Velocity = normalize(playerPos - pos) * chaseSpeed
- Trigger fast-gait

**CIRCLE (CURIOUS):**
- Maintain orbit at `detectionRadius * 0.6`
- Orbit angular velocity = 0.5 rad/s
- Head always faces player

---

## Terrain Integration (`CreatureTerrainSystem`)

Samples the heightmap to keep creatures on the ground and tilt their body to slopes.

```typescript
// Sample heightmap at creature world position
const groundY = sampleHeightmap(heightmapData, creature.position.x, creature.position.z)

// Sink feet to ground
creature.position.y = groundY + creatureParams.bodyHeight * 0.5

// Tilt body to terrain slope
const normal = sampleTerrainNormal(heightmapData, creature.position.x, creature.position.z)
creature.quaternion.setFromUnitVectors(UP, normal) // blended with dt * 5
```

NOPED FLOATERS ignore terrain — they hover at `groundY + floatHeight`.

---

## Spawn Control UI

A floating panel (or DOM overlay matching the existing PlanetGen sidebar style) with the following controls:

### Spawn Panel

```
┌─────────────────────────────────┐
│  CREATURE SPAWNER               │
│                                 │
│  Morphotype  [QUAD] [BIPED] [NO]│
│  Behaviour   [GRAZER ▼]         │
│  Count       ──●──── 12         │
│  Spread (m)  ──●──── 80         │
│  Seed        [ 42069      ] [🎲] │
│                                 │
│  [SPAWN BATCH]  [CLEAR ALL]     │
│                                 │
│  Quick Presets:                 │
│  [Grazing Herd] [Spooked Flock] │
│  [Apex Hunters] [Drifter Cloud] │
│  [Mixed Biome]                  │
└─────────────────────────────────┘
```

### Controls spec

| Control | Type | Range | Effect |
|---------|------|-------|--------|
| Morphotype | Toggle group | QUAD / BIPED / NOPED / RANDOM | Locks or randomises structural type |
| Behaviour | Dropdown | All BehaviourProfile presets | Sets FSM profile for batch |
| Count | Slider | 1–50 | Number of creatures to spawn |
| Spread | Slider | 10–200m | Radius around player to scatter spawn points |
| Seed | Number input | any int | Base seed (each creature gets seed+i) |
| 🎲 | Button | — | Randomises seed |
| SPAWN BATCH | Button | — | Triggers `CreatureSpawnSystem` with current config |
| CLEAR ALL | Button | — | Destroys all creature entities, disposes meshes |

### Quick Presets (hardcoded configs)

```typescript
const PRESETS = {
  'Grazing Herd': {
    morphotype: 'QUADRUPED', behaviour: 'GRAZER', count: 12, spread: 60
  },
  'Spooked Flock': {
    morphotype: 'BIPED', behaviour: 'SPOOKED', count: 20, spread: 40
  },
  'Apex Hunters': {
    morphotype: 'QUADRUPED', behaviour: 'HUNTER', count: 3, spread: 80
  },
  'Drifter Cloud': {
    morphotype: 'NOPED', behaviour: 'DRIFTER', count: 15, spread: 50
  },
  'Mixed Biome': {
    morphotype: 'RANDOM', behaviour: 'RANDOM', count: 25, spread: 100
  },
}
```

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/creatures/CreatureParams.ts` | **Create** — types: `CreatureParams`, `BehaviourProfile`, morphotype enums |
| `src/creatures/CreatureGenerator.ts` | **Create** — skeleton build, tube geometry, vertex colours, skinned mesh setup |
| `src/creatures/rng.ts` | **Create** — `mulberry32` seeded RNG |
| `src/creatures/noise.ts` | **Create** — simplex3 for vertex colour patterns |
| `src/creatures/ik.ts` | **Create** — FABRIK solver, 2-bone fast path |
| `src/ecs/components.ts` | **Modify** — add `CreatureComponent`, `CreatureFSMComponent`, `CreatureAnimComponent`, `FlockMemberComponent` |
| `src/ecs/systems/CreatureSpawnSystem.ts` | **Create** |
| `src/ecs/systems/CreatureGeneratorSystem.ts` | **Create** |
| `src/ecs/systems/CreatureAnimSystem.ts` | **Create** |
| `src/ecs/systems/CreatureBehaviourSystem.ts` | **Create** |
| `src/ecs/systems/CreatureFlockSystem.ts` | **Create** |
| `src/ecs/systems/CreatureTerrainSystem.ts` | **Create** |
| `src/ui/CreatureSpawner.ts` | **Create** — spawn panel DOM component |
| `src/world.ts` | **Modify** — register new components + systems; init spawn panel |

---

## System Registration Order

Add to the existing ECS world init after terrain systems:

```typescript
world.registerComponent(CreatureComponent)
world.registerComponent(CreatureFSMComponent)
world.registerComponent(CreatureAnimComponent)
world.registerComponent(FlockMemberComponent)

world.registerSystem(CreatureSpawnSystem)
world.registerSystem(CreatureGeneratorSystem)
world.registerSystem(CreatureTerrainSystem)
world.registerSystem(CreatureBehaviourSystem)
world.registerSystem(CreatureFlockSystem)
world.registerSystem(CreatureAnimSystem)   // last — reads results of all above
```

---

## Performance Budget

| Operation | Budget |
|-----------|--------|
| Max simultaneous creatures | 50 |
| Max bones per creature | 32 |
| Target geometry per creature | < 800 triangles |
| IK solves per frame | creatures × limbs × 2 iterations |
| Behaviour FSM | O(n) — fine at 50 |
| Flock steering | O(n²) capped — only within 15m radius |

Use `THREE.InstancedMesh` if spawning SWARM creatures > 30 of identical type. For varied creatures, individual `SkinnedMesh` per entity is fine at ≤ 50.

---

## Definition of Done

- [ ] `pnpm build` passes with no TypeScript errors
- [ ] QUADRUPED creature generates, has visible 4-limb skeleton, walks with trot gait
- [ ] BIPED creature generates, walks upright or theropod-lean
- [ ] NOPED UNDULATOR generates and undulates without limbs
- [ ] NOPED FLOATER generates and bobs in air above terrain
- [ ] IK foot planting — feet stay on ground as body moves over uneven terrain
- [ ] Spine and tail animate procedurally during movement
- [ ] PASSIVE creature wanders, ignores player
- [ ] SKITTISH creature flees when player approaches
- [ ] CURIOUS creature circles player
- [ ] PREDATORY creature charges
- [ ] Spawn panel renders in sidebar, all controls functional
- [ ] SPAWN BATCH produces correct count/spread/morphotype
- [ ] CLEAR ALL removes all creature meshes cleanly (no Three.js memory leak)
- [ ] Quick presets all produce correct creature configs
- [ ] Same seed always produces visually identical creature
- [ ] 50 creatures maintain > 30fps on a mid-range laptop
