// simplex3.js — 3D simplex noise for creature vertex colour patterns.
//
// References the shared permutation tables built by rebuildNoise() in noise.js.
// Call rebuildNoise(seed) before using this module.

const _grad3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

// Local permutation tables — initialised from the world seed via initSimplex3.
let _perm      = new Uint8Array(512);
let _permMod12 = new Uint8Array(512);
let _ready     = false;

/**
 * Seed the 3D noise tables.
 * Called automatically by CreatureManager with the world seed so creature
 * colours are deterministic per-world.
 * @param {number} seed
 */
export function initSimplex3(seed) {
  // Simple LCG seeded shuffle of [0..255]
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    _perm[i]      = p[i & 255];
    _permMod12[i] = _perm[i] % 12;
  }
  _ready = true;
}

function dot3(g, x, y, z) { return g[0] * x + g[1] * y + g[2] * z; }

/**
 * 3D simplex noise, returns value in roughly [-1, 1].
 * @param {number} xin
 * @param {number} yin
 * @param {number} zin
 * @returns {number}
 */
export function simplex3(xin, yin, zin) {
  if (!_ready) initSimplex3(12345); // fallback

  const F3 = 1 / 3;
  const G3 = 1 / 6;

  const s  = (xin + yin + zin) * F3;
  const i  = Math.floor(xin + s);
  const j  = Math.floor(yin + s);
  const k  = Math.floor(zin + s);
  const t  = (i + j + k) * G3;

  const X0 = i - t, Y0 = j - t, Z0 = k - t;
  const x0 = xin - X0, y0 = yin - Y0, z0 = zin - Z0;

  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if      (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
    else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
    else               { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
  } else {
    if      (y0 < z0)  { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
    else if (x0 < z0)  { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
    else               { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
  }

  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
  const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;

  const ii = i & 255, jj = j & 255, kk = k & 255;

  let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

  let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
  if (t0 > 0) { t0 *= t0; n0 = t0*t0 * dot3(_grad3[_permMod12[ii+_perm[jj+_perm[kk]]]], x0, y0, z0); }

  let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
  if (t1 > 0) { t1 *= t1; n1 = t1*t1 * dot3(_grad3[_permMod12[ii+i1+_perm[jj+j1+_perm[kk+k1]]]], x1, y1, z1); }

  let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
  if (t2 > 0) { t2 *= t2; n2 = t2*t2 * dot3(_grad3[_permMod12[ii+i2+_perm[jj+j2+_perm[kk+k2]]]], x2, y2, z2); }

  let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
  if (t3 > 0) { t3 *= t3; n3 = t3*t3 * dot3(_grad3[_permMod12[ii+1+_perm[jj+1+_perm[kk+1]]]], x3, y3, z3); }

  return 32 * (n0 + n1 + n2 + n3); // ~[-1,1]
}

/**
 * Smooth-step mix between two values.
 * @param {number} a
 * @param {number} b
 * @param {number} t  [0,1]
 * @returns {number}
 */
export function mix(a, b, t) {
  const s = Math.max(0, Math.min(1, t));
  return a + (b - a) * s;
}

/**
 * Smoothstep remap.
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 * @returns {number}
 */
export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
