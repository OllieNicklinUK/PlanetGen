// grass-generator.js — Fluffy Grass upgrade
// Technique: 3 crossing planes (Y-shape) per blade for volumetric look
// - Procedural canvas alpha texture → soft blade silhouette
// - Dark/mid/tip colour uniforms for rich gradient
// - Dual-layer FBM wind for organic movement
// - Billboard pass (each plane angled toward camera) 
// - Player proximity push preserved
// - City-zone and underwater culling preserved
import * as THREE from 'three';
import { getTerrainHeight, isCityZone } from './noise.js';

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const NUM_GRASS       = 12000;   // blades per chunk (↑ from 8000)
const GRASS_SEGMENTS  = 4;       // segments per blade strip (↑ from 3)
const GRASS_PLANES    = 3;       // crossing planes per blade (NEW — Y-shape)
const GRASS_WIDTH     = 0.28;    // slightly wider for fluffiness
const GRASS_HEIGHT    = 1.1;

const VERTS_PER_PLANE = (GRASS_SEGMENTS + 1) * 2;
const TOTAL_VERTS     = GRASS_PLANES * VERTS_PER_PLANE;

// ── PROCEDURAL ALPHA TEXTURE ────────────────────────────────────────────────
// Creates a soft, tapered blade silhouette — bright center, transparent edges
function createGrassAlphaTexture() {
  const W = 64, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);

  for (let y = 0; y < H; y++) {
    const tV = y / (H - 1);               // 0 = top (tip), 1 = bottom (root)
    const bladeT = 1.0 - tV;              // 1 at tip, 0 at root
    const taper = 1.0 - bladeT * 0.75;   // blade narrows toward tip

    for (let x = 0; x < W; x++) {
      const xN = x / (W - 1);            // 0..1 across width
      const xC = Math.abs(xN - 0.5) * 2; // 0 at centre, 1 at edge

      // Edge softness — steeper at root, softer at tip
      const falloff = 2.0 + bladeT * 1.5;
      const xAlpha  = Math.max(0, 1.0 - Math.pow(xC / taper, falloff));

      // Slight tip fade
      const tipFade = tV < 0.06 ? tV / 0.06 : 1.0;

      const a  = Math.round(xAlpha * tipFade * 255);
      const i  = (y * W + x) * 4;
      img.data[i]   = 255;
      img.data[i+1] = 255;
      img.data[i+2] = 255;
      img.data[i+3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Cache the alpha texture (shared across all chunks)
let _alphaTexture = null;
function getAlphaTexture() {
  if (!_alphaTexture) _alphaTexture = createGrassAlphaTexture();
  return _alphaTexture;
}

// ── GLSL UTILITIES ──────────────────────────────────────────────────────────
const NOISE_GLSL = /* glsl */`
uint murmurHash12(uvec2 src) {
  const uint M = 0x5bd1e995u;
  uint h = 1190494759u;
  src *= M; src ^= src>>24u; src *= M;
  h *= M; h ^= src.x; h *= M; h ^= src.y;
  h ^= h>>13u; h *= M; h ^= h>>15u;
  return h;
}
float hash12(vec2 src) {
  uint h = murmurHash12(floatBitsToUint(src));
  return uintBitsToFloat(h & 0x007fffffu | 0x3f800000u) - 1.0;
}
uvec4 murmurHash42(uvec2 src) {
  const uint M = 0x5bd1e995u;
  uvec4 h = uvec4(1190494759u, 2147483647u, 3559788179u, 179424673u);
  src *= M; src ^= src>>24u; src *= M;
  h *= M; h ^= src.x; h *= M; h ^= src.y;
  h ^= h>>13u; h *= M; h ^= h>>15u;
  return h;
}
vec4 hash42(vec2 src) {
  uvec4 h = murmurHash42(floatBitsToUint(src));
  return uintBitsToFloat(h & 0x007fffffu | 0x3f800000u) - 1.0;
}

// Smooth value noise
float noise12(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = smoothstep(vec2(0.0), vec2(1.0), f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  ) * 2.0 - 1.0;
}

// 2-octave FBM wind — more organic than single noise
float windFBM(vec2 p) {
  float v = noise12(p) * 0.6;
  v      += noise12(p * 2.1 + vec2(1.7, 9.2)) * 0.4;
  return v;
}

float linearstep(float e0, float e1, float x) {
  return clamp((x - e0) / (e1 - e0), 0.0, 1.0);
}
float remap(float v, float a, float b, float c, float d) {
  return c + (v - a) * (d - c) / (b - a);
}

mat3 rotateY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c,0,s, 0,1,0, -s,0,c);
}
mat3 rotateX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1,0,0, 0,c,-s, 0,s,c);
}
mat3 rotateAxis(vec3 axis, float angle) {
  float s = sin(angle), c = cos(angle), oc = 1.0 - c;
  return mat3(
    oc*axis.x*axis.x+c,           oc*axis.x*axis.y-axis.z*s, oc*axis.z*axis.x+axis.y*s,
    oc*axis.x*axis.y+axis.z*s,    oc*axis.y*axis.y+c,         oc*axis.y*axis.z-axis.x*s,
    oc*axis.z*axis.x-axis.y*s,    oc*axis.y*axis.z+axis.x*s,  oc*axis.z*axis.z+c
  );
}
float easeIn(float x, float e) { return pow(max(x,0.0), e); }
`;

// ── VERTEX SHADER ADDITIONS ─────────────────────────────────────────────────
const GRASS_VSH_DECL = /* glsl */`
in float vertIndex;

uniform float time;
uniform vec3  playerPos;
uniform vec3  uGrassDark;
uniform vec3  uGrassMid;
uniform vec3  uGrassTip;
uniform float uGrassHeightScale;  // blade height multiplier (live)
uniform float uGrassDensity;      // 0..1, blades with hash > this are hidden

out vec3  vGrassColour;
out vec2  vAlphaUV;
out float vHeightPct;

// Biome noise helpers (mirrors the ground shader)
float bHashG(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
float bNoiseG(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(
    mix(bHashG(i), bHashG(i+vec2(1,0)), u.x),
    mix(bHashG(i+vec2(0,1)), bHashG(i+vec2(1,1)), u.x),
    u.y);
}
// Returns 0=grass 1=rock 2=sand 3=dust (simplified for culling)
float biomeGrassWeight(vec2 xz) {
  float bWarm  = bNoiseG(xz * 0.0018 + vec2(200.0, 200.0)) * 2.0 - 1.0;
  float bMoist = bNoiseG(xz * 0.0022 + vec2(400.0, 400.0)) * 2.0 - 1.0;
  // Grass weight: moist + cool
  return smoothstep(-0.5, 0.2, bMoist) * smoothstep(0.5, -0.2, bWarm);
}

${NOISE_GLSL}
`;

const GRASS_VSH_BODY = /* glsl */`
// ── Blade root world position ─────────────────────────────────────────────
vec3 bladeRoot = vec3(position.x, position.y, position.z);
vec3 bladeWorld = (modelMatrix * vec4(bladeRoot, 1.0)).xyz;

// ── Per-blade hash values ──────────────────────────────────────────────────
vec4 h4 = hash42(bladeWorld.xz);
float randomAngle  = h4.x * 6.28318;
float randomShade  = remap(h4.y, 0.0, 1.0, 0.7, 1.0);
float randomHeight = remap(h4.z, 0.0, 1.0, 0.75, 1.5);
float randomLean   = remap(h4.w, 0.0, 1.0, 0.08, 0.32);

// ── Which of the 3 crossing planes this vertex belongs to ─────────────────
float fVI        = float(vertIndex);
float vertsPerPlane = float(${VERTS_PER_PLANE});
float planeIdx   = floor(fVI / vertsPerPlane);
float localVI    = mod(fVI, vertsPerPlane);

// Plane orientation: 0°, 60°, 120° — makes a Y-shape from above
float planeRot   = planeIdx * (3.14159265 / float(${GRASS_PLANES}));

// ── Vertex position within the strip ──────────────────────────────────────
float xSide      = mod(localVI, 2.0);
float heightPct  = (localVI - xSide) / (float(${GRASS_SEGMENTS}) * 2.0);
vHeightPct       = heightPct;

float totalH     = ${GRASS_HEIGHT.toFixed(2)} * randomHeight * uGrassHeightScale;
float totalW     = ${GRASS_WIDTH.toFixed(2)} * (1.0 - heightPct * 0.8); // taper toward tip

float bladeX     = (xSide - 0.5) * totalW;
float bladeY     = heightPct * totalH;

// ── Curvature (lean over) ─────────────────────────────────────────────────
float leanAnim   = noise12(vec2(time * 1.2) + bladeWorld.xz * 109.3) * 0.08;
float curveAmt   = -(randomLean + leanAnim) * easeIn(heightPct, 2.0);
vec3 bladePt     = rotateX(curveAmt) * vec3(bladeX, bladeY, 0.0);

// ── Wind (dual-layer FBM for organic feel) ────────────────────────────────
float windBase   = windFBM(bladeWorld.xz * 0.18 + time * 0.9);
float windDetail = windFBM(bladeWorld.xz * 0.55 + time * 1.4 + vec2(3.1, 7.9));
float windStr    = (windBase * 0.65 + windDetail * 0.35) * 1.3;
float windDir    = noise12(bladeWorld.xz * 0.04 + 0.03 * time) * 6.28318;
vec3  windAxis   = vec3(cos(windDir), 0.0, sin(windDir));
float windAngle  = windStr * easeIn(heightPct, 2.0) * 0.9;

// ── Player proximity push ──────────────────────────────────────────────────
float distToPlayer  = distance(bladeWorld.xz, playerPos.xz);
float playerFalloff = smoothstep(2.5, 0.8, distToPlayer);
float playerAngle   = mix(0.0, 0.9, playerFalloff);
vec3  toPlayer      = normalize(bladeWorld - vec3(playerPos.x, bladeWorld.y, playerPos.z));
vec3  playerAxis    = vec3(-toPlayer.z, 0.0, toPlayer.x);

// ── Combine rotations: plane + blade random + wind + player ───────────────
//   1. Per-plane Y rotation (0°/60°/120°)
//   2. Per-blade random Y rotation
//   3. Wind lean
//   4. Player push
mat3 grassMat =
  rotateAxis(playerAxis, playerAngle) *
  rotateAxis(windAxis, windAngle) *
  rotateY(randomAngle + planeRot);

vec3 finalPos  = grassMat * bladePt + bladeRoot;

// Cull underwater / city-zone blades (pushed down by CPU)
if (bladeRoot.y < -3.0) finalPos.y -= 200.0;

// Density culling — shader-side, no rebuild needed
if (h4.w > uGrassDensity) finalPos.y -= 500.0;

// Biome culling — grass only appears in grass biome
float grassW = biomeGrassWeight(bladeWorld.xz);
// Stochastic threshold: blade appears only if its hash < grassWeight
// This gives a smooth population fade at biome edges
if (h4.x > grassW) finalPos.y -= 500.0;

// ── Alpha UV for texture lookup ────────────────────────────────────────────
// xSide maps to U (0=left, 1=right), heightPct maps to V (0=tip, 1=root)
vAlphaUV = vec2(xSide, 1.0 - heightPct);

// ── Grass colour gradient: dark root → mid → bright tip ──────────────────
vec3 midColor = mix(uGrassDark, uGrassMid, smoothstep(0.0, 0.4, heightPct));
vGrassColour  = mix(midColor, uGrassTip, easeIn(heightPct, 2.0)) * randomShade;

// Declare objectNormal (normally declared inside <beginnormal_vertex>, which we replaced)
// 'transformed' is declared separately via the <begin_vertex> replacement below
vec3 objectNormal = grassMat * vec3(0.0, 0.0, 1.0);
`;

// ── FRAGMENT SHADER ADDITIONS ───────────────────────────────────────────────
const GRASS_FSH_DECL = /* glsl */`
in vec3  vGrassColour;
in vec2  vAlphaUV;
in float vHeightPct;

uniform sampler2D uAlphaMap;
`;

const GRASS_FSH_BODY = /* glsl */`
// Sample procedural alpha texture for soft silhouette
float alpha = texture2D(uAlphaMap, vAlphaUV).a;

// Discard below threshold (replaces transparent rendering)
if (alpha < 0.18) discard;

diffuseColor.rgb = vGrassColour;
diffuseColor.a   = alpha;
`;

// ── GEOMETRY ────────────────────────────────────────────────────────────────
function createGrassGeometry(cx, cz, chunkSize) {
  const indices = [];

  // Build index buffer for all 3 planes × N segments
  for (let p = 0; p < GRASS_PLANES; p++) {
    const base = p * VERTS_PER_PLANE;
    for (let seg = 0; seg < GRASS_SEGMENTS; seg++) {
      const vi = base + seg * 2;
      // Front face
      indices.push(vi+0, vi+1, vi+2,  vi+2, vi+1, vi+3);
      // Back face (double-sided)
      indices.push(vi+2, vi+1, vi+0,  vi+3, vi+1, vi+2);
    }
  }

  // Per-vertex ID (0 … TOTAL_VERTS-1), repeated for each blade instance
  const vertID = new Uint8Array(TOTAL_VERTS);
  for (let i = 0; i < TOTAL_VERTS; i++) vertID[i] = i;

  // Per-blade root positions (X=local, Y=world height, Z=local)
  const offsets = [];
  for (let i = 0; i < NUM_GRASS; i++) {
    const rx = (Math.random() - 0.5) * chunkSize;
    const rz = (Math.random() - 0.5) * chunkSize;
    const wx = cx + rx;
    const wz = cz + rz;
    const wy = isCityZone(wx, wz) ? -200 : getTerrainHeight(wx, wz);
    offsets.push(rx, wy, rz);
  }

  const offsetsF16 = offsets.map(THREE.DataUtils.toHalfFloat);

  const geo = new THREE.InstancedBufferGeometry();
  geo.instanceCount = NUM_GRASS;
  geo.setAttribute('vertIndex', new THREE.Uint8BufferAttribute(vertID, 1));
  geo.setAttribute('position',  new (class extends THREE.InstancedBufferAttribute {
    constructor(arr, item) {
      super(new Uint16Array(arr), item);
      this.isFloat16BufferAttribute = true;
    }
  })(offsetsF16, 3));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,0,0), chunkSize * 2);

  return geo;
}

// ── SHARED UNIFORMS & MATERIAL ──────────────────────────────────────────────
export const GrassUniforms = {
  time:              { value: 0.0 },
  playerPos:         { value: new THREE.Vector3(0, 0, 0) },
  uGrassDark:        { value: new THREE.Color(0x1a2e10) },  // deep root shadow
  uGrassMid:         { value: new THREE.Color(0x3a6e26) },  // mid blade
  uGrassTip:         { value: new THREE.Color(0x7ac44a) },  // bright fresh tip
  uAlphaMap:         { value: null },                        // set on first use
  uGrassHeightScale: { value: 1.0 },                         // blade height multiplier
  uGrassDensity:     { value: 0.85 },                        // 0-1, fraction visible
};

let grassMaterialBase = null;

function getGrassMaterial() {
  if (grassMaterialBase) return grassMaterialBase;

  // Ensure alpha texture is loaded
  GrassUniforms.uAlphaMap.value = getAlphaTexture();

  grassMaterialBase = new THREE.MeshStandardMaterial({
    color:       0xffffff,
    side:        THREE.DoubleSide,
    roughness:   0.85,
    alphaTest:   0.18,
    transparent: false,  // alphaTest handles cutout, no sorting needed
  });

  grassMaterialBase.onBeforeCompile = (shader) => {
    // Inject all custom uniforms
    shader.uniforms.time              = GrassUniforms.time;
    shader.uniforms.playerPos         = GrassUniforms.playerPos;
    shader.uniforms.uGrassDark        = GrassUniforms.uGrassDark;
    shader.uniforms.uGrassMid         = GrassUniforms.uGrassMid;
    shader.uniforms.uGrassTip         = GrassUniforms.uGrassTip;
    shader.uniforms.uAlphaMap         = GrassUniforms.uAlphaMap;
    shader.uniforms.uGrassHeightScale = GrassUniforms.uGrassHeightScale;
    shader.uniforms.uGrassDensity     = GrassUniforms.uGrassDensity;

    // ── Vertex shader ─────────────────────────────────────────────────────
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\n' + GRASS_VSH_DECL
    );

    // Replace normal computation chunk — computes blade geometry + sets objectNormal
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      GRASS_VSH_BODY
    );

    // Replace begin_vertex to output the final blade position
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = finalPos;'
    );

    // ── Fragment shader ───────────────────────────────────────────────────
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\n' + GRASS_FSH_DECL
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      GRASS_FSH_BODY
    );
  };

  return grassMaterialBase;
}

// ── EXPORTS ─────────────────────────────────────────────────────────────────
export function updateGrassTime(delta, playerPos) {
  GrassUniforms.time.value += delta * 0.6;
  GrassUniforms.playerPos.value.copy(playerPos);
}

/**
 * Live density control — no world rebuild needed.
 * factor: 0.0 (no grass) … 1.0 (all blades visible)
 */
export function setGrassDensity(factor) {
  GrassUniforms.uGrassDensity.value = Math.max(0.0, Math.min(1.0, factor));
}

/**
 * Live height control — no world rebuild needed.
 * scale: multiplier on base blade height (e.g. 0.5 = half height, 2.0 = double)
 */
export function setGrassHeight(scale) {
  GrassUniforms.uGrassHeightScale.value = Math.max(0.1, scale);
}

/** Call to change grass colour palette at runtime (e.g. sci-fi mode) */
export function setGrassColours(dark, mid, tip) {
  GrassUniforms.uGrassDark.value.set(dark);
  GrassUniforms.uGrassMid.value.set(mid);
  GrassUniforms.uGrassTip.value.set(tip);
}

export function generateGrassForChunk(cx, cz, chunkSize, mode) {
  if (mode !== 'realistic') return null;

  const geo  = createGrassGeometry(cx, cz, chunkSize);
  const mat  = getGrassMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = true;
  return mesh;
}
