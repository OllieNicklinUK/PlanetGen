// Materials — PBR building facades: normal map, roughness map, emissive map, MeshStandardMaterial
import * as THREE from 'three';

export const MAT = {};

// ── Texture helpers ───────────────────────────────────────────────────────────

function makeTexture(canvas, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  if (srgb) tex.colorSpace = 'srgb';
  return tex;
}

// Greyscale height canvas → tangent-space normal map canvas (Sobel)
function heightToNormal(hCanvas, strength = 3.5) {
  const W = hCanvas.width, H = hCanvas.height;
  const px = hCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const nctx = out.getContext('2d');
  const nd = nctx.createImageData(W, H);

  const s = (x, y) =>
    px[(Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))) * 4] / 255;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Sobel — OpenGL tangent space: +X right, +Y up (flipY for canvas coords)
      let nx = (s(x - 1, y) - s(x + 1, y)) * strength;
      let ny = (s(x, y + 1) - s(x, y - 1)) * strength;
      let nz = 1.0;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * W + x) * 4;
      nd.data[i] = (nx * 0.5 + 0.5) * 255;
      nd.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nd.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      nd.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nd, 0, 0);
  return out;
}

// ── Building texture pack ─────────────────────────────────────────────────────
// Returns { albedo, roughness, normal, emissive } THREE.Texture objects.

// Helper: pack four canvases into a texture set
function packTextures(ac, ec, hc, rc, normalStrength = 3.5) {
  return {
    albedo:   makeTexture(ac, true),
    emissive: makeTexture(ec, true),
    roughness: makeTexture(rc, false),
    normal:   makeTexture(heightToNormal(hc, normalStrength), false),
  };
}

// ── Brick facade ───────────────────────────────────────────────────────────────
function createBrickFacade() {
  const W = 512, H = 1024, NW = 256, NH = 512;
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H;
  const a  = ac.getContext('2d');
  const ec = document.createElement('canvas'); ec.width = W; ec.height = H;
  const e  = ec.getContext('2d');
  const hc = document.createElement('canvas'); hc.width = NW; hc.height = NH;
  const hx = hc.getContext('2d');
  const rc = document.createElement('canvas'); rc.width = NW; rc.height = NH;
  const rx = rc.getContext('2d');

  const bH = 14, bW = 36, mT = 2; // brick height, width, mortar thickness
  const baseHue = 12 + Math.random() * 10; // warm red-brown

  // Draw running-bond bricks
  for (let row = 0; row * bH < H + bH; row++) {
    const yy = H - row * bH;
    const offset = (row % 2) * (bW * 0.5);
    // horizontal mortar
    a.fillStyle = `hsl(${baseHue},12%,52%)`; a.fillRect(0, yy - mT, W, mT);
    hx.fillStyle = '#888'; hx.fillRect(0, Math.round((NH / H) * yy - 1), NW, 1);
    for (let col = -1; col * bW < W + bW; col++) {
      const xx = col * bW - offset;
      // vertical mortar
      a.fillStyle = `hsl(${baseHue},12%,52%)`; a.fillRect(xx, yy - bH, mT, bH);
      // brick face — slight hue/lightness variation per brick
      const dH = (Math.random() - 0.5) * 10;
      const dL = 28 + Math.random() * 16;
      a.fillStyle = `hsl(${baseHue + dH},42%,${dL}%)`;
      a.fillRect(xx + mT, yy - bH + mT, bW - mT, bH - mT);
    }
  }
  // Window cut-outs — two per "floor" (floor height ≈ 80px)
  const floors = Math.floor(H / 80), fh = H / floors;
  const winW = 40, winH = fh * 0.52;
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (let f = 0; f < floors; f++) {
    const fy = H - (f + 1) * fh + fh * 0.18;
    const lit = Math.random() > 0.25;
    for (let c = 0; c < 5; c++) {
      const fx = 30 + c * (W / 5) + (W / 5 - winW) * 0.5;
      a.fillStyle = lit && Math.random() > 0.3 ? '#ffe8cc' : '#1a1008';
      a.fillRect(fx, fy, winW, winH);
      if (lit && Math.random() > 0.45) {
        e.fillStyle = 'rgba(255,155,55,0.4)'; e.fillRect(fx, fy, winW, winH);
      }
    }
  }
  // Roughness + height
  rx.fillStyle = 'rgb(218,218,218)'; rx.fillRect(0, 0, NW, NH); // rough brick
  hx.fillStyle = '#c0c0c0'; // brick face height
  for (let row = 0; row * bH * (NH/H) < NH + bH; row++) {
    const yy = Math.round(NH - row * bH * (NH/H));
    const offset = (row % 2) * (bW * 0.5 * (NW/W));
    for (let col = -1; col * bW * (NW/W) < NW + bW; col++) {
      const xx = Math.round(col * bW * (NW/W) - offset);
      const bwS = Math.round(bW * (NW/W)); const bhS = Math.round(bH * (NH/H));
      hx.fillStyle = '#b8b8b8'; hx.fillRect(xx + 1, yy - bhS + 1, bwS - 2, bhS - 2);
    }
  }
  return packTextures(ac, ec, hc, rc, 4.0);
}

// ── Stone masonry facade ───────────────────────────────────────────────────────
function createStoneFacade() {
  const W = 512, H = 1024, NW = 256, NH = 512;
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H;
  const a  = ac.getContext('2d');
  const ec = document.createElement('canvas'); ec.width = W; ec.height = H;
  const e  = ec.getContext('2d');
  const hc = document.createElement('canvas'); hc.width = NW; hc.height = NH;
  const hx = hc.getContext('2d');
  const rc = document.createElement('canvas'); rc.width = NW; rc.height = NH;
  const rx = rc.getContext('2d');

  const baseHue = 35 + Math.random() * 15;
  a.fillStyle = `hsl(${baseHue},8%,44%)`; a.fillRect(0, 0, W, H);
  // Stone noise — pocked / granular
  for (let i = 0; i < 10000; i++) {
    const v = (Math.random() - 0.5) * 30;
    a.fillStyle = `rgba(${128+v|0},${128+v|0},${120+v|0},0.06)`;
    a.fillRect(Math.random() * W, Math.random() * H, Math.random() * 6, Math.random() * 3);
  }
  // Stone block grid — large irregular blocks
  const rows = 22; const fh = H / rows;
  for (let row = 0; row < rows; row++) {
    const yy = row * fh;
    const offset = (row % 2) * 60;
    a.fillStyle = 'rgba(0,0,0,0.35)'; a.fillRect(0, yy, W, 2.5);
    let xx = -offset;
    while (xx < W + 80) {
      const blockW = 55 + Math.random() * 50;
      a.fillStyle = 'rgba(0,0,0,0.3)'; a.fillRect(xx, yy, 2.5, fh);
      const dL = (Math.random() - 0.5) * 12;
      a.fillStyle = `hsl(${baseHue},${6 + Math.random()*5}%,${42 + dL}%)`;
      a.fillRect(xx + 2.5, yy + 2.5, blockW - 3, fh - 3);
      xx += blockW;
    }
  }
  // Narrow arched windows
  const winRows = 8; const wfh = H / winRows;
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (let f = 0; f < winRows; f++) {
    const fy = H - (f + 1) * wfh + wfh * 0.25;
    const wh = wfh * 0.52, ww = 24;
    const lit = Math.random() > 0.3;
    for (let c = 0; c < 4; c++) {
      const fx = 40 + c * 120 + (120 - ww) * 0.5;
      a.fillStyle = lit && Math.random() > 0.4 ? '#d4c090' : '#0d0a06';
      a.fillRect(fx, fy, ww, wh);
      // arch top
      a.beginPath(); a.arc(fx + ww / 2, fy, ww / 2, Math.PI, 0);
      a.fillStyle = lit && Math.random() > 0.4 ? '#d4c090' : '#0d0a06';
      a.fill();
      if (lit && Math.random() > 0.5) { e.fillStyle = 'rgba(240,180,60,0.35)'; e.fillRect(fx, fy, ww, wh); }
    }
  }
  rx.fillStyle = 'rgb(228,228,228)'; rx.fillRect(0, 0, NW, NH);
  hx.fillStyle = '#909090'; hx.fillRect(0, 0, NW, NH);
  return packTextures(ac, ec, hc, rc, 3.0);
}

// ── Stucco facade ─────────────────────────────────────────────────────────────
function createStuccoFacade() {
  const W = 512, H = 1024, NW = 256, NH = 512;
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H;
  const a  = ac.getContext('2d');
  const ec = document.createElement('canvas'); ec.width = W; ec.height = H;
  const e  = ec.getContext('2d');
  const hc = document.createElement('canvas'); hc.width = NW; hc.height = NH;
  const hx = hc.getContext('2d');
  const rc = document.createElement('canvas'); rc.width = NW; rc.height = NH;
  const rx = rc.getContext('2d');

  // Warm ochre/terracotta/cream palette
  const palettes = [[38,45,72],[18,52,68],[45,35,82],[20,48,75]];
  const [baseHue, baseSat, baseL] = palettes[Math.floor(Math.random() * palettes.length)];
  a.fillStyle = `hsl(${baseHue},${baseSat}%,${baseL}%)`; a.fillRect(0, 0, W, H);
  // Plaster texture — fine stipple
  for (let i = 0; i < 15000; i++) {
    const v = (Math.random() - 0.5) * 14;
    a.fillStyle = `rgba(${128+v|0},${128+v|0},${100+v|0},0.04)`;
    a.fillRect(Math.random() * W, Math.random() * H, Math.random() * 3, Math.random() * 3);
  }
  // Hairline cracks (rare)
  for (let c = 0; c < 6; c++) {
    if (Math.random() > 0.35) continue;
    const cx = Math.random() * W, cy = Math.random() * H, cl = 40 + Math.random() * 80;
    a.strokeStyle = `rgba(0,0,0,0.12)`; a.lineWidth = 0.8;
    a.beginPath(); a.moveTo(cx, cy);
    a.lineTo(cx + (Math.random() - 0.5) * 20, cy + cl);
    a.stroke();
  }
  // Windows — shuttered Mediterranean style
  const floors = 8; const fh = H / floors;
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (let f = 0; f < floors; f++) {
    const fy = H - (f + 1) * fh + fh * 0.22;
    const ww = 44, wh = fh * 0.48;
    const lit = Math.random() > 0.35;
    for (let c = 0; c < 3; c++) {
      const fx = 50 + c * (W / 3) + (W / 3 - ww) / 2;
      a.fillStyle = lit && Math.random() > 0.3 ? '#ffd080' : '#120e06';
      a.fillRect(fx, fy, ww, wh);
      // Window surround / arch
      a.strokeStyle = `hsl(${baseHue},${baseSat-8}%,${baseL-18}%)`; a.lineWidth = 3;
      a.strokeRect(fx - 3, fy - 3, ww + 6, wh + 3);
      // Shutters
      a.fillStyle = `hsl(${baseHue - 5},${baseSat}%,${baseL - 20}%)`;
      a.fillRect(fx - 10, fy, 9, wh);
      a.fillRect(fx + ww + 1, fy, 9, wh);
      if (lit) { e.fillStyle = 'rgba(255,200,80,0.5)'; e.fillRect(fx, fy, ww, wh); }
    }
  }
  // Ground floor different tone + pilasters
  const g = a.createLinearGradient(0, H, 0, H * 0.88);
  g.addColorStop(0, `rgba(0,0,0,0.22)`); g.addColorStop(1, `rgba(0,0,0,0)`);
  a.fillStyle = g; a.fillRect(0, 0, W, H);
  rx.fillStyle = 'rgb(196,196,196)'; rx.fillRect(0, 0, NW, NH);
  hx.fillStyle = '#989898'; hx.fillRect(0, 0, NW, NH);
  return packTextures(ac, ec, hc, rc, 1.8);
}

// ── Aluminium panel facade ─────────────────────────────────────────────────────
function createAluminiumFacade() {
  const W = 512, H = 1024, NW = 256, NH = 512;
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H;
  const a  = ac.getContext('2d');
  const ec = document.createElement('canvas'); ec.width = W; ec.height = H;
  const e  = ec.getContext('2d');
  const hc = document.createElement('canvas'); hc.width = NW; hc.height = NH;
  const hx = hc.getContext('2d');
  const rc = document.createElement('canvas'); rc.width = NW; rc.height = NH;
  const rx = rc.getContext('2d');

  const hue = 200 + Math.random() * 20;
  const panelH = 52 + Math.floor(Math.random() * 20); // panel row height
  const panelW = 128; // horizontal panel width
  a.fillStyle = `hsl(${hue},6%,62%)`; a.fillRect(0, 0, W, H);

  // Horizontal panel bands
  for (let yy = 0; yy < H; yy += panelH) {
    const row = Math.floor(yy / panelH);
    const offset = (row % 2) * (panelW * 0.5);
    const lightness = 58 + Math.random() * 12;
    a.fillStyle = `hsl(${hue},5%,${lightness}%)`;
    a.fillRect(0, yy + 1.5, W, panelH - 3);
    // Vertical seams
    for (let xx = -offset; xx < W + panelW; xx += panelW) {
      a.fillStyle = `hsl(${hue},4%,40%)`; a.fillRect(xx, yy, 1.5, panelH);
    }
    // Horizontal seam shadow
    a.fillStyle = 'rgba(0,0,0,0.25)'; a.fillRect(0, yy, W, 1.5);
    a.fillStyle = 'rgba(255,255,255,0.12)'; a.fillRect(0, yy + 1.5, W, 1);
    // Height for normals — seam recessed
    const hn = Math.round((yy / H) * NH);
    hx.fillStyle = '#a0a0a0'; hx.fillRect(0, hn, NW, 1);
    hx.fillStyle = '#c0c0c0'; hx.fillRect(0, hn + 1, NW, Math.round(panelH * (NH/H)) - 2);
  }
  // Strip windows flush with panels
  const winH = panelH * 0.42, wCols = 5;
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (let yy = panelH; yy < H - panelH; yy += panelH * 2) {
    const lit = Math.random() > 0.2;
    for (let c = 0; c < wCols; c++) {
      const ww = W / wCols - 8, fx = c * (W / wCols) + 4;
      const fy = yy + (panelH - winH) * 0.5;
      a.fillStyle = lit && Math.random() > 0.25 ? 'rgba(140,190,220,0.9)' : '#08121c';
      a.fillRect(fx, fy, ww, winH);
      if (lit) { e.fillStyle = 'rgba(100,170,220,0.55)'; e.fillRect(fx, fy, ww, winH); }
    }
  }
  // Roughness — smooth metallic
  rx.fillStyle = 'rgb(90,90,90)'; rx.fillRect(0, 0, NW, NH);
  for (let i = 0; i < 800; i++) {
    const v = (Math.random() - 0.5) * 18;
    const cv = (90 + v) | 0;
    rx.fillStyle = `rgba(${cv},${cv},${cv},0.4)`;
    rx.fillRect(Math.random() * NW, Math.random() * NH, Math.random() * 8, Math.random() * 2);
  }
  const p = packTextures(ac, ec, hc, rc, 2.5);
  p.metalness = 0.55;
  return p;
}

// ── Dark glass curtain wall ───────────────────────────────────────────────────
function createDarkGlassFacade() {
  const W = 512, H = 1024, NW = 256, NH = 512;
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H;
  const a  = ac.getContext('2d');
  const ec = document.createElement('canvas'); ec.width = W; ec.height = H;
  const e  = ec.getContext('2d');
  const hc = document.createElement('canvas'); hc.width = NW; hc.height = NH;
  const hx = hc.getContext('2d');
  const rc = document.createElement('canvas'); rc.width = NW; rc.height = NH;
  const rx = rc.getContext('2d');

  const hue = 200 + Math.random() * 20;
  const floors = 20 + Math.floor(Math.random() * 8);
  const fh = H / floors;
  const cols = 8;
  const fw = W / cols;
  // Very dark tinted glass base
  a.fillStyle = `hsl(${hue},25%,7%)`; a.fillRect(0, 0, W, H);
  // Subtle horizontal gradient — reflections
  const g = a.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(40,80,100,0.12)');
  g.addColorStop(0.5, 'rgba(60,110,140,0.18)');
  g.addColorStop(1, 'rgba(20,50,70,0.08)');
  a.fillStyle = g; a.fillRect(0, 0, W, H);

  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (let f = 0; f < floors; f++) {
    const fy = H - (f + 1) * fh;
    // Thin spandrel bar
    a.fillStyle = `hsl(${hue},20%,11%)`; a.fillRect(0, fy, W, fh * 0.08);
    // Vertical mullions
    for (let c = 0; c <= cols; c++) {
      a.fillStyle = `hsl(${hue},15%,14%)`; a.fillRect(c * fw - 1.5, fy, 3, fh);
    }
    // Glass pane — per-pane lighting chance
    const floorLit = Math.random() > 0.15;
    for (let c = 0; c < cols; c++) {
      if (floorLit && Math.random() > 0.3) {
        e.fillStyle = `rgba(60,160,220,0.35)`; e.fillRect(c * fw + 2, fy + fh * 0.1, fw - 4, fh * 0.88);
      }
    }
    // Height: spandrel raised
    const hn = Math.round((fy / H) * NH);
    hx.fillStyle = '#b0b0b0'; hx.fillRect(0, hn, NW, Math.round(fh * 0.08 * (NH/H)));
    hx.fillStyle = '#606060'; hx.fillRect(0, hn + Math.round(fh * 0.08 * (NH/H)), NW, Math.round(fh * 0.92 * (NH/H)));
  }
  // Roughness — very smooth (glass ~0.05 → grey 13)
  rx.fillStyle = 'rgb(13,13,13)'; rx.fillRect(0, 0, NW, NH);
  for (let f = 0; f <= floors; f++) {
    const hn = Math.round((f / floors) * NH);
    rx.fillStyle = 'rgb(70,70,70)'; rx.fillRect(0, hn, NW, Math.round(fh * 0.08 * (NH/H)));
  }
  const p = packTextures(ac, ec, hc, rc, 2.0);
  p.metalness = 0.75;
  return p;
}

// ── Weathered wood facade ─────────────────────────────────────────────────────
function createWoodFacade() {
  const W = 512, H = 1024, NW = 256, NH = 512;
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H;
  const a  = ac.getContext('2d');
  const ec = document.createElement('canvas'); ec.width = W; ec.height = H;
  const e  = ec.getContext('2d');
  const hc = document.createElement('canvas'); hc.width = NW; hc.height = NH;
  const hx = hc.getContext('2d');
  const rc = document.createElement('canvas'); rc.width = NW; rc.height = NH;
  const rx = rc.getContext('2d');

  const baseHue = 25 + Math.random() * 12;
  a.fillStyle = `hsl(${baseHue},34%,35%)`; a.fillRect(0, 0, W, H);
  // Wood grain — tight horizontal lines
  const grainCount = 220;
  for (let i = 0; i < grainCount; i++) {
    const yy = Math.random() * H;
    const dL = (Math.random() - 0.5) * 18;
    const len = 80 + Math.random() * (W - 80);
    const xx = Math.random() * (W - len);
    a.strokeStyle = `hsl(${baseHue + (Math.random()-0.5)*6},32%,${35+dL}%)`;
    a.lineWidth = 0.8 + Math.random() * 1.4;
    a.beginPath(); a.moveTo(xx, yy); a.lineTo(xx + len, yy + (Math.random()-0.5)*1.5); a.stroke();
  }
  // Plank separators — horizontal every ~80px
  const plankH = 64 + Math.floor(Math.random() * 20);
  for (let yy = 0; yy < H; yy += plankH) {
    a.fillStyle = `hsl(${baseHue},25%,20%)`; a.fillRect(0, yy, W, 2);
    a.fillStyle = `hsl(${baseHue},25%,45%)`; a.fillRect(0, yy + 2, W, 1);
  }
  // Weathering — vertical streaks
  for (let i = 0; i < 12; i++) {
    const xx = Math.random() * W; const sh = 60 + Math.random() * 200;
    const sg = a.createLinearGradient(xx, Math.random() * H * 0.7, xx, Math.random() * H * 0.7 + sh);
    sg.addColorStop(0, 'rgba(0,0,0,0.12)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = sg; a.fillRect(xx - 3, 0, 7, H);
  }
  // Small deep-set windows
  const floors = 7; const fh = H / floors;
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (let f = 0; f < floors; f++) {
    const fy = H - (f + 1) * fh + fh * 0.25;
    const ww = 38, wh = fh * 0.45;
    const lit = Math.random() > 0.35;
    for (let c = 0; c < 3; c++) {
      const fx = 55 + c * (W / 3) + (W / 3 - ww) / 2;
      a.fillStyle = `hsl(${baseHue},28%,16%)`; a.fillRect(fx - 4, fy - 4, ww + 8, wh + 8); // deep reveal
      a.fillStyle = lit && Math.random() > 0.3 ? '#ffd4a0' : '#100c06';
      a.fillRect(fx, fy, ww, wh);
      if (lit) { e.fillStyle = 'rgba(255,180,80,0.45)'; e.fillRect(fx, fy, ww, wh); }
    }
  }
  // Roughness — high (wood)
  rx.fillStyle = 'rgb(210,210,210)'; rx.fillRect(0, 0, NW, NH);
  hx.fillStyle = '#909090'; hx.fillRect(0, 0, NW, NH);
  for (let i = 0; i < grainCount; i++) {
    const hn = Math.round(Math.random() * NH);
    hx.fillStyle = `rgba(${128+(Math.random()-0.5)*30|0},${128+(Math.random()-0.5)*30|0},${128+(Math.random()-0.5)*30|0},0.6)`;
    hx.fillRect(0, hn, NW, 1);
  }
  return packTextures(ac, ec, hc, rc, 2.2);
}

// ── Dark sandstone / terracotta ────────────────────────────────────────────────
function createSandstoneFacade() {
  const W = 512, H = 1024, NW = 256, NH = 512;
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H;
  const a  = ac.getContext('2d');
  const ec = document.createElement('canvas'); ec.width = W; ec.height = H;
  const e  = ec.getContext('2d');
  const hc = document.createElement('canvas'); hc.width = NW; hc.height = NH;
  const hx = hc.getContext('2d');
  const rc = document.createElement('canvas'); rc.width = NW; rc.height = NH;
  const rx = rc.getContext('2d');

  // Warm deep palette — terracotta, burnt sienna, ochre
  const palettes = [[18,52,32],[28,48,28],[12,58,36],[22,44,30]];
  const [baseHue, baseSat, baseL] = palettes[Math.floor(Math.random() * palettes.length)];
  a.fillStyle = `hsl(${baseHue},${baseSat}%,${baseL}%)`; a.fillRect(0, 0, W, H);

  // Sand / aggregate grain
  for (let i = 0; i < 12000; i++) {
    const v = (Math.random() - 0.5) * 20;
    a.fillStyle = `rgba(${128+v|0},${80+(v*0.5)|0},${50+(v*0.3)|0},0.06)`;
    a.fillRect(Math.random() * W, Math.random() * H, Math.random() * 4, Math.random() * 2.5);
  }
  // Horizontal course lines (sandstone layering)
  const courseH = 18 + Math.floor(Math.random() * 10);
  for (let yy = courseH; yy < H; yy += courseH) {
    a.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.06})`; a.fillRect(0, yy, W, 1.5);
    a.fillStyle = `rgba(255,200,120,0.06)`;                       a.fillRect(0, yy + 1.5, W, 1);
    const hn = Math.round((yy / H) * NH);
    hx.fillStyle = '#909090'; hx.fillRect(0, hn, NW, 1);
    hx.fillStyle = '#b4b4b4'; hx.fillRect(0, hn + 1, NW, Math.round(courseH * (NH/H)) - 1);
  }
  // Occasional darker vertical streaks — weathering / mineral bleed
  for (let i = 0; i < 8; i++) {
    const xx = Math.random() * W;
    const sg = a.createLinearGradient(xx, 0, xx, H * 0.6);
    sg.addColorStop(0, 'rgba(0,0,0,0.14)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = sg; a.fillRect(xx - 4, 0, 9, H);
  }
  // Deep-set arched windows — two columns
  const floors = 9; const fh = H / floors;
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (let f = 0; f < floors; f++) {
    const fy = H - (f + 1) * fh + fh * 0.24;
    const ww = 50, wh = fh * 0.50;
    const lit = Math.random() > 0.30;
    for (let c = 0; c < 4; c++) {
      const fx = 28 + c * (W / 4) + (W / 4 - ww) / 2;
      // Deep reveal surround
      a.fillStyle = `hsl(${baseHue},${baseSat}%,${baseL - 14}%)`;
      a.fillRect(fx - 5, fy - 5, ww + 10, wh + 6);
      a.fillStyle = lit && Math.random() > 0.3 ? '#ffd090' : '#0d0804';
      a.fillRect(fx, fy, ww, wh);
      // Arch
      a.beginPath(); a.arc(fx + ww / 2, fy, ww / 2, Math.PI, 0);
      a.fillStyle = `hsl(${baseHue},${baseSat}%,${baseL - 14}%)`;
      a.fill();
      a.beginPath(); a.arc(fx + ww / 2, fy, ww / 2 - 5, Math.PI, 0);
      a.fillStyle = lit && Math.random() > 0.3 ? '#ffd090' : '#0d0804';
      a.fill();
      if (lit) { e.fillStyle = 'rgba(255,175,60,0.42)'; e.fillRect(fx, fy - ww/2 + 5, ww, wh + ww/2 - 5); }
    }
  }
  // Ground floor grime
  const g = a.createLinearGradient(0, H, 0, H * 0.88);
  g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  a.fillStyle = g; a.fillRect(0, 0, W, H);

  rx.fillStyle = 'rgb(215,215,215)'; rx.fillRect(0, 0, NW, NH); // sandy rough
  return packTextures(ac, ec, hc, rc, 3.5);
}

// ── Window-grid facade (original 3 styles — glass curtain, brutalist, classic) ─

function createWindowGridFacade(mode, index) {
  const W = 512, H = 1024;
  const NW = 256, NH = 512; // smaller res for normal + roughness
  const isSciFi = mode === 'scifi';

  // Three architectural styles cycling across the 6 variants
  // 0 = glass curtain wall  1 = concrete brutalist  2 = classic grid
  const style = index % 3;
  const hue = (index * 51 + 17) % 360;

  // ── Layout parameters ──
  const floors = 16 + Math.floor(Math.random() * 10);
  const colsByStyle = [11, 5, 8];
  const cols = colsByStyle[style] + Math.floor(Math.random() * 3);
  const fw = W / cols, fh = H / floors;
  const spR = [0.14, 0.44, 0.28][style]; // spandrel height ratio
  const pilR = [0.07, 0.19, 0.12][style]; // pilaster width ratio
  const spH = fh * spR, pilW = fw * pilR;

  // Window bounds within a cell
  const winOffX = fw * (pilR / 2 + 0.07);
  const winOffY = spH + fh * 0.06;
  const winW = fw * (1 - pilR - 0.14);
  const winH = fh * (1 - spR - 0.10);

  // Concrete lightness
  const baseL = isSciFi ? 8 + index * 4 : 28 + index * 6;

  // ── ALBEDO ────────────────────────────────────────────────────────────────
  const ac = document.createElement('canvas');
  ac.width = W; ac.height = H;
  const a = ac.getContext('2d');

  // Concrete base
  a.fillStyle = isSciFi
    ? `hsl(${hue},18%,${baseL}%)`
    : `hsl(${hue},7%,${baseL}%)`;
  a.fillRect(0, 0, W, H);

  // Fine concrete noise
  for (let i = 0; i < 6000; i++) {
    const v = (Math.random() - 0.5) * 22;
    const sz = Math.random() * 4 + 1;
    a.fillStyle = `rgba(${(128 + v) | 0},${(128 + v) | 0},${(128 + v) | 0},0.045)`;
    a.fillRect(Math.random() * W, Math.random() * H, sz, sz * 0.6);
  }

  // Horizontal spandrel panels (slightly lighter than base)
  for (let f = 0; f <= floors; f++) {
    const py = H - f * fh;
    const sl = isSciFi ? baseL + 5 : baseL + 8;
    a.fillStyle = isSciFi ? `hsl(${hue},15%,${sl}%)` : `hsl(${hue},6%,${sl}%)`;
    a.fillRect(0, py - spH, W, spH);
    // Shadow undercut line
    a.fillStyle = 'rgba(0,0,0,0.28)';
    a.fillRect(0, py - spH - 1.5, W, 2);
  }

  // Vertical pilasters
  for (let c = 0; c <= cols; c++) {
    const px = c * fw - pilW / 2;
    const pl = isSciFi ? baseL + 3 : baseL + 5;
    a.fillStyle = isSciFi ? `hsl(${hue},14%,${pl}%)` : `hsl(${hue},5%,${pl}%)`;
    a.fillRect(px, 0, pilW, H);
  }

  // Windows
  for (let f = 0; f < floors; f++) {
    const floorLitChance = Math.random();
    const fy = H - (f + 1) * fh + winOffY;
    const isGround = f === 0;

    for (let c = 0; c < cols; c++) {
      const fx = c * fw + winOffX;
      const isLit = floorLitChance > 0.12 && Math.random() > 0.3;

      if (isLit) {
        if (isSciFi) {
          a.fillStyle = Math.random() > 0.65 ? '#4FD8F5' : '#1a6888';
          a.shadowBlur = 16; a.shadowColor = '#4FD8F5';
        } else {
          const rnd = Math.random();
          a.fillStyle = rnd > 0.65 ? '#ffe8cc' : rnd > 0.3 ? '#e2b878' : '#c9a060';
          a.shadowBlur = 12; a.shadowColor = '#ff9944';
        }
      } else {
        a.fillStyle = isSciFi
          ? `hsl(${hue + 10},40%,6%)`
          : `hsl(${hue + 5},20%,9%)`;
        a.shadowBlur = 0;
      }

      const wW = isGround ? winW * 1.05 : winW;
      const wH = isGround ? fh * 0.82 : winH;
      const wY = isGround ? H - fh + fh * 0.09 : fy;
      a.fillRect(fx, wY, wW, wH);
      a.shadowBlur = 0;

      // Mullions (skip for glass curtain style)
      if (!isGround && style !== 0) {
        a.fillStyle = isSciFi ? 'rgba(15,28,44,0.85)' : 'rgba(8,8,8,0.65)';
        a.fillRect(fx + wW / 2 - 0.9, wY, 1.8, wH);
        if (Math.random() > 0.4) a.fillRect(fx, wY + wH * 0.5 - 0.9, wW, 1.8);
      }
    }
  }

  // Weathering: water stains below windows (realistic mode only)
  if (!isSciFi) {
    for (let f = 1; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() > 0.28) continue;
        const sx = c * fw + fw * 0.5 + (Math.random() - 0.5) * fw * 0.5;
        const sy = H - f * fh + winOffY + winH;
        const sh = fh * (0.6 + Math.random() * 1.8);
        const g = a.createLinearGradient(sx, sy, sx, sy + sh);
        g.addColorStop(0, 'rgba(0,0,0,0.18)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        a.fillStyle = g;
        a.fillRect(sx - 2, sy, 5, sh);
      }
    }
  }

  // Ground-floor grime
  {
    const g = a.createLinearGradient(0, H, 0, H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0.38)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = g;
    a.fillRect(0, 0, W, H);
  }

  // ── EMISSIVE (lit windows only, all else black) ───────────────────────────
  const ec = document.createElement('canvas');
  ec.width = W; ec.height = H;
  const e = ec.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);

  for (let f = 0; f < floors; f++) {
    if (Math.random() > 0.7) continue;
    const fy = H - (f + 1) * fh + winOffY;
    for (let c = 0; c < cols; c++) {
      if (Math.random() > 0.5) continue;
      e.fillStyle = isSciFi ? 'rgba(50,190,230,0.55)' : 'rgba(255,155,55,0.45)';
      e.fillRect(c * fw + winOffX, fy, winW, winH);
    }
  }

  // ── HEIGHT CANVAS (source for normal map, drawn at half-res) ──────────────
  const hc = document.createElement('canvas');
  hc.width = NW; hc.height = NH;
  const hx = hc.getContext('2d');
  const nfw = NW / cols, nfh = NH / floors;
  const nSpH = nfh * spR, nPilW = nfw * pilR;
  const nWinOffX = nfw * (pilR / 2 + 0.07);
  const nWinOffY = nSpH + nfh * 0.06;
  const nWinW = nfw * (1 - pilR - 0.14);
  const nWinH = nfh * (1 - spR - 0.10);

  // Wall face = mid height
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, NW, NH);

  // Spandrels slightly proud
  for (let f = 0; f <= floors; f++) {
    const py = NH - f * nfh;
    hx.fillStyle = '#a8a8a8'; hx.fillRect(0, py - nSpH, NW, nSpH);
    hx.fillStyle = '#d4d4d4'; hx.fillRect(0, py - nSpH - 1, NW, 2); // sharp top ledge
  }

  // Pilasters proud
  for (let c = 0; c <= cols; c++) {
    hx.fillStyle = '#b2b2b2';
    hx.fillRect(c * nfw - nPilW / 2, 0, nPilW, NH);
  }

  // Windows recessed
  for (let f = 0; f < floors; f++) {
    const fy = NH - (f + 1) * nfh + nWinOffY;
    for (let c = 0; c < cols; c++) {
      hx.fillStyle = '#1e1e1e';
      hx.fillRect(c * nfw + nWinOffX, fy, nWinW, nWinH);
    }
  }

  // Window sills (proud ledge at window bottom)
  for (let f = 0; f < floors; f++) {
    const sy = NH - (f + 1) * nfh + nWinOffY + nWinH;
    for (let c = 0; c < cols; c++) {
      hx.fillStyle = '#cccccc';
      hx.fillRect(c * nfw + nWinOffX - 2, sy, nWinW + 4, Math.max(2, nfh * 0.07));
    }
  }

  // ── ROUGHNESS MAP ─────────────────────────────────────────────────────────
  const rc = document.createElement('canvas');
  rc.width = NW; rc.height = NH;
  const rx = rc.getContext('2d');

  // Concrete base ~0.83 → grey 212
  rx.fillStyle = 'rgb(212,212,212)'; rx.fillRect(0, 0, NW, NH);

  // Spandrel ~0.89 → grey 227
  for (let f = 0; f <= floors; f++) {
    const py = NH - f * nfh;
    rx.fillStyle = 'rgb(227,227,227)'; rx.fillRect(0, py - nSpH, NW, nSpH);
  }

  // Pilasters ~0.77 → grey 196
  for (let c = 0; c <= cols; c++) {
    rx.fillStyle = 'rgb(196,196,196)';
    rx.fillRect(c * nfw - nPilW / 2, 0, nPilW, NH);
  }

  // Windows (glass) ~0.06 → grey 15
  for (let f = 0; f < floors; f++) {
    const fy = NH - (f + 1) * nfh + nWinOffY;
    for (let c = 0; c < cols; c++) {
      rx.fillStyle = 'rgb(15,15,15)';
      rx.fillRect(c * nfw + nWinOffX, fy, nWinW, nWinH);
    }
  }

  // Roughness surface noise
  for (let i = 0; i < 1500; i++) {
    const v = (Math.random() - 0.5) * 25;
    const cv = ((212 + v) | 0);
    rx.fillStyle = `rgba(${cv},${cv},${cv},0.35)`;
    rx.fillRect(Math.random() * NW, Math.random() * NH, Math.random() * 5, Math.random() * 3);
  }

  // ── NORMAL MAP from height ────────────────────────────────────────────────
  const normalCanvas = heightToNormal(hc, style === 1 ? 5.0 : 3.5);

  return {
    albedo: makeTexture(ac, true),
    emissive: makeTexture(ec, true),
    roughness: makeTexture(rc, false), // linear — not a colour
    normal: makeTexture(normalCanvas, false), // linear — vector field
  };
}

// ── Dispatcher — 10 distinct material types ───────────────────────────────────
// 0-2: window-grid variants (glass curtain / brutalist / classic)
// 3: brick   4: stone   5: stucco   6: aluminium   7: dark glass
// 8: wood    9: modern pale concrete
function createBuildingTexturePack(mode, index) {
  switch (index % 10) {
    case 0: case 1: case 2: return createWindowGridFacade(mode, index % 3);
    case 3: return createBrickFacade();
    case 4: return createStoneFacade();
    case 5: return createStuccoFacade();
    case 6: return createAluminiumFacade();
    case 7: return createDarkGlassFacade();
    case 8: return createWoodFacade();
    case 9: return createSandstoneFacade();
    default: return createWindowGridFacade(mode, 0);
  }
}

// ── Ground texture (unchanged) ────────────────────────────────────────────────
function createGroundTexture(mode) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');

  ctx.fillStyle = mode === 'scifi' ? '#0a1020' : '#3a4030';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 8000; i++) {
    const v = Math.random() * 255;
    ctx.fillStyle = `rgba(${v},${v},${v},0.04)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, Math.random() * 4, Math.random() * 4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = 'srgb';
  return tex;
}

// ── Road texture (unchanged) ──────────────────────────────────────────────────
function createRoadTexture(mode) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');

  ctx.fillStyle = mode === 'scifi' ? '#060c18' : '#252520';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, Math.random() * 3, Math.random() * 3);
  }

  ctx.fillStyle = mode === 'scifi' ? 'rgba(79,216,245,0.4)' : 'rgba(255,255,255,0.3)';
  for (let y = 0; y < 512; y += 40) {
    ctx.fillRect(252, y, 8, 20);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = 'srgb';
  return tex;
}

// ── Material builder ──────────────────────────────────────────────────────────
export function buildMaterials(mode) {
  const groundTex = createGroundTexture(mode);
  const roadTex = createRoadTexture(mode);
  const isSciFi = mode === 'scifi';

  // ─────────────────────────────────────────────────────────────────────────────
  // BIOME GROUND MATERIAL
  // 5 terrain types blended via low-freq noise independent of height:
  //   0 = Grass  1 = Rock   2 = Sand   3 = Dust/Dirt   4 = Cliff (steep override)
  // ─────────────────────────────────────────────────────────────────────────────
  const BIOME_GROUND_GLSL = /* glsl */`

  // ── Noise primitives ──────────────────────────────────────────────────────
  float bHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float bNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(
      mix(bHash(i), bHash(i+vec2(1,0)), u.x),
      mix(bHash(i+vec2(0,1)), bHash(i+vec2(1,1)), u.x),
      u.y);
  }
  float bFbm(vec2 p, int oct) {
    float v=0.0, a=0.5;
    for(int i=0;i<6;i++){
      if(i>=oct) break;
      v += a * bNoise(p); p *= 2.1; a *= 0.5;
    }
    return v;
  }

  // ── Biome weights at a world XZ position ─────────────────────────────────
  // Returns vec4(wGrass, wRock, wSand, wDust) that sum ~1.0
  // Cliff is handled separately via steepness mask
  vec4 biomeWeights(vec2 xz) {
    // Two independent low-freq noise axes (offsets avoid correlation with height)
    float bWarm  = bNoise(xz * 0.0018 + vec2(200.0, 200.0)) * 2.0 - 1.0;
    float bMoist = bNoise(xz * 0.0022 + vec2(400.0, 400.0)) * 2.0 - 1.0;

    // Soft assignments using smooth ramp width of ~0.3
    float wGrass = smoothstep(-0.5, 0.2,  bMoist) * smoothstep( 0.5,-0.2, bWarm);
    float wRock  = smoothstep( 0.1,-0.4,  bMoist) * smoothstep( 0.4,-0.2, bWarm);
    float wSand  = smoothstep( 0.2, 0.8,  bWarm)  * smoothstep(-0.1, 0.4, bMoist);
    float wDust  = smoothstep( 0.0, 0.6,  bWarm)  * smoothstep( 0.2,-0.3, bMoist);

    // Normalise so they sum to 1
    float total = wGrass + wRock + wSand + wDust + 0.001;
    return vec4(wGrass, wRock, wSand, wDust) / total;
  }

  // ── Surface scatter detail ────────────────────────────────────────────────
  // Cheap high-freq noise for surface texture variation
  float surfaceDetail(vec2 p, float scale) {
    return bFbm(p * scale, 3) * 2.0 - 1.0;
  }
  `;

  const setupBiomeGround = (shader) => {
    // ── Vertex: pass world XZ and normal ──────────────────────────────────
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      out vec3 vBiomeWorldPos;
      out vec3 vBiomeNormal;`
    );
    // In super-three r181 (and Three.js r155+), `worldPosition` inside the
    // worldpos_vertex chunk is only defined under `#ifdef USE_ENVMAP`.
    // Compute world position from `transformed` + `modelMatrix` instead —
    // both are always available in the vertex shader.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vBiomeWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vBiomeNormal   = normalize((modelMatrix * vec4(normal, 0.0)).xyz);`
    );

    // ── Fragment: biome blend + cliff override ────────────────────────────
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      in vec3 vBiomeWorldPos;
      in vec3 vBiomeNormal;
      ${BIOME_GROUND_GLSL}`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `{
        vec2 xz = vBiomeWorldPos.xz;
        float worldY = vBiomeWorldPos.y;

        // ── Steepness → cliff mask ──────────────────────────────────────
        float steepness = 1.0 - clamp(vBiomeNormal.y, 0.0, 1.0);
        float cliffMask = smoothstep(0.42, 0.68, steepness);

        // ── Biome weights ───────────────────────────────────────────────
        vec4 bw = biomeWeights(xz);
        float wGrass = bw.x;
        float wRock  = bw.y;
        float wSand  = bw.z;
        float wDust  = bw.w;

        // ── High-frequency surface detail noise ─────────────────────────
        float detailLarge = surfaceDetail(xz, 0.035); // large clumps
        float detailFine  = surfaceDetail(xz, 0.12);  // fine grain
        float detail = detailLarge * 0.6 + detailFine * 0.4;

        // Height influence: higher = dryer / more rocky
        float heightFactor = smoothstep(-10.0, 60.0, worldY);

        // ── Per-biome colour (base + dark + highlight) ──────────────────

        // GRASS — lush green, darker hollows
        vec3 grassBase = vec3(0.22, 0.32, 0.13);
        vec3 grassDark = vec3(0.10, 0.16, 0.06);
        vec3 grassHigh = vec3(0.38, 0.50, 0.20);
        vec3 grassCol  = mix(grassDark, mix(grassBase, grassHigh, smoothstep(-0.3,0.6,detail)), smoothstep(-1.0,1.0,detail));
        // Height bleach: brown at altitude
        grassCol = mix(grassCol, vec3(0.32,0.26,0.14), heightFactor * 0.45);

        // ROCK — grey, brownish at altitude
        vec3 rockBase  = vec3(0.36, 0.34, 0.30);
        vec3 rockDark  = vec3(0.18, 0.17, 0.15);
        vec3 rockHigh  = vec3(0.52, 0.50, 0.44);
        vec3 rockCol   = mix(rockDark, mix(rockBase, rockHigh, smoothstep(-0.2,0.7,detail)), smoothstep(-1.0,1.0,detail));
        // Warm tint at low altitude
        rockCol = mix(rockCol, rockCol * vec3(1.1,1.0,0.85), (1.0-heightFactor)*0.3);

        // SAND — warm gold, ripple detail
        float ripple = sin(xz.x*0.18 + detail*2.0) * 0.5 + 0.5;
        vec3 sandBase  = vec3(0.72, 0.60, 0.36);
        vec3 sandDark  = vec3(0.52, 0.42, 0.24);
        vec3 sandHigh  = vec3(0.88, 0.78, 0.54);
        vec3 sandCol   = mix(sandDark, mix(sandBase, sandHigh, ripple), smoothstep(-0.5,0.8,detail));

        // DUST / DIRT — dry ochre-brown
        vec3 dustBase  = vec3(0.50, 0.36, 0.20);
        vec3 dustDark  = vec3(0.30, 0.22, 0.12);
        vec3 dustHigh  = vec3(0.64, 0.48, 0.28);
        vec3 dustCol   = mix(dustDark, mix(dustBase, dustHigh, smoothstep(-0.3,0.7,detailFine)), smoothstep(-1.0,1.0,detailLarge));
        // Crack pattern at surface: slightly darker fine veins
        float cracks = step(0.88, bNoise(xz * 0.25)) * 0.4;
        dustCol = mix(dustCol, dustDark * 0.7, cracks);

        // CLIFF — dark charcoal-grey rock with lighter ridges
        vec3 cliffBase = vec3(0.28, 0.26, 0.24);
        vec3 cliffDark = vec3(0.12, 0.11, 0.10);
        vec3 cliffHigh = vec3(0.45, 0.43, 0.38);
        vec3 cliffCol  = mix(cliffDark, mix(cliffBase, cliffHigh, smoothstep(-0.1,0.8,detailLarge)), steepness);

        // ── Blend all biomes ────────────────────────────────────────────
        vec3 biomeColor = grassCol * wGrass
                        + rockCol  * wRock
                        + sandCol  * wSand
                        + dustCol  * wDust;

        // Cliff overrides everything based on steepness
        vec3 finalGround = mix(biomeColor, cliffCol, cliffMask);

        // ── Snow cap at very high altitudes ─────────────────────────────
        float snowMask = smoothstep(55.0, 80.0, worldY) * (1.0 - cliffMask * 0.6);
        snowMask *= smoothstep(-0.05, 0.2, vBiomeNormal.y); // only on flat tops
        vec3 snowCol = vec3(0.88, 0.90, 0.95) * mix(1.0, 0.95, detailFine * 0.5 + 0.5);
        finalGround = mix(finalGround, snowCol, snowMask);

        diffuseColor.rgb *= finalGround;
      }`
    );
  };

  // ── Terrain + roads ──────────────────────────────────────────────────────
  MAT.ground = new THREE.MeshPhongMaterial({ shininess: 0 });
  MAT.ground.onBeforeCompile = setupBiomeGround;

  MAT.road = new THREE.MeshPhongMaterial({
    map: roadTex,
    shininess: isSciFi ? 60 : 8,
    ...(isSciFi ? { emissive: new THREE.Color(0x001228), emissiveIntensity: 1 } : {}),
  });

  // ── Shared city materials — now MeshStandardMaterial ──
  MAT.pavement = new THREE.MeshStandardMaterial({
    color: isSciFi ? 0x0c1428 : 0x484840,
    roughness: 0.92, metalness: 0.0,
    ...(isSciFi ? { emissive: new THREE.Color(0x040810), emissiveIntensity: 0.6 } : {}),
  });

  MAT.roof = new THREE.MeshStandardMaterial({
    color: isSciFi ? 0x080e1c : 0x252522,
    roughness: 0.87,
    metalness: isSciFi ? 0.2 : 0.05,
    ...(isSciFi ? { emissive: new THREE.Color(0x001828), emissiveIntensity: 0.6 } : {}),
  });

  // Glass — MeshStandardMaterial: smooth, mildly metallic for reflections
  MAT.glass = new THREE.MeshStandardMaterial({
    color: isSciFi ? 0x00b3e3 : 0x88b8d8,
    roughness: 0.05,
    metalness: isSciFi ? 0.8 : 0.45,
    transparent: true,
    opacity: isSciFi ? 0.5 : 0.62,
    envMapIntensity: 2.2,
  });

  // Floor ledges / balcony slabs (new material, concrete coloured)
  MAT.ledge = new THREE.MeshStandardMaterial({
    color: isSciFi ? 0x0a1422 : 0x3a3a38,
    roughness: 0.85,
    metalness: isSciFi ? 0.25 : 0.04,
  });

  // Sci-fi strips & antenna
  MAT.strip = new THREE.MeshBasicMaterial({ color: isSciFi ? 0x4FD8F5 : 0xffee88 });
  MAT.ant = new THREE.MeshStandardMaterial({
    color: isSciFi ? 0x1a3048 : 0x606060,
    roughness: isSciFi ? 0.25 : 0.45,
    metalness: isSciFi ? 0.9 : 0.6,
  });

  // ── Building facade materials (PBR with all four maps) ──
  MAT.bld = [];
  for (let i = 0; i < 10; i++) {
    const pack = createBuildingTexturePack(mode, i);
    MAT.bld.push(new THREE.MeshStandardMaterial({
      map: pack.albedo,
      roughnessMap: pack.roughness,
      normalMap: pack.normal,
      normalScale: new THREE.Vector2(isSciFi ? 1.2 : 1.0, isSciFi ? 1.2 : 1.0),
      emissiveMap: pack.emissive,
      emissive: isSciFi ? new THREE.Color(0x4FD8F5) : new THREE.Color(0xff9944),
      emissiveIntensity: isSciFi ? 0.1 : 0.3,
      roughness: 1.0,            // driven by roughnessMap
      metalness: pack.metalness ?? 0.0,  // aluminium / dark glass can opt in
    }));
  }
}
