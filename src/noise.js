// Seeded RNG and Simplex Noise — from viverse-city-world + Simon Dev's noise approach

export class SeededRNG {
  constructor(seed) {
    this._seed = seed;
    this._state = seed;
  }

  next() {
    this._state |= 0;
    this._state = this._state + 0x6D2B79F5 | 0;
    let t = Math.imul(this._state ^ this._state >>> 15, 1 | this._state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  static fromChunk(seed, cx, cz) {
    return new SeededRNG(seed ^ (cx * 73856093) ^ (cz * 19349663));
  }
}

const _grad3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
];

let _perm, _permMod12;

export function rebuildNoise(seed) {
  const r = new SeededRNG(seed);
  const p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  _perm = new Uint8Array(512);
  _permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    _perm[i] = p[i & 255];
    _permMod12[i] = _perm[i] % 12;
  }
}

function _dot(g, x, y) { return g[0] * x + g[1] * y; }

export function simplex2(xin, yin) {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const X0 = i - t, Y0 = j - t;
  const x0 = xin - X0, y0 = yin - Y0;
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * _dot(_grad3[_permMod12[ii + _perm[jj]]], x0, y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * _dot(_grad3[_permMod12[ii + i1 + _perm[jj + j1]]], x1, y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * _dot(_grad3[_permMod12[ii + 1 + _perm[jj + 1]]], x2, y2); }
  return 70 * (n0 + n1 + n2);
}

export function fbm(x, y, octaves = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    v += a * simplex2(x * f, y * f);
    a *= 0.5;
    f *= 2;
  }
  return v;
}

export const TERRAIN_CONFIG = {
  heightScale: 60,      // Terrain height amplitude
  terrainDetail: 5,     // Feature scale (1=large, 10=detailed); freq = detail * 0.0006
  octaves: 5,           // Noise octaves (1–8)
  cityDensity: 50,      // 0–100; threshold = 0.6 - density*0.01
};

// ── Safe spawn zone ───────────────────────────────────────────────────────────
// Guarantees a flat, open, building-free area around the world origin so the
// player always lands somewhere navigable.  Blends smoothly into the natural
// world beyond SAFE_OUTER so there is no visible cliff or seam.
const SAFE_INNER  = 40;   // metres — fully flat within this radius (lobby safe zone)
const SAFE_OUTER  = 80;   // metres — blended back to natural terrain by this radius
const SAFE_HEIGHT = 2.0;  // metres — terrain Y inside the safe zone (above sea level)
const CITY_CLEAR  = 50;   // metres — no buildings spawn within this radius

function _smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function getTerrainHeight(wx, wz) {
  const { heightScale, terrainDetail, octaves, cityDensity } = TERRAIN_CONFIG;
  const freq = terrainDetail * 0.0006;
  const threshold = 0.6 - cityDensity * 0.01;
  let h = fbm(wx * freq, wz * freq, octaves) * heightScale;
  const flat = fbm(wx * 0.001 + 50, wz * 0.001 + 50, 2);
  if (flat > threshold) h = h + (4 - h) * Math.min(1, (flat - threshold) * 5);

  // Safe spawn zone: override height near origin
  const dist = Math.hypot(wx, wz);
  if (dist < SAFE_INNER) return SAFE_HEIGHT;
  if (dist < SAFE_OUTER) return SAFE_HEIGHT + _smoothstep(SAFE_INNER, SAFE_OUTER, dist) * (h - SAFE_HEIGHT);

  return h;
}

export function isCityZone(wx, wz) {
  // Keep buildings out of the player spawn area
  if (Math.hypot(wx, wz) < CITY_CLEAR) return false;
  const threshold = 0.6 - TERRAIN_CONFIG.cityDensity * 0.01;
  return fbm(wx * 0.001 + 50, wz * 0.001 + 50, 2) > threshold;
}

// ── Biome system ──────────────────────────────────────────────────────────────
// Two orthogonal low-frequency noise axes produce a 2D biome map.
// Offsets (+200, +400) keep biome noise independent from height noise.
export const BIOME = { GRASS: 0, ROCK: 1, SAND: 2, DUST: 3, CLIFF: 4 };

export function getBiome(wx, wz) {
  // Biome scale: patches ~400-600 units wide
  const bx = simplex2(wx * 0.0018 + 200, wz * 0.0018 + 200); // -1..1
  const bz = simplex2(wx * 0.0022 + 400, wz * 0.0022 + 400);
  // Also use terrain steepness proxy
  const steep = Math.abs(fbm(wx * 0.003, wz * 0.003, 2));

  // Cliff: very steep areas, independent of noise patch
  if (steep > 0.45) return BIOME.CLIFF;

  // 2D biome map using bx/bz quadrants + smooth mixing
  const warm = bx;            // warm positive = sand/dust; negative = grass/rock
  const moist = bz;           // moist positive = grass; negative = rock/dust

  if (warm > 0.25)  return moist > 0.0 ? BIOME.SAND : BIOME.DUST;
  if (warm < -0.2)  return moist > 0.1 ? BIOME.GRASS : BIOME.ROCK;
  // Transition zone
  return moist > 0.15 ? BIOME.GRASS : (warm > 0.0 ? BIOME.DUST : BIOME.ROCK);
}
