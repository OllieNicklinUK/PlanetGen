/**
 * BiomeRecipe.js
 * Defines the mapping between world terrain and creature generation parameters.
 */

import { getBiome, BIOME } from '../noise.js';
import { MORPHOTYPE, SURFACE_TYPE } from './CreatureParams.js';

export const BIOME_TAG = Object.freeze({
    TEMPERATE: 'TEMPERATE',
    ARID:      'ARID',
    ARCTIC:    'ARCTIC',
    TOXIC:     'TOXIC',
    LUSH:      'LUSH',
    AQUATIC:   'AQUATIC',
    VOLCANIC:  'VOLCANIC'
});

export const BIOME_RECIPES = {
    [BIOME_TAG.TEMPERATE]: {
        morphotypes: [MORPHOTYPE.QUADRUPED, MORPHOTYPE.BIPED, MORPHOTYPE.NOPED],
        colourPalette: { hue: [60, 160], sat: [0.2, 0.7], light: [0.3, 0.7] },
        affinitySeeds: { PLANT: 0.6, WATER: 0.3, PLAYER_THREAT: -0.2 },
        scaleRange: [0.8, 1.8],
        speedMult: 1.0,
        rarity: 1.0
    },
    [BIOME_TAG.ARID]: {
        morphotypes: [MORPHOTYPE.QUADRUPED, MORPHOTYPE.NOPED],
        colourPalette: { hue: [20, 55], sat: [0.1, 0.5], light: [0.5, 0.8] },
        affinitySeeds: { PLANT: 0.2, WATER: 0.9, PLAYER_THREAT: 0.1, WARMTH: 0.4 },
        scaleRange: [0.5, 3.5],
        speedMult: 1.2,
        rarity: 0.8
    },
    [BIOME_TAG.ARCTIC]: {
        morphotypes: [MORPHOTYPE.QUADRUPED],
        colourPalette: { hue: [180, 240], sat: [0.0, 0.3], light: [0.6, 0.95] },
        affinitySeeds: { WARMTH: 0.8, PLAYER_THREAT: -0.1, SAME_SPECIES: 0.7 },
        scaleRange: [1.2, 4.0],
        speedMult: 0.8,
        rarity: 0.5
    },
    [BIOME_TAG.TOXIC]: {
        morphotypes: [MORPHOTYPE.NOPED, MORPHOTYPE.BIPED],
        colourPalette: { hue: [260, 320], sat: [0.4, 0.9], light: [0.2, 0.5] },
        affinitySeeds: { PLAYER_THREAT: 0.7, PLANT: 0.1, LIGHT: -0.5 },
        scaleRange: [0.4, 1.5],
        speedMult: 1.4,
        rarity: 0.6
    },
    [BIOME_TAG.LUSH]: {
        morphotypes: [MORPHOTYPE.QUADRUPED, MORPHOTYPE.BIPED, MORPHOTYPE.NOPED],
        colourPalette: { hue: [80, 180], sat: [0.4, 1.0], light: [0.2, 0.6] },
        affinitySeeds: { PLANT: 0.8, PLAYER_THREAT: 0.3, SAME_SPECIES: 0.5 },
        scaleRange: [0.2, 2.5],
        speedMult: 1.1,
        rarity: 1.2
    },
    [BIOME_TAG.AQUATIC]: {
        morphotypes: [MORPHOTYPE.NOPED, MORPHOTYPE.QUADRUPED],
        colourPalette: { hue: [180, 260], sat: [0.3, 0.9], light: [0.2, 0.7] },
        affinitySeeds: { WATER: 1.0, PLAYER_THREAT: -0.2 },
        scaleRange: [0.5, 5.0],
        speedMult: 0.9,
        rarity: 0.8
    },
    [BIOME_TAG.VOLCANIC]: {
        morphotypes: [MORPHOTYPE.QUADRUPED, MORPHOTYPE.NOPED],
        colourPalette: { hue: [0, 35], sat: [0.5, 1.0], light: [0.2, 0.5] },
        affinitySeeds: { PLAYER_THREAT: 0.5, WARMTH: -0.3 },
        scaleRange: [1.0, 5.0],
        speedMult: 0.7,
        rarity: 0.4
    }
};

/**
 * Maps noise-based BIOME index to a V3 BIOME_TAG.
 */
export function getBiomeTagAt(x, z) {
    const biome = getBiome(x, z);
    switch (biome) {
        case BIOME.GRASS: return BIOME_TAG.TEMPERATE;
        case BIOME.SAND:  return BIOME_TAG.ARID;
        case BIOME.DUST:  return BIOME_TAG.TOXIC;
        case BIOME.ROCK:  return BIOME_TAG.VOLCANIC; 
        case BIOME.CLIFF: return BIOME_TAG.ARCTIC;
        case BIOME.WATER: return BIOME_TAG.AQUATIC;
        default:          return BIOME_TAG.TEMPERATE;
    }
}
