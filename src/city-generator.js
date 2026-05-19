// Procedural City Generator — from viverse-city-world
// Generates buildings, roads, and infrastructure within terrain chunks

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SeededRNG, getTerrainHeight, isCityZone } from './noise.js';
import { MAT } from './materials.js';

function scaleBoxUVs(geo, w, h, d, scaleW, scaleH) {
  const uv = geo.getAttribute('uv');
  if (!uv || uv.count !== 24) return;
  const scW = w / scaleW;
  const scH = h / scaleH;
  const scD = d / scaleW;
  for (let i=0; i<4; i++) uv.setXY(i,    uv.getX(i)*scD, uv.getY(i)*scH); // 0: Right
  for (let i=0; i<4; i++) uv.setXY(4+i,  uv.getX(4+i)*scD, uv.getY(4+i)*scH); // 1: Left
  for (let i=0; i<4; i++) uv.setXY(8+i,  uv.getX(8+i)*scW, uv.getY(8+i)*scD); // 2: Top
  for (let i=0; i<4; i++) uv.setXY(12+i, uv.getX(12+i)*scW, uv.getY(12+i)*scD); // 3: Bottom
  for (let i=0; i<4; i++) uv.setXY(16+i, uv.getX(16+i)*scW, uv.getY(16+i)*scH); // 4: Front
  for (let i=0; i<4; i++) uv.setXY(20+i, uv.getX(20+i)*scW, uv.getY(20+i)*scH); // 5: Back
}

export const CITY_CONFIG = {
  blockSize: 48,        // Grid cell size in world units
  roadWidth: 10,        // Road width
  pavWidth: 3,          // Pavement/sidewalk width
  buildingMinH: 10,     // Minimum building height
  buildingMaxH: 110,    // Maximum height multiplier (centre-biased)
  buildingBaseH: 35,    // Added to max height at city edges
};

// ── Road / pavement terrain-conforming helpers ────────────────────────────────
// Each road section is a ribbon mesh whose vertices are sampled from the terrain
// height function — no more flat slabs floating above or below the ground.

const ROAD_STEPS = 8;    // vertex columns along each road strip
const PAV_STEPS  = 4;    // vertex columns/rows for pavement grid
const ROAD_RAISE = 0.5;  // metres above terrain surface
const PAV_RAISE  = 0.55; // pavement sits slightly higher than road

/**
 * Build a terrain-following ribbon strip.
 *   axis 'x': strip runs in local-X, width spans local-Z.
 *   axis 'z': strip runs in local-Z, width spans local-X.
 *   along0/along1: start/end along the running axis (local coords).
 *   across: centre of the strip along the cross axis (local coord).
 */
function buildRoadRibbon(axis, along0, along1, across, width, cx, cz, chunkSize, steps) {
  const verts = [], uvs = [], idxs = [];
  for (let i = 0; i <= steps; i++) {
    const t     = i / steps;
    const along = along0 + t * (along1 - along0);
    const lx    = axis === 'x' ? along : across;
    const lz    = axis === 'x' ? across : along;
    const h     = getTerrainHeight(lx + cx * chunkSize, lz + cz * chunkSize) + ROAD_RAISE;
    axis === 'x'
      ? verts.push(lx, h, lz - width / 2,  lx, h, lz + width / 2)
      : verts.push(lx - width / 2, h, lz,  lx + width / 2, h, lz);
    uvs.push(t, 0,  t, 1);
    if (i > 0) {
      const b = (i - 1) * 2;
      idxs.push(b, b + 2, b + 1,  b + 1, b + 2, b + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,   2));
  geo.setIndex(idxs);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a terrain-following grid quad (pavement, intersections).
 * Centred at local (lxC, lzC) / world (wxC, wzC).
 */
function buildTerrainGrid(lxC, lzC, wxC, wzC, sizeX, sizeZ, stepsX, stepsZ, raise) {
  const verts = [], uvs = [], idxs = [];
  const Nx = stepsX + 1, Nz = stepsZ + 1;
  for (let iz = 0; iz < Nz; iz++) {
    const tz = iz / stepsZ;
    const lz = lzC - sizeZ / 2 + tz * sizeZ;
    const wz = wzC - sizeZ / 2 + tz * sizeZ;
    for (let ix = 0; ix < Nx; ix++) {
      const tx = ix / stepsX;
      const lx = lxC - sizeX / 2 + tx * sizeX;
      const wx = wxC - sizeX / 2 + tx * sizeX;
      verts.push(lx, getTerrainHeight(wx, wz) + raise, lz);
      uvs.push(tx, tz);
    }
  }
  for (let iz = 0; iz < stepsZ; iz++) {
    for (let ix = 0; ix < stepsX; ix++) {
      const a = iz * Nx + ix;
      idxs.push(a, a + 1, a + Nx,  a + 1, a + Nx + 1, a + Nx);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,   2));
  geo.setIndex(idxs);
  geo.computeVertexNormals();
  return geo;
}

// ── Building type geometry helpers ───────────────────────────────────────────
// Each helper returns a THREE.BufferGeometry for the building BODY only
// (walls / shaft / base).  Roofs and caps are pushed into batches separately
// so they merge with other detail geometry and don't affect per-building IDs.

/** Octagonal tower shaft, slightly tapered. */
function buildTowerBody(bW, bH, bD) {
  const r0 = Math.min(bW, bD) * 0.38;
  return new THREE.CylinderGeometry(r0 * 0.78, r0, bH, 8, 1);
}

/** Short cylindrical base for a dome — the hemisphere cap goes in batches.roof. */
function buildDomeBase(bW, bD, baseH) {
  const r = Math.min(bW, bD) * 0.48;
  return new THREE.CylinderGeometry(r, r * 1.06, baseH, 16, 1);
}

/** Low-poly octagonal base for a geodesic dome — faceted cap goes in batches.glass. */
function buildGeodesicBase(bW, bD, baseH) {
  const r = Math.min(bW, bD) * 0.46;
  return new THREE.CylinderGeometry(r, r * 1.08, baseH, 8, 1);
}

/** Simple box walls for a house — pyramid roof goes in batches.roof. */
function buildHouseWalls(bW, wallH, bD) {
  const geo = new THREE.BoxGeometry(bW, wallH, bD);
  scaleBoxUVs(geo, bW, wallH, bD, 8, 8); // tighter UV tiling for domestic scale
  return geo;
}

/**
 * Sample the minimum terrain height at the four corners + centre of a building footprint.
 * Using the minimum ensures the building base is always at or below the lowest corner
 * so no part of it floats above the ground on sloped terrain.
 */
function minTerrainUnderFootprint(wx, wz, halfW, halfD) {
  return Math.min(
    getTerrainHeight(wx,         wz),
    getTerrainHeight(wx - halfW, wz - halfD),
    getTerrainHeight(wx + halfW, wz - halfD),
    getTerrainHeight(wx - halfW, wz + halfD),
    getTerrainHeight(wx + halfW, wz + halfD),
  );
}

export function generateCityForChunk(group, cx, cz, chunkSize, seed, currentMode, lod) {
  const { blockSize: BLOCK, roadWidth: ROAD_W, pavWidth: PAV_W,
          buildingMinH, buildingMaxH, buildingBaseH } = CITY_CONFIG;

  const r = SeededRNG.fromChunk(seed, cx, cz);

  const cols = Math.floor(chunkSize / BLOCK);
  const rows = Math.floor(chunkSize / BLOCK);

  let buildingCount = 0;
  let buildingLocalIdx = 0;
  const buildingBoxes = [];         // { minX,maxX,minY,maxY,minZ,maxZ, id }
  const buildingMeshes = {};        // id → THREE.Mesh (body only, individually destructible)
  const buildingCollisionGeos = []; // position-only world-space geos merged into collision mesh

  // Batch collection for non-destructible detail elements
  const batches = {
    road: [],
    pavement: [],
    roof: [],
    ledge: [],
    glass: [],
    ant: [],
    strip: [],
  };

  const addBatch = (type, geo, x, y, z) => {
    const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
    geo.applyMatrix4(matrix);
    batches[type].push(geo);
  };

  for (let gx = 0; gx < cols; gx++) {
    for (let gz = 0; gz < rows; gz++) {
      const bx = gx * BLOCK - chunkSize / 2 + BLOCK / 2;
      const bz = gz * BLOCK - chunkSize / 2 + BLOCK / 2;
      const wx = bx + cx * chunkSize;
      const wz = bz + cz * chunkSize;

      if (!isCityZone(wx, wz)) continue;
      const gy = getTerrainHeight(wx, wz);

      if (lod <= 2) {
        // Road X — terrain-following ribbon along X, centred at Z = bz−BLOCK/2
        batches.road.push(buildRoadRibbon(
          'x', bx - BLOCK / 2, bx + BLOCK / 2,
          bz - BLOCK / 2, ROAD_W, cx, cz, chunkSize, ROAD_STEPS,
        ));

        // Road Z — terrain-following ribbon along Z, centred at X = bx−BLOCK/2
        batches.road.push(buildRoadRibbon(
          'z', bz - BLOCK / 2, bz + BLOCK / 2,
          bx - BLOCK / 2, ROAD_W, cx, cz, chunkSize, ROAD_STEPS,
        ));

        // Intersection quad — fills the corner where X and Z roads meet
        batches.road.push(buildTerrainGrid(
          bx - BLOCK / 2, bz - BLOCK / 2,
          wx - BLOCK / 2, wz - BLOCK / 2,
          ROAD_W, ROAD_W, 3, 3, ROAD_RAISE,
        ));

        // Pavement — terrain-following grid for the block interior
        const pavSize = BLOCK - ROAD_W;
        batches.pavement.push(buildTerrainGrid(
          bx, bz, wx, wz,
          pavSize, pavSize, PAV_STEPS, PAV_STEPS, PAV_RAISE,
        ));

        // Collision boxes — approximate AABBs (locomotion uses terrain mesh, not these)
        const wbx = cx * chunkSize + bx;
        const wbz = cz * chunkSize + bz;
        buildingBoxes.push({
          minX: wbx - BLOCK / 2, maxX: wbx + BLOCK / 2,
          minY: gy, maxY: gy + 0.3,
          minZ: wbz - BLOCK / 2 - ROAD_W / 2, maxZ: wbz - BLOCK / 2 + ROAD_W / 2,
        });
        buildingBoxes.push({
          minX: wbx - BLOCK / 2 - ROAD_W / 2, maxX: wbx - BLOCK / 2 + ROAD_W / 2,
          minY: gy, maxY: gy + 0.3,
          minZ: wbz - BLOCK / 2, maxZ: wbz + BLOCK / 2,
        });
        const pw = (BLOCK - ROAD_W) / 2;
        buildingBoxes.push({
          minX: wbx - pw, maxX: wbx + pw,
          minY: gy, maxY: gy + 0.4,
          minZ: wbz - pw, maxZ: wbz + pw,
        });
      }

      if (lod >= 3) continue;

      // Buildings logic
      const buildable = BLOCK - ROAD_W - PAV_W * 2;
      const subX = r.next() > 0.5 ? 2 : 1;
      const subZ = Math.ceil((Math.floor(r.next() * 3) + 1) / subX);
      const cellW = buildable / subX, cellD = buildable / subZ;

      for (let sx = 0; sx < subX; sx++) {
        for (let sz = 0; sz < subZ; sz++) {
          const margin = 2 + r.next() * 3;
          const bW = cellW - margin * 2, bD = cellD - margin * 2;
          if (bW < 5 || bD < 5) continue;

          const distC = Math.sqrt(bx * bx + bz * bz) / (chunkSize * 0.7);
          const hBias = Math.max(0, 1 - distC);
          const bH = buildingMinH + r.next() * r.next() * (buildingMaxH * hBias + buildingBaseH);
          const mIdx = Math.floor(r.next() * MAT.bld.length);
          const ox = -buildable / 2 + sx * cellW + cellW / 2;
          const oz = -buildable / 2 + sz * cellD + cellD / 2;

          const worldBX = cx * chunkSize + bx + ox;
          const worldBZ = cz * chunkSize + bz + oz;
          // Use the lowest corner of the footprint so the building never floats
          const worldBY = minTerrainUnderFootprint(worldBX, worldBZ, bW / 2, bD / 2) + 0.4;
          const buildingId = `${cx}_${cz}_${buildingLocalIdx++}`;
          buildingBoxes.push({
            minX: worldBX - bW / 2, maxX: worldBX + bW / 2,
            minY: worldBY,          maxY: worldBY + bH,
            minZ: worldBZ - bD / 2, maxZ: worldBZ + bD / 2,
            id: buildingId,
          });

          // ── Building type selection (seeded) ──────────────────────────
          // Consume before lod>1 skip so RNG stays consistent at all LODs.
          const typeRoll = r.next();
          let buildingType;
          if (bH < 22) {
            // Small plots: houses dominate, occasional small domes
            buildingType = typeRoll < 0.45 ? 'house'
                         : typeRoll < 0.70 ? 'dome'
                         : 'box';
          } else if (bH < 55) {
            // Mid-rise: full mix
            buildingType = typeRoll < 0.18 ? 'house'
                         : typeRoll < 0.36 ? 'dome'
                         : typeRoll < 0.50 ? 'geodesic'
                         : typeRoll < 0.65 ? 'tower'
                         : 'box';
          } else {
            // High-rise: towers and slabs only
            buildingType = typeRoll < 0.35 ? 'tower' : 'box';
          }

          // ── Building body geometry ─────────────────────────────────────
          const bMat = lod === 0 ? MAT.bld[mIdx] : MAT.bld_low?.[mIdx] ?? MAT.bld[mIdx];
          let bg, bodyH = bH, bodyPosY = worldBY + bH / 2;

          if (buildingType === 'tower') {
            // Slim octagonal shaft — visual width shrinks but collision uses full bW/bD
            bg = buildTowerBody(bW, bH, bD);
            // No UV scaling needed for cylinders

          } else if (buildingType === 'dome') {
            const baseH = Math.max(3, bH * 0.28);
            bg = buildDomeBase(bW, bD, baseH);
            bodyH = baseH;
            bodyPosY = worldBY + baseH / 2;
            // Hemisphere cap goes into roof batch
            const domeR  = Math.min(bW, bD) * 0.48;
            const domeGeo = new THREE.SphereGeometry(domeR, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
            addBatch('roof', domeGeo, bx + ox, worldBY + baseH, bz + oz);

          } else if (buildingType === 'geodesic') {
            const baseH = Math.max(2, bH * 0.2);
            bg = buildGeodesicBase(bW, bD, baseH);
            bodyH = baseH;
            bodyPosY = worldBY + baseH / 2;
            // Faceted low-poly cap — low segment count gives the angular geodesic look
            const domeR  = Math.min(bW, bD) * 0.46;
            const capGeo = new THREE.SphereGeometry(domeR, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
            addBatch('glass', capGeo, bx + ox, worldBY + baseH, bz + oz);

          } else if (buildingType === 'house') {
            const houseH  = Math.min(bH, 16);
            const wallH   = houseH * 0.62;
            const roofH   = houseH * 0.38;
            bg = buildHouseWalls(bW, wallH, bD);
            bodyH    = wallH;
            bodyPosY = worldBY + wallH / 2;
            // Square-pyramid roof (4-sided, rotated 45° for diamond silhouette)
            const pRadius = Math.min(bW, bD) * 0.62;
            const pyrGeo  = new THREE.CylinderGeometry(0, pRadius, roofH, 4, 1, false, Math.PI / 4);
            addBatch('roof', pyrGeo, bx + ox, worldBY + wallH + roofH / 2, bz + oz);

          } else {
            // box (default)
            bg = new THREE.BoxGeometry(bW, bH, bD);
            scaleBoxUVs(bg, bW, bH, bD, 8, 20);
          }

          const bMesh = new THREE.Mesh(bg, bMat);
          bMesh.castShadow = true;
          bMesh.receiveShadow = true;
          bMesh.position.set(bx + ox, bodyPosY, bz + oz);
          bMesh.userData.buildingId = buildingId;
          group.add(bMesh);
          buildingMeshes[buildingId] = bMesh;
          buildingCount++;

          // Collision — always a full-height box regardless of visual type
          const collGeo = new THREE.BoxGeometry(bW, bodyH, bD);
          collGeo.deleteAttribute('normal');
          collGeo.deleteAttribute('uv');
          collGeo.translate(worldBX, worldBY + bodyH / 2, worldBZ);
          buildingCollisionGeos.push(collGeo);

          if (lod > 1) { r.next(); r.next(); r.next(); r.next(); continue; }

          // ── LOD 0 details ─────────────────────────────────────────────
          if (lod === 0 && (buildingType === 'box' || buildingType === 'tower')) {
            const floorCount = 16 + Math.floor(Math.random() * 8);
            const floorH = bH / floorCount;
            for (let f = 1; f < floorCount; f++) {
              const fY = worldBY + f * floorH;
              if (buildingType === 'box') {
                const geoLedge = new THREE.BoxGeometry(bW + 0.25, 0.4, bD + 0.25);
                addBatch('ledge', geoLedge, bx + ox, fY, bz + oz);
              } else {
                // Ring ledge for tower
                const tR = Math.min(bW, bD) * 0.4;
                const ringGeo = new THREE.TorusGeometry(tR, 0.18, 4, 8);
                addBatch('ledge', ringGeo, bx + ox, fY, bz + oz);
              }

              if (buildingType === 'box' && r.next() > 0.85) {
                const bSide  = Math.floor(r.next() * 4);
                const bWidth = bW * (0.3 + r.next() * 0.4);
                const bDepth = 1.8;
                const balcGeo = new THREE.BoxGeometry(
                  bSide < 2 ? bWidth : bDepth, 0.25, bSide < 2 ? bDepth : bWidth,
                );
                let bX = bx + ox, bZ = bz + oz;
                if (bSide === 0) bZ += bD / 2 + bDepth / 2;
                if (bSide === 1) bZ -= bD / 2 + bDepth / 2;
                if (bSide === 2) bX += bW / 2 + bDepth / 2;
                if (bSide === 3) bX -= bW / 2 + bDepth / 2;
                addBatch('ledge', balcGeo, bX, fY, bZ);
                const railGeo = new THREE.BoxGeometry(bSide < 2 ? bWidth : 0.1, 1.1, bSide < 2 ? 0.1 : bWidth);
                let rX = bX, rZ = bZ;
                if (bSide === 0) rZ += bDepth / 2;
                if (bSide === 1) rZ -= bDepth / 2;
                if (bSide === 2) rX += bDepth / 2;
                if (bSide === 3) rX -= bDepth / 2;
                addBatch('ant', railGeo, rX, fY + 0.5, rZ);
              }
            }
            if (bH > 18) {
              const bands = Math.floor(bH / 18);
              for (let b = 0; b < bands; b++) {
                const bandY = worldBY + (b + 1) * (bH / (bands + 1));
                if (buildingType === 'box') {
                  const bndGeo = new THREE.BoxGeometry(bW + 0.05, 1.8, bD + 0.05);
                  addBatch('glass', bndGeo, bx + ox, bandY, bz + oz);
                } else {
                  // Horizontal ring for tower
                  const tR = Math.min(bW, bD) * 0.42;
                  const rGeo = new THREE.TorusGeometry(tR, 0.22, 4, 8);
                  addBatch('glass', rGeo, bx + ox, bandY, bz + oz);
                }
              }
            }
          }

          // ── Roof cap / spire ──────────────────────────────────────────
          const rH       = 1.5 + r.next() * 4;
          const roofSclX = 0.5 + r.next() * 0.4;
          const roofOffX = (r.next() - 0.5) * bW * 0.3;
          const roofOffZ = (r.next() - 0.5) * bD * 0.3;

          if (buildingType === 'box') {
            const rGeo = new THREE.BoxGeometry(bW * roofSclX, rH, bD * roofSclX);
            addBatch('roof', rGeo, bx + ox + roofOffX, worldBY + bH + rH / 2, bz + oz + roofOffZ);
          } else if (buildingType === 'tower') {
            // Needle spire
            const spireH = rH * 2.5;
            const sGeo = new THREE.CylinderGeometry(0, 0.22, spireH, 6);
            addBatch('ant', sGeo, bx + ox, worldBY + bH + spireH / 2, bz + oz);
          }
          // Domes/geodesic/houses already added caps above — no extra roof box

          if (lod === 0 && currentMode === 'scifi' && bH > 25 && buildingType === 'box') {
            for (let s = 0; s < 4; s++) {
              const sGeo = new THREE.BoxGeometry(bW + 0.15, 0.35, 0.35);
              addBatch('strip', sGeo, bx + ox, worldBY + bH - s * 5 - 1, bz + oz + bD / 2 + 0.1);
              const sGeo2 = sGeo.clone();
              addBatch('strip', sGeo2, bx + ox, worldBY + bH - s * 5 - 1, bz + oz - bD / 2 - 0.1);
            }
          }

          if (lod === 0 && currentMode === 'realistic' && bH > 45 && r.next() > 0.4) {
            const aH  = 6 + r.next() * 16;
            const aGeo = new THREE.CylinderGeometry(0.12, 0.12, aH, 5);
            addBatch('ant', aGeo, bx + ox + (r.next() - 0.5) * bW * 0.3, worldBY + bH + aH / 2, bz + oz + (r.next() - 0.5) * bD * 0.3);
          }
        }
      }

      // Street lamps (LOD 0 only, batched)
      if (lod === 0 && r.next() > 0.35) {
        const buildable = BLOCK - ROAD_W - PAV_W * 2;
        const lampPositions = [
          [bx - buildable / 2 - PAV_W, bz - buildable / 2 - PAV_W],
          [bx + buildable / 2 + PAV_W, bz + buildable / 2 + PAV_W]
        ];
        for (const pos of lampPositions) {
          const pGeo = new THREE.CylinderGeometry(0.12, 0.12, 7, 5);
          addBatch('ant', pGeo, pos[0], gy + 3.5, pos[1]);
          const hGeo = new THREE.BoxGeometry(1.4, 0.3, 0.4);
          addBatch('strip', hGeo, pos[0], gy + 7.15, pos[1]);
        }
      }
    }
  }

  // Create final meshes from batches
  const finalize = (label, material) => {
    if (batches[label].length > 0) {
      const merged = mergeGeometries(batches[label]);
      const mesh = new THREE.Mesh(merged, material);
      mesh.receiveShadow = true;
      if (label === 'bld' || label === 'roof' || label === 'ledge') mesh.castShadow = true;
      group.add(mesh);
    }
  };

  finalize('road', MAT.road);
  finalize('pavement', MAT.pavement);
  finalize('roof', MAT.roof);
  finalize('ledge', MAT.ledge);
  finalize('glass', MAT.glass);
  finalize('ant', MAT.ant);
  finalize('strip', MAT.strip);

  // Merge all building collision boxes into a single world-space mesh.
  // Position-only geometry guarantees attribute compatibility for mergeGeometries.
  // Not added to group — WorldSystem wraps it with createTransformEntity separately.
  let buildingCollisionMesh = null;
  if (buildingCollisionGeos.length > 0) {
    const collMerged = mergeGeometries(buildingCollisionGeos);
    if (collMerged) {
      buildingCollisionMesh = new THREE.Mesh(
        collMerged,
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
      );
      buildingCollisionMesh.name = `building_collision_${cx}_${cz}`;
    }
  }

  return { buildingCount, buildingBoxes, buildingMeshes, buildingCollisionMesh };
}
