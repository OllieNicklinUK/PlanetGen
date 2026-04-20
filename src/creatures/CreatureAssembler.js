import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from './parts/parts-manifest.json' assert { type: 'json' };

export class CreatureAssembler {
    constructor() {
        this._partCache = new Map();
        this._manifest = manifest;
        this._loader = new GLTFLoader();
        // Path to parts directory from the root/public perspective
        this._basePath = './creatures/parts/';
    }

    /**
     * Attaches procedural parts to the creature based on parameters and biome.
     * @param {THREE.Group} group - The creature group
     * @param {THREE.Skeleton} skeleton - The bone system
     * @param {object} params - Creature params
     * @param {string} biomeTag - BIOME_TAG string
     * @param {function} rng - Seeded RNG
     */
    async assembleParts(group, skeleton, params, biomeTag, rng) {
        // 1. Select and attach Head
        const validHeads = this._filterParts(this._manifest.heads, params.morphotype, biomeTag);
        const selectedHead = this._weightedPick(validHeads, rng);
        if (selectedHead) {
            const headBone = skeleton.bones.find(b => b.name === 'head');
            if (headBone) {
                const headPart = await this._loadPart(selectedHead, params, rng);
                headPart.scale.multiplyScalar(params.headScale);
                headBone.add(headPart);
            }
        }

        // 2. Select and attach Tail
        const validTails = this._filterParts(this._manifest.tails, params.morphotype, biomeTag);
        const selectedTail = this._weightedPick(validTails, rng);
        if (selectedTail) {
            const tailBone = skeleton.bones.find(b => b.name.includes('tail')) || skeleton.bones[skeleton.bones.length - 1];
            if (tailBone) {
                const tailPart = await this._loadPart(selectedTail, params, rng);
                tailBone.add(tailPart);
            }
        }

        // 3. Limb Endings (one for each foot)
        const validLimbs = this._filterParts(this._manifest.limbEndings, params.morphotype, biomeTag);
        const selectedLimb = this._weightedPick(validLimbs, rng);
        if (selectedLimb) {
            const feet = skeleton.bones.filter(b => b.name.includes('foot'));
            for (const foot of feet) {
                const footPart = await this._loadPart(selectedLimb, params, rng);
                // Scale foot to fit
                footPart.scale.setScalar(params.footSize * 2.0);
                foot.add(footPart);
            }
        }

        // 4. Accessories (0 - 3)
        const validAcc = this._filterParts(this._manifest.accessories, params.morphotype, biomeTag);
        const accCount = Math.floor(rng() * 4);
        const spineBones = skeleton.bones.filter(b => b.name.includes('spine'));
        
        for (let i = 0; i < accCount; i++) {
            const selectedAcc = this._weightedPick(validAcc, rng);
            if (selectedAcc && spineBones.length > 0) {
                const randomSpine = spineBones[Math.floor(rng() * spineBones.length)];
                const accPart = await this._loadPart(selectedAcc, params, rng);
                
                // Randomize position on spine
                accPart.position.set((rng() - 0.5) * 0.1, 0.1, (rng() - 0.5) * 0.05);
                randomSpine.add(accPart);
            }
        }

        // 5. Eyes (Always add high-fidelity eyes)
        const headBone = skeleton.bones.find(b => b.name === 'head');
        if (headBone) {
            const eyeL = this._createEye(params);
            const eyeR = eyeL.clone();
            eyeL.position.set(0.12, 0.05, 0.1);
            eyeR.position.set(-0.12, 0.05, 0.1);
            headBone.add(eyeL, eyeR);
        }
    }

    _filterParts(pool, morphotype, biomeTag) {
        return pool.filter(p => 
            (p.compatibleMorphotypes.includes(morphotype) || p.compatibleMorphotypes.includes('ANY')) &&
            (p.biomeAffinity.includes(biomeTag) || p.biomeAffinity.includes('ANY'))
        );
    }

    _weightedPick(pool, rng) {
        if (!pool || pool.length === 0) return null;
        let total = pool.reduce((sum, p) => sum + (p.weight || 1), 0);
        let r = rng() * total;
        let current = 0;
        for (const p of pool) {
            current += (p.weight || 1);
            if (r <= current) return p;
        }
        return pool[0];
    }

    async _loadPart(desc, params, rng) {
        let part;
        
        // 1. Check Cache
        if (this._partCache.has(desc.id)) {
            part = this._partCache.get(desc.id).clone();
        } else {
            // 2. Try loading from GLB
            try {
                const url = this._basePath + desc.file;
                const gltf = await this._loader.loadAsync(url);
                part = gltf.scene;
                this._partCache.set(desc.id, part);
                part = part.clone();
            } catch (err) {
                console.warn(`CreatureAssembler: Failed to load part ${desc.id} at ${desc.file}. Falling back to procedural.`, err);
                part = this._createProceduralFallback(desc.id, params, rng);
            }
        }
        
        // 3. Apply tinting and properties
        part.traverse(obj => {
            if (obj.isMesh) {
                obj.material = obj.material.clone();
                // Blend original color with skin color
                obj.material.color.lerp(new THREE.Color(params.skinColorA), 0.3);
                obj.material.roughness = params.roughness;
                obj.material.metalness = params.metalness;
            }
        });

        return part;
    }

    _createProceduralFallback(id, params, rng) {
        let geo;
        let color = params.skinColorA;

        if (id.includes('head_blunt')) {
            geo = new THREE.SphereGeometry(0.2, 8, 8);
            geo.scale(1, 0.8, 1.2);
        } else if (id.includes('head_elongated')) {
            geo = new THREE.ConeGeometry(0.15, 0.5, 8);
            geo.rotateX(Math.PI / 2);
        } else if (id.includes('head_wide')) {
            geo = new THREE.BoxGeometry(0.4, 0.15, 0.3);
        } else if (id.includes('tail_fin')) {
            geo = new THREE.TorusGeometry(0.15, 0.02, 4, 8);
            geo.scale(0.2, 1, 1);
        } else if (id.includes('horn')) {
            geo = new THREE.ConeGeometry(0.05, 0.3, 4);
            geo.rotateX(-Math.PI / 4);
            color = params.skinColorB;
        } else if (id.includes('frill')) {
            geo = new THREE.TorusGeometry(0.25, 0.03, 3, 12, Math.PI);
            geo.rotateX(Math.PI / 2);
        } else {
            geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        }

        const mat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: params.roughness,
            metalness: params.metalness
        });

        return new THREE.Mesh(geo, mat);
    }

    _createEye(params) {
        const geo = new THREE.SphereGeometry(0.04, 8, 8);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x000000,
            roughness: 0.1,
            metalness: 0.9
        });
        const mesh = new THREE.Mesh(geo, mat);
        
        // Add a small white "highlight" sphere
        const highlightGeo = new THREE.SphereGeometry(0.015, 4, 4);
        const highlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff });
        const highlight = new THREE.Mesh(highlightGeo, highlightMat);
        highlight.position.set(0.02, 0.02, 0.02);
        mesh.add(highlight);
        
        return mesh;
    }
}
