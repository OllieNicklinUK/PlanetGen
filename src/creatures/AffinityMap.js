/**
 * AffinityMap.js
 * Implements the V3 steering and emergent behavior system based on object tags.
 */

import * as THREE from 'three';

export const AFFINITY_TYPE = Object.freeze({
    PLAYER:         'PLAYER',
    PLANT:          'PLANT',
    WATER:          'WATER',
    FOOD:           'FOOD',
    PLAYER_THREAT:  'PLAYER_THREAT',
    SAME_SPECIES:   'SAME_SPECIES',
    LIGHT:          'LIGHT',
    WARMTH:         'WARMTH',
    ELEVATION:      'ELEVATION',
    SOUND:          'SOUND'
});

/**
 * Normalizes desire vectors based on proximity and affinity weights.
 */
export class AffinityMap {
    constructor() {
        this.weights = {
            [AFFINITY_TYPE.PLAYER]:        0.2,
            [AFFINITY_TYPE.PLANT]:         0.6,
            [AFFINITY_TYPE.WATER]:         0.3,
            [AFFINITY_TYPE.PLAYER_THREAT]: -0.5,
            [AFFINITY_TYPE.SAME_SPECIES]:  0.4,
            [AFFINITY_TYPE.LIGHT]:         0.1,
            [AFFINITY_TYPE.WARMTH]:        0.1,
            [AFFINITY_TYPE.ELEVATION]:     0.0,
            [AFFINITY_TYPE.SOUND]:        -0.2
        };
        
        this.ranges = {
            [AFFINITY_TYPE.PLAYER]:        20,
            [AFFINITY_TYPE.PLANT]:         25,
            [AFFINITY_TYPE.WATER]:         40,
            [AFFINITY_TYPE.PLAYER_THREAT]: 15,
            [AFFINITY_TYPE.SAME_SPECIES]:  30,
            [AFFINITY_TYPE.LIGHT]:         50,
            [AFFINITY_TYPE.WARMTH]:        30,
            [AFFINITY_TYPE.ELEVATION]:     100,
            [AFFINITY_TYPE.SOUND]:         60
        };
    }

    /**
     * Calculates a cumulative desire vector for a creature.
     * @param {THREE.Object3D} creatureObj - Current creature
     * @param {Array} nearbyObjects - Objects with { pos: THREE.Vector3, tag: AFFINITY_TYPE }
     * @param {number} globalRadius - Max search radius
     * @returns {THREE.Vector3} Desire vector (direction + strength)
     */
    computeDesireVector(creatureObj, nearbyObjects, globalRadius = 30) {
        const cumulativeVector = new THREE.Vector3(0, 0, 0);
        const creaturePos = creatureObj.position;

        for (const obj of nearbyObjects) {
            const weight = this.weights[obj.tag] || 0;
            const range  = Math.min(globalRadius, this.ranges[obj.tag] || 20);
            
            const diff = new THREE.Vector3().subVectors(obj.pos, creaturePos);
            const dist = diff.length();

            if (dist < range && dist > 0.01) {
                // Strength falls off with distance: closer = stronger
                const distFactor = 1.0 - (dist / range);
                const strength = weight * distFactor;
                
                // Direction to/from object
                const dir = diff.normalize();
                cumulativeVector.addScaledVector(dir, strength);
            }
        }

        return cumulativeVector;
    }
}

/**
 * Generates a randomized affinity weight set for a unique species behavior,
 * influenced by a biome recipe's base seeds.
 */
export function generateAffinityMap(rng, seeds = {}) {
    const map = new AffinityMap();
    
    for (const key of Object.keys(map.weights)) {
        const seed = seeds[key] || map.weights[key];
        // Perturb by ±0.3, clamp to [-1, 1]
        map.weights[key] = Math.max(-1, Math.min(1, seed + (rng() - 0.5) * 0.6));
    }
    
    return map;
}
