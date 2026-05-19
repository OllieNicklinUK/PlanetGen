/**
 * PlanetGen — Creature Part Generator
 * =====================================
 * Run with: npx tsx scripts/generateParts.ts
 *
 * Generates the full creature parts bank as GLB files using Three.js geometry
 * and exports them via GLTFExporter. Output goes to public/creatures/parts/
 * and also writes parts-manifest.json.
 *
 * All parts:
 *  - Use vertex colours only (no textures)
 *  - Are normalised to fit within a 1×1×1 unit bounding box
 *  - Have a named attach bone marker at origin (attachment point)
 *  - Are low poly (< 200 triangles each)
 */

import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { JSDOM } from 'jsdom'

// ── Polyfill browser globals needed by Three.js GLTFExporter in Node ──────────
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(global as any).window = dom.window
;(global as any).document = dom.window.document
;(global as any).Blob = dom.window.Blob
;(global as any).URL = dom.window.URL
;(global as any).FileReader = dom.window.FileReader
;(global as any).TextEncoder = dom.window.TextEncoder
;(global as any).TextDecoder = dom.window.TextDecoder

// ── Output paths ──────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../public/creatures/parts')
const MANIFEST_PATH = path.resolve(__dirname, '../src/creatures/parts/parts-manifest.json')

fs.mkdirSync(path.join(OUT_DIR, 'heads'), { recursive: true })
fs.mkdirSync(path.join(OUT_DIR, 'tails'), { recursive: true })
fs.mkdirSync(path.join(OUT_DIR, 'limb_endings'), { recursive: true })
fs.mkdirSync(path.join(OUT_DIR, 'accessories'), { recursive: true })
fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true })

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Paint all vertices of a BufferGeometry a single colour */
function paintGeometry(geo: THREE.BufferGeometry, color: THREE.Color) {
  const positions = geo.attributes.position
  const colours = new Float32Array(positions.count * 3)
  for (let i = 0; i < positions.count; i++) {
    colours[i * 3 + 0] = color.r
    colours[i * 3 + 1] = color.g
    colours[i * 3 + 2] = color.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3))
}

/** Paint vertices by a height gradient between two colours */
function paintGradient(
  geo: THREE.BufferGeometry,
  colorLow: THREE.Color,
  colorHigh: THREE.Color,
  axis: 'y' | 'x' | 'z' = 'y'
) {
  geo.computeBoundingBox()
  const box = geo.boundingBox!
  const minV = box.min[axis]
  const range = box.max[axis] - minV
  const positions = geo.attributes.position
  const colours = new Float32Array(positions.count * 3)
  const tmp = new THREE.Color()
  for (let i = 0; i < positions.count; i++) {
    const t = range === 0 ? 0 : (positions.getComponent(i, axis === 'y' ? 1 : axis === 'x' ? 0 : 2) - minV) / range
    tmp.lerpColors(colorLow, colorHigh, t)
    colours[i * 3 + 0] = tmp.r
    colours[i * 3 + 1] = tmp.g
    colours[i * 3 + 2] = tmp.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3))
}

/** Normalise geometry to fit inside [-0.5, 0.5]³ bounding box */
function normalise(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox()
  const box = geo.boundingBox!
  const size = new THREE.Vector3()
  box.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z)
  if (maxDim === 0) return
  const scale = 1 / maxDim
  const center = new THREE.Vector3()
  box.getCenter(center)
  const positions = geo.attributes.position
  for (let i = 0; i < positions.count; i++) {
    positions.setXYZ(
      i,
      (positions.getX(i) - center.x) * scale,
      (positions.getY(i) - center.y) * scale,
      (positions.getZ(i) - center.z) * scale,
    )
  }
  positions.needsUpdate = true
  geo.computeBoundingBox()
}

/** Create a vertex-coloured material */
function vcMat() {
  return new THREE.MeshLambertMaterial({ vertexColors: true })
}

/** Merge multiple geometries into one, optionally with transforms */
function mergeGeos(
  parts: Array<{ geo: THREE.BufferGeometry; transform?: THREE.Matrix4 }>
): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry()
  const posArrays: Float32Array[] = []
  const colArrays: Float32Array[] = []
  const idxArrays: Uint32Array[] = []
  let vertOffset = 0

  for (const { geo, transform } of parts) {
    const g = geo.toNonIndexed().clone() // Standardise to non-indexed for easier merging if needed, or stick to indexed.
    // Actually, safer to ensure everyone HAS an index or nobody has.
    // Let's force indexed.
    if (!g.index) {
        const count = g.attributes.position.count
        const indices = new Uint32Array(count)
        for (let j = 0; j < count; j++) indices[j] = j
        g.setIndex(new THREE.BufferAttribute(indices, 1))
    }

    if (transform) g.applyMatrix4(transform)
    
    posArrays.push(new Float32Array(g.attributes.position.array))
    colArrays.push(new Float32Array(g.attributes.color.array))
    
    const idx = g.index!
    const shifted = new Uint32Array(idx.array.length)
    for (let j = 0; j < idx.array.length; j++) {
        shifted[j] = (idx.array[j] as number) + vertOffset
    }
    idxArrays.push(shifted)
    
    vertOffset += g.attributes.position.count
  }

  const totalVerts = posArrays.reduce((s, a) => s + a.length / 3, 0)
  const totalIdx = idxArrays.reduce((s, a) => s + a.length, 0)
  const pos = new Float32Array(totalVerts * 3)
  const col = new Float32Array(totalVerts * 3)
  const idx = new Uint32Array(totalIdx)

  let pOff = 0, cOff = 0, iOff = 0
  for (let i = 0; i < posArrays.length; i++) {
    pos.set(posArrays[i], pOff); pOff += posArrays[i].length
    col.set(colArrays[i], cOff); cOff += colArrays[i].length
    idx.set(idxArrays[i], iOff); iOff += idxArrays[i].length
  }

  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3))
  merged.setIndex(new THREE.BufferAttribute(idx, 1))
  merged.computeVertexNormals()
  return merged
}

/** Export a mesh as GLB and save to disk */
async function exportGLB(mesh: THREE.Mesh, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(
      mesh,
      (result) => {
        const buffer = result instanceof ArrayBuffer ? result : Buffer.from(JSON.stringify(result))
        fs.writeFileSync(outPath, Buffer.from(buffer))
        console.log(`  ✓ ${path.basename(outPath)} (${(buffer.byteLength / 1024).toFixed(1)} KB)`)
        resolve()
      },
      (err) => reject(err),
      { binary: true }
    )
  })
}

// ── Colour palettes (vertex colour base tones — tinted at runtime by biome) ───
const C = {
  bone:    new THREE.Color(0.85, 0.80, 0.70),
  dark:    new THREE.Color(0.20, 0.18, 0.15),
  mid:     new THREE.Color(0.50, 0.45, 0.40),
  green:   new THREE.Color(0.30, 0.55, 0.25),
  teal:    new THREE.Color(0.20, 0.60, 0.55),
  amber:   new THREE.Color(0.75, 0.45, 0.10),
  purple:  new THREE.Color(0.45, 0.20, 0.60),
  grey:    new THREE.Color(0.55, 0.55, 0.55),
  white:   new THREE.Color(0.90, 0.88, 0.85),
  red:     new THREE.Color(0.70, 0.15, 0.10),
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEAD GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

function makeHead_blunt(): THREE.Mesh {
  // Wide, rounded low-poly skull — good for herbivores / grazers
  const skull = new THREE.SphereGeometry(0.4, 6, 4)
  skull.scale(1.2, 0.9, 1.0)
  paintGradient(skull, C.dark, C.bone)

  // Flat snout
  const snout = new THREE.BoxGeometry(0.35, 0.22, 0.28)
  snout.translate(0, -0.12, 0.36)
  paintGeometry(snout, C.mid)

  // Eye sockets (small dark indents — decorative flats)
  const eyeL = new THREE.SphereGeometry(0.07, 4, 3)
  eyeL.translate(-0.22, 0.08, 0.32)
  paintGeometry(eyeL, C.dark)
  const eyeR = eyeL.clone(); eyeR.translate(0.44, 0, 0)

  const geo = mergeGeos([
    { geo: skull },
    { geo: snout },
    { geo: eyeL },
    { geo: eyeR },
  ])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeHead_elongated(): THREE.Mesh {
  // Long narrow skull — predatory / theropod feel
  const skull = new THREE.BoxGeometry(0.3, 0.35, 0.65)
  skull.scale(1, 1, 1)
  paintGradient(skull, C.dark, C.mid, 'y')

  // Extended jaw — lower half
  const jaw = new THREE.BoxGeometry(0.26, 0.14, 0.55)
  jaw.translate(0, -0.22, 0.04)
  paintGeometry(jaw, C.dark)

  // Narrow snout tip
  const tip = new THREE.ConeGeometry(0.10, 0.30, 4)
  tip.rotateX(Math.PI / 2)
  tip.translate(0, -0.08, 0.44)
  paintGeometry(tip, C.mid)

  // Eyes — side-mounted
  const eyeL = new THREE.SphereGeometry(0.06, 4, 3)
  eyeL.translate(-0.17, 0.06, 0.08)
  paintGeometry(eyeL, new THREE.Color(0.9, 0.7, 0.0))
  const eyeR = eyeL.clone(); eyeR.translate(0.34, 0, 0)

  const geo = mergeGeos([{ geo: skull }, { geo: jaw }, { geo: tip }, { geo: eyeL }, { geo: eyeR }])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeHead_wide(): THREE.Mesh {
  // Broad flat head — aquatic / ray-like
  const skull = new THREE.CylinderGeometry(0.5, 0.35, 0.2, 6)
  skull.scale(1.4, 1, 0.9)
  paintGradient(skull, C.dark, C.teal, 'y')

  // Wide flat mouth slit
  const mouth = new THREE.BoxGeometry(0.55, 0.06, 0.12)
  mouth.translate(0, -0.1, 0.32)
  paintGeometry(mouth, C.dark)

  // Eyes on top
  const eyeL = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 5)
  eyeL.translate(-0.28, 0.12, 0.0)
  paintGeometry(eyeL, C.dark)
  const eyeR = eyeL.clone(); eyeR.translate(0.56, 0, 0)

  const geo = mergeGeos([{ geo: skull }, { geo: mouth }, { geo: eyeL }, { geo: eyeR }])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeHead_eyeless(): THREE.Mesh {
  // Smooth noseless head — cave/toxic creature, no visible sensory organs
  const skull = new THREE.SphereGeometry(0.42, 5, 4)
  skull.scale(0.9, 1.0, 1.1)
  paintGradient(skull, C.purple, C.dark, 'y')

  // Mouth — vertical slit
  const slit = new THREE.BoxGeometry(0.08, 0.28, 0.06)
  slit.translate(0, 0, 0.42)
  paintGeometry(slit, C.dark)

  // Sensory pits (small dimples)
  for (let i = 0; i < 3; i++) {
    const pit = new THREE.SphereGeometry(0.04, 3, 2)
    pit.translate(
      (i - 1) * 0.18,
      0.15,
      0.38
    )
    paintGeometry(pit, new THREE.Color(0.15, 0.05, 0.20))
  }

  const geo = mergeGeos([{ geo: skull }, { geo: slit }])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeHead_beak(): THREE.Mesh {
  // Bird/theropod beak head
  const skull = new THREE.SphereGeometry(0.38, 6, 4)
  skull.scale(0.95, 1.1, 0.9)
  paintGradient(skull, C.bone, C.grey, 'y')

  // Upper beak
  const beakTop = new THREE.ConeGeometry(0.12, 0.45, 4)
  beakTop.rotateX(Math.PI / 2)
  beakTop.translate(0, 0.05, 0.44)
  paintGeometry(beakTop, C.amber)

  // Lower beak (shorter)
  const beakBot = new THREE.ConeGeometry(0.09, 0.30, 4)
  beakBot.rotateX(Math.PI / 2)
  beakBot.translate(0, -0.09, 0.40)
  paintGeometry(beakBot, C.amber)

  // Nostril bumps
  const nostrilL = new THREE.SphereGeometry(0.04, 3, 2)
  nostrilL.translate(-0.07, 0.08, 0.36)
  paintGeometry(nostrilL, C.mid)
  const nostrilR = nostrilL.clone(); nostrilR.translate(0.14, 0, 0)

  // Eyes — forward-facing
  const eyeL = new THREE.SphereGeometry(0.075, 5, 4)
  eyeL.translate(-0.19, 0.12, 0.24)
  paintGeometry(eyeL, new THREE.Color(0.05, 0.05, 0.05))
  const eyeR = eyeL.clone(); eyeR.translate(0.38, 0, 0)

  const geo = mergeGeos([
    { geo: skull }, { geo: beakTop }, { geo: beakBot },
    { geo: nostrilL }, { geo: nostrilR }, { geo: eyeL }, { geo: eyeR }
  ])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeHead_alien(): THREE.Mesh {
  // Asymmetric alien head — works with any morphotype
  const skull = new THREE.OctahedronGeometry(0.4, 1)
  skull.scale(1.1, 1.3, 0.9)
  paintGradient(skull, C.teal, C.purple, 'y')

  // Single large central eye
  const eye = new THREE.SphereGeometry(0.14, 6, 5)
  eye.translate(0.08, 0.10, 0.36)
  paintGeometry(eye, new THREE.Color(0.0, 0.9, 0.7))

  // Pupil
  const pupil = new THREE.SphereGeometry(0.07, 5, 4)
  pupil.translate(0.08, 0.10, 0.44)
  paintGeometry(pupil, C.dark)

  // Mandibles (×2)
  const mandL = new THREE.ConeGeometry(0.05, 0.28, 3)
  mandL.rotateZ(0.4)
  mandL.translate(-0.22, -0.25, 0.28)
  paintGeometry(mandL, C.bone)
  const mandR = mandL.clone()
  mandR.scale(-1, 1, 1)
  mandR.translate(0.44, 0, 0)

  const geo = mergeGeos([
    { geo: skull }, { geo: eye }, { geo: pupil }, { geo: mandL }, { geo: mandR }
  ])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAIL GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

function makeTail_stub(): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.18, 0.3, 5)
  geo.rotateX(-Math.PI / 2)
  paintGradient(geo, C.mid, C.dark, 'z')
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeTail_fin(): THREE.Mesh {
  // Horizontal fish-tail fin
  const finL = new THREE.ConeGeometry(0.08, 0.5, 4)
  finL.rotateZ(Math.PI / 2)
  finL.scale(1, 0.3, 1)
  finL.translate(-0.28, 0, 0)
  paintGeometry(finL, C.teal)

  const finR = finL.clone()
  finR.scale(-1, 1, 1)
  finR.translate(0.56, 0, 0)

  const stalk = new THREE.CylinderGeometry(0.08, 0.12, 0.25, 5)
  stalk.rotateX(Math.PI / 2)
  paintGradient(stalk, C.mid, C.teal, 'z')

  const geo = mergeGeos([{ geo: stalk }, { geo: finL }, { geo: finR }])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeTail_whip(): THREE.Mesh {
  // Long tapered whip — multiple stacked cones
  const segments = 5
  const geos: Array<{ geo: THREE.BufferGeometry }> = []
  for (let i = 0; i < segments; i++) {
    const r = 0.12 * (1 - i / segments)
    const seg = new THREE.CylinderGeometry(r * 0.7, r, 0.22, 4)
    seg.rotateX(Math.PI / 2)
    seg.translate(0, (Math.sin(i * 0.7) * 0.05), i * 0.22)
    paintGradient(seg, C.mid, C.dark, 'z')
    geos.push({ geo: seg })
  }
  const geo = mergeGeos(geos)
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeTail_club(): THREE.Mesh {
  // Armoured club tail — stalk + heavy weighted end
  const stalk = new THREE.CylinderGeometry(0.08, 0.12, 0.55, 5)
  stalk.rotateX(Math.PI / 2)
  paintGeometry(stalk, C.mid)

  const club = new THREE.DodecahedronGeometry(0.22, 0)
  club.translate(0, 0, 0.38)
  paintGeometry(club, C.bone)

  // Spikes on club
  for (let i = 0; i < 4; i++) {
    const spike = new THREE.ConeGeometry(0.04, 0.18, 3)
    spike.rotateX(Math.PI / 2)
    spike.rotateY((i / 4) * Math.PI * 2)
    spike.translate(0.22 * Math.sin((i / 4) * Math.PI * 2), 0.22 * Math.cos((i / 4) * Math.PI * 2), 0.38)
    paintGeometry(spike, C.bone)
    stalk.merge?.(spike) // fallback: add to geos
  }

  const geo = mergeGeos([{ geo: stalk }, { geo: club }])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeTail_fan(): THREE.Mesh {
  // Decorative fan/peacock-style tail
  const stalk = new THREE.CylinderGeometry(0.06, 0.10, 0.3, 4)
  stalk.rotateX(Math.PI / 2)
  paintGeometry(stalk, C.mid)

  const fanCount = 5
  const geos: Array<{ geo: THREE.BufferGeometry }> = [{ geo: stalk }]
  for (let i = 0; i < fanCount; i++) {
    const t = (i / (fanCount - 1)) - 0.5
    const blade = new THREE.PlaneGeometry(0.08, 0.45, 1, 2)
    blade.rotateY(t * 0.9)
    blade.translate(t * 0.3, 0, 0.28)
    paintGradient(blade, C.green, C.amber, 'y')
    geos.push({ geo: blade })
  }

  const geo = mergeGeos(geos)
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIMB ENDING GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

function makeFoot_pad(): THREE.Mesh {
  // Flat padded foot — general purpose
  const pad = new THREE.CylinderGeometry(0.18, 0.22, 0.08, 6)
  paintGeometry(pad, C.dark)

  const toeCount = 3
  const geos: Array<{ geo: THREE.BufferGeometry }> = [{ geo: pad }]
  for (let i = 0; i < toeCount; i++) {
    const angle = ((i / toeCount) - 0.5) * 1.2
    const toe = new THREE.CapsuleGeometry ? new THREE.SphereGeometry(0.07, 4, 3) : new THREE.SphereGeometry(0.07, 4, 3)
    toe.translate(Math.sin(angle) * 0.2, 0.0, Math.cos(angle) * 0.2 + 0.1)
    paintGeometry(toe, C.mid)
    geos.push({ geo: toe })
  }

  const geo = mergeGeos(geos)
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeFoot_claw(): THREE.Mesh {
  // Sharp clawed foot — predator / toxic biome
  const base = new THREE.BoxGeometry(0.25, 0.1, 0.2)
  paintGeometry(base, C.dark)

  const clawCount = 3
  const geos: Array<{ geo: THREE.BufferGeometry }> = [{ geo: base }]
  for (let i = 0; i < clawCount; i++) {
    const angle = ((i / clawCount) - 0.5) * 1.0
    const claw = new THREE.ConeGeometry(0.04, 0.22, 3)
    claw.rotateX(Math.PI / 2)
    claw.translate(Math.sin(angle) * 0.12, -0.04, Math.cos(angle) * 0.14 + 0.16)
    paintGeometry(claw, C.bone)
    geos.push({ geo: claw })
  }

  const geo = mergeGeos(geos)
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeFoot_hoof(): THREE.Mesh {
  // Single hard hoof — ungulate style
  const hoof = new THREE.BoxGeometry(0.22, 0.18, 0.28)
  hoof.scale(1, 1, 1)
  paintGeometry(hoof, C.dark)

  // Slight forward taper
  const tip = new THREE.ConeGeometry(0.10, 0.12, 4)
  tip.rotateX(Math.PI / 2)
  tip.translate(0, -0.04, 0.2)
  paintGeometry(tip, C.dark)

  // Fetlock bump
  const bump = new THREE.SphereGeometry(0.1, 4, 3)
  bump.scale(1, 0.7, 1)
  bump.translate(0, 0.1, -0.06)
  paintGeometry(bump, C.mid)

  const geo = mergeGeos([{ geo: hoof }, { geo: tip }, { geo: bump }])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeFoot_fin(): THREE.Mesh {
  // Flipper — aquatic / marsh
  const flipper = new THREE.CylinderGeometry(0.06, 0.25, 0.06, 6)
  flipper.scale(1.6, 1, 1)
  paintGradient(flipper, C.teal, C.dark, 'y')

  // Webbing ridges
  const geos: Array<{ geo: THREE.BufferGeometry }> = [{ geo: flipper }]
  for (let i = 0; i < 4; i++) {
    const ridge = new THREE.BoxGeometry(0.04, 0.05, 0.26)
    ridge.translate(((i / 3) - 0.5) * 0.36, 0, 0.06)
    paintGeometry(ridge, C.teal)
    geos.push({ geo: ridge })
  }

  const geo = mergeGeos(geos)
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeFoot_talon(): THREE.Mesh {
  // Bird talon — BIPED only, digitigrade feet
  const ball = new THREE.SphereGeometry(0.12, 5, 4)
  paintGeometry(ball, C.dark)

  const talonCount = 4
  const geos: Array<{ geo: THREE.BufferGeometry }> = [{ geo: ball }]
  const angles = [-0.7, -0.2, 0.25, 0.7]
  for (let i = 0; i < talonCount; i++) {
    const talon = new THREE.ConeGeometry(0.035, 0.24, 3)
    talon.rotateX(Math.PI / 2)
    talon.translate(Math.sin(angles[i]) * 0.15, -0.04, Math.cos(angles[i]) * 0.18)
    paintGeometry(talon, C.bone)
    geos.push({ geo: talon })
  }

  const geo = mergeGeos(geos)
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCESSORY GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

function makeAcc_horn_single(): THREE.Mesh {
  const horn = new THREE.ConeGeometry(0.1, 0.55, 4)
  paintGradient(horn, C.bone, C.dark, 'y')
  normalise(horn)
  return new THREE.Mesh(horn, vcMat())
}

function makeAcc_horn_dual(): THREE.Mesh {
  const hornL = new THREE.ConeGeometry(0.07, 0.45, 4)
  hornL.rotateZ(0.25)
  hornL.translate(-0.18, 0, 0)
  paintGradient(hornL, C.bone, C.dark, 'y')

  const hornR = hornL.clone()
  hornR.scale(-1, 1, 1)
  hornR.translate(0.36, 0, 0)

  const geo = mergeGeos([{ geo: hornL }, { geo: hornR }])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeAcc_frill(): THREE.Mesh {
  // Neck frill — flat fan of blades
  const bladeCount = 6
  const geos: Array<{ geo: THREE.BufferGeometry }> = []
  for (let i = 0; i < bladeCount; i++) {
    const t = (i / (bladeCount - 1)) - 0.5
    const blade = new THREE.PlaneGeometry(0.05, 0.5, 1, 2)
    blade.rotateZ(t * 1.4)
    blade.translate(t * 0.15, 0.3, 0)
    paintGradient(blade, C.red, C.amber, 'y')
    geos.push({ geo: blade })
  }

  const geo = mergeGeos(geos)
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeAcc_spine_ridge(): THREE.Mesh {
  // Row of dorsal spines along spine
  const count = 5
  const geos: Array<{ geo: THREE.BufferGeometry }> = []
  for (let i = 0; i < count; i++) {
    const h = 0.15 + Math.sin((i / count) * Math.PI) * 0.25
    const spine = new THREE.ConeGeometry(0.04, h, 3)
    spine.translate(0, h / 2, (i / (count - 1) - 0.5) * 0.7)
    paintGradient(spine, C.mid, C.bone, 'y')
    geos.push({ geo: spine })
  }

  const geo = mergeGeos(geos)
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeAcc_antenna(): THREE.Mesh {
  // Pair of sensory antennae — cave/toxic
  const makeOne = (side: number) => {
    const geos: Array<{ geo: THREE.BufferGeometry }> = []
    const segCount = 4
    for (let i = 0; i < segCount; i++) {
      const seg = new THREE.CylinderGeometry(0.025 * (1 - i / segCount), 0.03 * (1 - i / segCount), 0.2, 4)
      seg.translate(side * 0.12, i * 0.2 + 0.1, 0)
      paintGeometry(seg, C.purple)
      geos.push({ geo: seg })
    }
    // Ball tip
    const tip = new THREE.SphereGeometry(0.06, 4, 3)
    tip.translate(side * 0.12, segCount * 0.2 + 0.1, 0)
    paintGeometry(tip, new THREE.Color(0.0, 0.9, 0.7))
    geos.push({ geo: tip })
    return geos
  }

  const geo = mergeGeos([...makeOne(-1), ...makeOne(1)])
  normalise(geo)
  return new THREE.Mesh(geo, vcMat())
}

function makeAcc_biolum(): THREE.Mesh {
  // Bioluminescent spot clusters — emissive material override
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: new THREE.Color(0.0, 0.8, 0.6),
    emissiveIntensity: 1.5,
  })

  const spotCount = 7
  const geos: Array<{ geo: THREE.BufferGeometry }> = []
  for (let i = 0; i < spotCount; i++) {
    const spot = new THREE.SphereGeometry(0.05 + Math.random() * 0.04, 4, 3)
    spot.translate(
      (Math.random() - 0.5) * 0.7,
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.6,
    )
    paintGeometry(spot, new THREE.Color(0.0, 1.0, 0.8))
    geos.push({ geo: spot })
  }

  const geo = mergeGeos(geos)
  normalise(geo)
  return new THREE.Mesh(geo, mat)
}

// ═══════════════════════════════════════════════════════════════════════════════
// MANIFEST BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

interface PartEntry {
  id: string
  file: string
  attachBone: string
  compatibleMorphotypes: string[]
  biomeAffinity: string[]
  weight: number
}

interface PartsManifest {
  heads: PartEntry[]
  tails: PartEntry[]
  limbEndings: PartEntry[]
  accessories: PartEntry[]
}

const manifest: PartsManifest = {
  heads: [
    { id: 'head_blunt_A',      file: 'heads/head_blunt_A.glb',      attachBone: 'head', compatibleMorphotypes: ['QUADRUPED', 'BIPED'], biomeAffinity: ['ARID', 'TEMPERATE', 'ARCTIC', 'JUNGLE'], weight: 1.0 },
    { id: 'head_elongated_B',  file: 'heads/head_elongated_B.glb',  attachBone: 'head', compatibleMorphotypes: ['QUADRUPED', 'BIPED'], biomeAffinity: ['ANY'], weight: 1.0 },
    { id: 'head_wide_C',       file: 'heads/head_wide_C.glb',       attachBone: 'head', compatibleMorphotypes: ['QUADRUPED', 'NOPED'], biomeAffinity: ['AQUATIC', 'MARSH', 'TEMPERATE'], weight: 1.0 },
    { id: 'head_eyeless_D',    file: 'heads/head_eyeless_D.glb',    attachBone: 'head', compatibleMorphotypes: ['QUADRUPED', 'BIPED', 'NOPED'], biomeAffinity: ['TOXIC', 'CAVE', 'VOLCANIC'], weight: 0.7 },
    { id: 'head_beak_E',       file: 'heads/head_beak_E.glb',       attachBone: 'head', compatibleMorphotypes: ['BIPED', 'QUADRUPED'], biomeAffinity: ['ARCTIC', 'TEMPERATE', 'ARID'], weight: 1.0 },
    { id: 'head_alien_F',      file: 'heads/head_alien_F.glb',      attachBone: 'head', compatibleMorphotypes: ['ANY'], biomeAffinity: ['ANY'], weight: 0.6 },
  ],
  tails: [
    { id: 'tail_stub',  file: 'tails/tail_stub.glb',  attachBone: 'tail_root', compatibleMorphotypes: ['ANY'], biomeAffinity: ['ANY'], weight: 1.0 },
    { id: 'tail_fin',   file: 'tails/tail_fin.glb',   attachBone: 'tail_root', compatibleMorphotypes: ['QUADRUPED', 'NOPED'], biomeAffinity: ['AQUATIC', 'MARSH'], weight: 1.2 },
    { id: 'tail_whip',  file: 'tails/tail_whip.glb',  attachBone: 'tail_root', compatibleMorphotypes: ['ANY'], biomeAffinity: ['ANY'], weight: 1.0 },
    { id: 'tail_club',  file: 'tails/tail_club.glb',  attachBone: 'tail_root', compatibleMorphotypes: ['QUADRUPED'], biomeAffinity: ['ARID', 'VOLCANIC', 'ARCTIC'], weight: 0.8 },
    { id: 'tail_fan',   file: 'tails/tail_fan.glb',   attachBone: 'tail_root', compatibleMorphotypes: ['BIPED', 'QUADRUPED'], biomeAffinity: ['TEMPERATE', 'JUNGLE'], weight: 0.9 },
  ],
  limbEndings: [
    { id: 'foot_pad',   file: 'limb_endings/foot_pad.glb',   attachBone: 'foot', compatibleMorphotypes: ['QUADRUPED', 'BIPED'], biomeAffinity: ['ANY'], weight: 1.0 },
    { id: 'foot_claw',  file: 'limb_endings/foot_claw.glb',  attachBone: 'foot', compatibleMorphotypes: ['QUADRUPED', 'BIPED'], biomeAffinity: ['ARID', 'VOLCANIC', 'TOXIC', 'JUNGLE'], weight: 1.0 },
    { id: 'foot_hoof',  file: 'limb_endings/foot_hoof.glb',  attachBone: 'foot', compatibleMorphotypes: ['QUADRUPED'], biomeAffinity: ['TEMPERATE', 'ARCTIC', 'ARID'], weight: 1.0 },
    { id: 'foot_fin',   file: 'limb_endings/foot_fin.glb',   attachBone: 'foot', compatibleMorphotypes: ['QUADRUPED', 'NOPED'], biomeAffinity: ['AQUATIC', 'MARSH'], weight: 1.2 },
    { id: 'foot_talon', file: 'limb_endings/foot_talon.glb', attachBone: 'foot', compatibleMorphotypes: ['BIPED'], biomeAffinity: ['ANY'], weight: 1.0 },
  ],
  accessories: [
    { id: 'acc_horn_single', file: 'accessories/acc_horn_single.glb', attachBone: 'spine_mid', compatibleMorphotypes: ['QUADRUPED', 'BIPED'], biomeAffinity: ['ARID', 'TEMPERATE', 'ARCTIC', 'VOLCANIC'], weight: 1.0 },
    { id: 'acc_horn_dual',   file: 'accessories/acc_horn_dual.glb',   attachBone: 'spine_mid', compatibleMorphotypes: ['QUADRUPED', 'BIPED'], biomeAffinity: ['ANY'], weight: 1.0 },
    { id: 'acc_frill',       file: 'accessories/acc_frill.glb',       attachBone: 'neck',      compatibleMorphotypes: ['QUADRUPED', 'BIPED'], biomeAffinity: ['JUNGLE', 'ARID', 'TEMPERATE'], weight: 0.8 },
    { id: 'acc_spine_ridge', file: 'accessories/acc_spine_ridge.glb', attachBone: 'spine_mid', compatibleMorphotypes: ['QUADRUPED', 'BIPED', 'NOPED'], biomeAffinity: ['ANY'], weight: 1.0 },
    { id: 'acc_antenna',     file: 'accessories/acc_antenna.glb',     attachBone: 'head',      compatibleMorphotypes: ['ANY'], biomeAffinity: ['TOXIC', 'CAVE', 'DEEP_SPACE'], weight: 1.0 },
    { id: 'acc_biolum',      file: 'accessories/acc_biolum.glb',      attachBone: 'spine_mid', compatibleMorphotypes: ['ANY'], biomeAffinity: ['CAVE', 'TOXIC', 'DEEP_SPACE', 'AQUATIC'], weight: 0.9 },
  ],
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN — generate all parts
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n🦎  PlanetGen Part Generator\n')

  const parts: Array<{ mesh: THREE.Mesh; outPath: string }> = [
    // Heads
    { mesh: makeHead_blunt(),      outPath: path.join(OUT_DIR, 'heads/head_blunt_A.glb') },
    { mesh: makeHead_elongated(),  outPath: path.join(OUT_DIR, 'heads/head_elongated_B.glb') },
    { mesh: makeHead_wide(),       outPath: path.join(OUT_DIR, 'heads/head_wide_C.glb') },
    { mesh: makeHead_eyeless(),    outPath: path.join(OUT_DIR, 'heads/head_eyeless_D.glb') },
    { mesh: makeHead_beak(),       outPath: path.join(OUT_DIR, 'heads/head_beak_E.glb') },
    { mesh: makeHead_alien(),      outPath: path.join(OUT_DIR, 'heads/head_alien_F.glb') },
    // Tails
    { mesh: makeTail_stub(),  outPath: path.join(OUT_DIR, 'tails/tail_stub.glb') },
    { mesh: makeTail_fin(),   outPath: path.join(OUT_DIR, 'tails/tail_fin.glb') },
    { mesh: makeTail_whip(),  outPath: path.join(OUT_DIR, 'tails/tail_whip.glb') },
    { mesh: makeTail_club(),  outPath: path.join(OUT_DIR, 'tails/tail_club.glb') },
    { mesh: makeTail_fan(),   outPath: path.join(OUT_DIR, 'tails/tail_fan.glb') },
    // Limb endings
    { mesh: makeFoot_pad(),   outPath: path.join(OUT_DIR, 'limb_endings/foot_pad.glb') },
    { mesh: makeFoot_claw(),  outPath: path.join(OUT_DIR, 'limb_endings/foot_claw.glb') },
    { mesh: makeFoot_hoof(),  outPath: path.join(OUT_DIR, 'limb_endings/foot_hoof.glb') },
    { mesh: makeFoot_fin(),   outPath: path.join(OUT_DIR, 'limb_endings/foot_fin.glb') },
    { mesh: makeFoot_talon(), outPath: path.join(OUT_DIR, 'limb_endings/foot_talon.glb') },
    // Accessories
    { mesh: makeAcc_horn_single(), outPath: path.join(OUT_DIR, 'accessories/acc_horn_single.glb') },
    { mesh: makeAcc_horn_dual(),   outPath: path.join(OUT_DIR, 'accessories/acc_horn_dual.glb') },
    { mesh: makeAcc_frill(),       outPath: path.join(OUT_DIR, 'accessories/acc_frill.glb') },
    { mesh: makeAcc_spine_ridge(), outPath: path.join(OUT_DIR, 'accessories/acc_spine_ridge.glb') },
    { mesh: makeAcc_antenna(),     outPath: path.join(OUT_DIR, 'accessories/acc_antenna.glb') },
    { mesh: makeAcc_biolum(),      outPath: path.join(OUT_DIR, 'accessories/acc_biolum.glb') },
  ]

  console.log('Exporting parts...\n')
  for (const { mesh, outPath } of parts) {
    await exportGLB(mesh, outPath)
  }

  // Write manifest
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
  console.log(`\n📋  Manifest written to ${MANIFEST_PATH}`)
  console.log(`\n✅  ${parts.length} parts generated in ${OUT_DIR}\n`)
}

main().catch(console.error)
