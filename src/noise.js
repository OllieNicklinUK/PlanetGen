// Seeded RNG and Simplex Noise

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
