import * as THREE from 'three';

const barkCache = {};
const leafCache = {};

function createProceduralBark(barkType, fileType) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');

  if (fileType === 'color') {
    let baseColor, stripeColor;
    if (barkType === 'birch') {
      baseColor = '#d0d0c0'; stripeColor = '#303030';
    } else if (barkType === 'pine') {
      baseColor = '#4a3525'; stripeColor = '#2a1a10';
    } else if (barkType === 'willow') {
      baseColor = '#506040'; stripeColor = '#304020';
    } else { // oak
      baseColor = '#5c483a'; stripeColor = '#3b2b20';
    }

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 512, 512);

    ctx.fillStyle = stripeColor;
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * 512;
        const w = Math.random() * 8 + 2;
        const h = Math.random() * 512;
        ctx.fillRect(x, 0, w, h);
    }
  } else if (fileType === 'normal') {
    ctx.fillStyle = '#8080ff'; // flat normal base
    ctx.fillRect(0, 0, 512, 512);
  } else if (fileType === 'roughness') {
    ctx.fillStyle = '#a0a0a0'; // high roughness
    ctx.fillRect(0, 0, 512, 512);
  } else if (fileType === 'ao') {
    ctx.fillStyle = '#ffffff'; // no AO
    ctx.fillRect(0, 0, 512, 512);
  }

  const tex = new THREE.CanvasTexture(c);
  if (fileType === 'color') {
    tex.colorSpace = THREE.SRGBColorSpace || "srgb";
  }
  return tex;
}

function createProceduralLeaf(leafType) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  ctx.clearRect(0, 0, 256, 256);

  if (leafType === 'pine') {
    ctx.strokeStyle = '#2d4c1e';
    ctx.lineWidth = 4;
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + (Math.random()-0.5)*200, 128 + (Math.random()-0.5)*200);
      ctx.stroke();
    }
  } else {
    let color = '#4a6b28';
    if (leafType === 'ash') color = '#557a2b';
    if (leafType === 'aspen') color = '#6b8e23';

    // Draw cluster of leaves for billboard
    ctx.fillStyle = color;
    for (let i = 0; i < 15; i++) {
      ctx.beginPath();
      const x = 128 + (Math.random()-0.5)*100;
      const y = 128 + (Math.random()-0.5)*100;
      const r = 20 + Math.random()*20;
      ctx.ellipse(x, y, r, r*1.5, Math.random()*Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace || "srgb";
  return tex;
}

export function getBarkTexture(barkType, fileType, scale = { x: 1, y: 1 }) {
  const key = barkType + '_' + fileType;
  if (!barkCache[key]) {
      barkCache[key] = createProceduralBark(barkType, fileType);
  }
  
  const texture = barkCache[key].clone();
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.x = scale.x;
  texture.repeat.y = 1 / scale.y;
  return texture;
}

export function getLeafTexture(leafType) {
  const key = leafType;
  if (!leafCache[key]) {
      leafCache[key] = createProceduralLeaf(leafType);
  }
  return leafCache[key];
}