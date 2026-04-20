// CreatureParams.js — parameter schema, morphotype enums, behaviour presets,
// and the makeCreatureParams factory that derives all values from a seeded RNG.

import { makeRNG, rngRange, rngInt, rngPick } from './rng.js';
import * as THREE from 'three';
import { generateAffinityMap } from './AffinityMap.js';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const MORPHOTYPE = Object.freeze({
  QUADRUPED: 'QUADRUPED',
  BIPED:     'BIPED',
  NOPED:     'NOPED',
});

export const NOPED_SUBTYPE = Object.freeze({
  FLOATER:   'FLOATER',
  UNDULATOR: 'UNDULATOR',
  ROLLER:    'ROLLER',
  RADIAL:    'RADIAL',
});

export const BEHAVIOUR_TYPE = Object.freeze({
  PASSIVE:   'PASSIVE',
  SKITTISH:  'SKITTISH',
  CURIOUS:   'CURIOUS',
  PREDATORY: 'PREDATORY',
  AMBIENT:   'AMBIENT',
});

export const SURFACE_TYPE = Object.freeze({
  SKIN:   'SKIN',
  FUR:    'FUR',
  SCALES: 'SCALES',
  SLIME:  'SLIME',
});

export const FSM_STATE = Object.freeze({
  IDLE:   'IDLE',
  AWARE:  'AWARE',
  FLEE:   'FLEE',
  CHASE:  'CHASE',
  CIRCLE: 'CIRCLE',
});

// ── Behaviour presets ─────────────────────────────────────────────────────────

export const BEHAVIOUR_PRESETS = {
  GRAZER: {
    name: 'GRAZER',
    type: BEHAVIOUR_TYPE.PASSIVE,
    detectionRadius: 18,
    fovAngle: 240,
    fleeSpeed: 4,
    chaseSpeed: 0,
    idleWander: true,
    wanderRadius: 40,
    reactionDelay: 1.5,
    idleAnimSpeed: 0.7,
  },
  SPOOKED: {
    name: 'SPOOKED',
    type: BEHAVIOUR_TYPE.SKITTISH,
    detectionRadius: 25,
    fovAngle: 300,
    fleeSpeed: 9,
    chaseSpeed: 0,
    idleWander: true,
    wanderRadius: 30,
    reactionDelay: 0.1,
    idleAnimSpeed: 1.2,
  },
  STALKER: {
    name: 'STALKER',
    type: BEHAVIOUR_TYPE.CURIOUS,
    detectionRadius: 30,
    fovAngle: 200,
    fleeSpeed: 3,
    chaseSpeed: 4,
    idleWander: false,
    wanderRadius: 20,
    reactionDelay: 0.8,
    idleAnimSpeed: 0.8,
  },
  HUNTER: {
    name: 'HUNTER',
    type: BEHAVIOUR_TYPE.PREDATORY,
    detectionRadius: 35,
    fovAngle: 180,
    fleeSpeed: 0,
    chaseSpeed: 11,
    idleWander: true,
    wanderRadius: 60,
    reactionDelay: 0.3,
    idleAnimSpeed: 0.9,
  },
  DRIFTER: {
    name: 'DRIFTER',
    type: BEHAVIOUR_TYPE.AMBIENT,
    detectionRadius: 0,
    fovAngle: 0,
    fleeSpeed: 0,
    chaseSpeed: 0,
    idleWander: false,
    wanderRadius: 0,
    reactionDelay: 0,
    idleAnimSpeed: 1.0,
  },
  SWARM: {
    name: 'SWARM',
    type: BEHAVIOUR_TYPE.PASSIVE,
    detectionRadius: 12,
    fovAngle: 320,
    fleeSpeed: 6,
    chaseSpeed: 0,
    idleWander: true,
    wanderRadius: 25,
    reactionDelay: 0.2,
    idleAnimSpeed: 1.5,
  },
};

export const PRESET_NAMES = Object.keys(BEHAVIOUR_PRESETS);

// ── Colour palettes ───────────────────────────────────────────────────────────
// Curated low-poly creature palette pairs [primary, secondary]
const COLOUR_PALETTES = [
  ['#5a8a44', '#203a15'],  // forest green
  ['#8b5e3c', '#3d2210'],  // earthy brown
  ['#4a7fa5', '#1a3d55'],  // ocean blue
  ['#b0a060', '#5a4f20'],  // sandy gold
  ['#9a4060', '#3d1525'],  // deep crimson
  ['#60a0b0', '#204555'],  // arctic teal
  ['#c87820', '#5a3408'],  // amber
  ['#805090', '#30183a'],  // violet
  ['#40b870', '#155530'],  // jade
  ['#c0784a', '#5a3018'],  // terracotta
];

const PATTERN_TYPES = ['solid', 'stripe', 'spot', 'noise', 'iridescent'];

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Derive all CreatureParams from a seed + morphotype + behaviour preset.
 * Same seed always produces the same params object.
 *
 * @param {number} seed
 * @param {string} morphotype  MORPHOTYPE.*
 * @param {string} behaviourPreset  Key of BEHAVIOUR_PRESETS ('GRAZER', etc.)
 * @param {object} [overrides]  Override any derived values
 * @returns {CreatureParams}
 */
export function makeCreatureParams(seed, morphotype, behaviourPreset, overrides = {}) {
  const rng = makeRNG(seed);

  const palette = COLOUR_PALETTES[Math.floor(rng() * COLOUR_PALETTES.length)];
  const skinColorA = new THREE.Color(palette[0]);
  const skinColorB = new THREE.Color(palette[1]);

  // For NOPED, pick a subtype
  let subtype = null;
  if (morphotype === MORPHOTYPE.NOPED) {
    subtype = rngPick(rng, [
      NOPED_SUBTYPE.FLOATER,
      NOPED_SUBTYPE.UNDULATOR,
      NOPED_SUBTYPE.ROLLER,
      NOPED_SUBTYPE.UNDULATOR, // weighted toward undulator
    ]);
  }

  // Body proportions — scale inversely with bodySegments for visual balance
  const bodyLength  = rngRange(rng, 0.8, 3.5);
  const bodyWidth   = rngRange(rng, 0.2, 1.0);
  const bodyHeight  = rngRange(rng, 0.3, 1.0);
  const bodySegs    = rngInt(rng, 10, 14); // V2: drives spline ring count

  // Surface types
  const surfaceType = rngPick(rng, Object.values(SURFACE_TYPE));

  // Limbs only for legged morphotypes
  const hasLimbs    = morphotype !== MORPHOTYPE.NOPED;
  const digitigrade = rng() > 0.5;

  const params = {
    seed,
    morphotype,
    subtype,

    // Body
    bodyLength,
    bodyWidth,
    bodyHeight,
    neckLength:    morphotype === MORPHOTYPE.NOPED ? 0 : rngRange(rng, 0.1, 1.2),
    headScale:     morphotype === MORPHOTYPE.NOPED ? 0 : rngRange(rng, 0.35, 0.9),
    tailLength:    morphotype === MORPHOTYPE.BIPED ? rngRange(rng, 0, 1.5) : rngRange(rng, 0, 2.5),
    tailSegments:  rngInt(rng, 3, 10),

    // Limbs
    limbCount:     morphotype === MORPHOTYPE.BIPED ? 2 : 4,
    limbLength:    hasLimbs ? rngRange(rng, 0.5, 2.0) : 0,
    limbWidth:     hasLimbs ? rngRange(rng, 0.06, 0.22) : 0,
    footSize:      hasLimbs ? rngRange(rng, 0.06, 0.28) : 0,
    digitigrade,

    // Geometry
    bodySegments:  bodySegs,
    spineSegments: rngInt(rng, 6, 12),
    tubeDetail:    rngInt(rng, 4, 8),

    // Surface
    surfaceType,
    skinColorA,
    skinColorB,
    patternType:   rngPick(rng, PATTERN_TYPES),
    patternScale:  rngRange(rng, 0.4, 2.0),
    roughness:     surfaceType === SURFACE_TYPE.SLIME ? 0.1 : rngRange(rng, 0.4, 0.8),
    metalness:     surfaceType === SURFACE_TYPE.FUR || surfaceType === SURFACE_TYPE.SKIN ? 0.0 : rngRange(rng, 0, 0.3),

    // Behaviour
    behaviour: BEHAVIOUR_PRESETS[behaviourPreset] || BEHAVIOUR_PRESETS.GRAZER,

    // World scale
    scale: rngRange(rng, 0.6, 1.8),

    // V3: Emergent AI
    affinityMap: generateAffinityMap(rng),
  };

  // NOPED special overrides
  if (morphotype === MORPHOTYPE.NOPED && subtype === NOPED_SUBTYPE.FLOATER) {
    params.floatHeight = rngRange(rng, 1.5, 6.0);
    params.tentacleCount = rngInt(rng, 4, 12);
  }
  if (morphotype === MORPHOTYPE.NOPED && subtype === NOPED_SUBTYPE.UNDULATOR) {
    params.undulatorSegments = rngInt(rng, 8, 18);
    params.undulatorWavelength = rngRange(rng, 0.4, 0.9);
    params.undulatorAmplitude  = rngRange(rng, 0.3, 0.9);
  }

  return Object.assign(params, overrides);
}

// ── Quick Preset Batch Configs ────────────────────────────────────────────────

export const SPAWN_PRESETS = {
  'Grazing Herd': {
    morphotype: MORPHOTYPE.QUADRUPED,
    behaviourPreset: 'GRAZER',
    count: 12,
    spread: 60,
    tags: ['TEMPERATE']
  },
  'Apex Hunters': {
    morphotype: 'RANDOM',
    behaviourPreset: 'HUNTER',
    count: 3,
    spread: 80,
    tags: ['ANY']
  },
  'Toxic Swarm': {
    morphotype: MORPHOTYPE.NOPED,
    behaviourPreset: 'DRIFTER',
    count: 20,
    spread: 30,
    tags: ['TOXIC']
  },
  'Arctic Pack': {
    morphotype: MORPHOTYPE.QUADRUPED,
    behaviourPreset: 'PASSIVE',
    count: 6,
    spread: 50,
    tags: ['ARCTIC']
  },
  'Drifter Cloud': {
    morphotype: MORPHOTYPE.NOPED,
    behaviourPreset: 'AMBIENT',
    count: 15,
    spread: 50,
    tags: ['ANY']
  },
  'Mixed Biome': {
    morphotype: 'RANDOM',
    behaviourPreset: 'RANDOM',
    count: 25,
    spread: 100,
    tags: ['ANY']
  },
};
