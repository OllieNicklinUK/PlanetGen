// ═══════════════════════════════════════════════════════════════════════════════
// PROJECT HUB — Light Playground & Creator Mode
// Uses the existing FPS controls / physics from src/fps/*
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { BvhPhysicsWorld, SimpleCharacter, loadCharacterModel, loadCharacterAnimation, WalkAnimationUrl } from '@pmndrs/viverse';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { HubHostAvatar } from './hub-host-avatar.js';
import GUI from 'lil-gui';

// Register three-mesh-bvh extensions (required before BVH physics)
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


// ─── Destinations ────────────────────────────────────────────────────────────
// Full catalog of every demo/level available in the project
const ALL_DEMOS = [
  { label: 'Splat World',        desc: '3DGS Explorer',       url: '/index.html?level=3',   color: '#ff44ff', icon: 'splat',      category: 'game' },
  { label: 'Prop Library',       desc: 'Meshy AI Assets',     url: '/library.html',         color: '#ffaa00', icon: 'gem',        category: 'tool' },
  { label: 'Google Maps → 3DGS', desc: 'Google 3D Tiles',     url: '/tile-test.html',       color: '#00ffff', icon: 'voxel',      category: 'world' },
  { label: 'Warehouse CQB',      desc: 'Room Clearing',       url: '/index.html?level=6',   color: '#64c8ff', icon: 'warehouse',  category: 'training' },
  { label: 'Game Creator',       desc: 'AI Wizard',           url: null,                    color: '#aa55ff', icon: 'rocket',     category: 'creator' },
];

// ─── Scene setup ─────────────────────────────────────────────────────────────
const clock    = new THREE.Clock();
const scene    = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('hub-canvas'),
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;

// Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.rotation.order = 'YXZ';
camera.position.set(0, 2, 0);
scene.add(camera);

// ─── Lighting & Sky (Premium Twilight Showroom) ────────────────────────────
// Sky shader — gorgeous twilight gradient
const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);

const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 2;
skyUniforms['rayleigh'].value = 1.5;
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.85;

// Sun position — low on horizon for warm twilight glow
const sunPos = new THREE.Vector3();
const phi = THREE.MathUtils.degToRad(88);    // just above horizon
const theta = THREE.MathUtils.degToRad(200); // angle around
sunPos.setFromSphericalCoords(1, phi, theta);
skyUniforms['sunPosition'].value.copy(sunPos);

// ── Volumetric Fog & Atmospherics ──
// Exponential fog that fades edges seamlessly into the sky
scene.fog = new THREE.FogExp2(0x0c1228, 0.012);

// ── Procedural Starfield ──
const STAR_COUNT = 2000;
const starPositions = new Float32Array(STAR_COUNT * 3);
const starSizes = new Float32Array(STAR_COUNT);
for (let i = 0; i < STAR_COUNT; i++) {
  const r = 400 + Math.random() * 600;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  starPositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
  starPositions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 20;
  starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  starSizes[i] = 0.5 + Math.random() * 2.5;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
const starMat = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 1.5,
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
});
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

const ambient = new THREE.AmbientLight(0x8899bb, 1.8);
scene.add(ambient);

const hemiLight = new THREE.HemisphereLight(0x6688dd, 0x223344, 2.0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xccddff, 2.5);
dirLight.position.set(20, 50, 30);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 150;
dirLight.shadow.camera.left = -50;
dirLight.shadow.camera.right = 50;
dirLight.shadow.camera.top = 50;
dirLight.shadow.camera.bottom = -50;
dirLight.shadow.bias = -0.001;
scene.add(dirLight);

// Central fill light — illuminates the hub area
const fillLight = new THREE.PointLight(0x7788cc, 3.0, 60, 1.5);
fillLight.position.set(0, 12, 0);
scene.add(fillLight);

// Secondary warm accent fill from below
const warmFill = new THREE.PointLight(0x7c5cff, 1.5, 40, 2);
warmFill.position.set(0, 1, 0);
scene.add(warmFill);

// ── Atmospheric ground fog particles ──
const fogParticleCount = 200;
const fogPositions = new Float32Array(fogParticleCount * 3);
for (let i = 0; i < fogParticleCount; i++) {
  fogPositions[i * 3]     = (Math.random() - 0.5) * 70;
  fogPositions[i * 3 + 1] = Math.random() * 1.5;
  fogPositions[i * 3 + 2] = (Math.random() - 0.5) * 70;
}
const fogGeo = new THREE.BufferGeometry();
fogGeo.setAttribute('position', new THREE.BufferAttribute(fogPositions, 3));
const fogMat = new THREE.PointsMaterial({
  color: 0x4455aa, size: 3.0, transparent: true, opacity: 0.06,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
});
const fogCloud = new THREE.Points(fogGeo, fogMat);
scene.add(fogCloud);


// ─── Playground Geometry Maker ───────────────────────────────────────────────
const world = new BvhPhysicsWorld();
const interactables = []; // Objects the player can press E on
const floatingObjects = []; // Objects that float/bob
const particleSystems = []; // Per-portal particle rings

// ─── Map Construction (Showroom) ───────────────────────────────────
const gridCanvas = document.createElement('canvas');
gridCanvas.width = 1024;
gridCanvas.height = 1024;
const ctxLoader = gridCanvas.getContext('2d');
// Premium dark floor with subtle hex grid
ctxLoader.fillStyle = '#0a0a0f';
ctxLoader.fillRect(0, 0, 1024, 1024);
ctxLoader.strokeStyle = 'rgba(100, 140, 255, 0.08)';
ctxLoader.lineWidth = 1;
const hexR = 32;
for (let row = 0; row < 40; row++) {
  for (let col = 0; col < 40; col++) {
    const cx = col * hexR * 1.75 + (row % 2 ? hexR * 0.875 : 0);
    const cy = row * hexR * 1.5;
    ctxLoader.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i - Math.PI / 6;
      const px = cx + hexR * Math.cos(a);
      const py = cy + hexR * Math.sin(a);
      i === 0 ? ctxLoader.moveTo(px, py) : ctxLoader.lineTo(px, py);
    }
    ctxLoader.closePath();
    ctxLoader.stroke();
  }
}
const gridTex = new THREE.CanvasTexture(gridCanvas);
gridTex.wrapS = THREE.RepeatWrapping;
gridTex.wrapT = THREE.RepeatWrapping;
gridTex.repeat.set(8, 8);

function createBoxMat(colorHex, isFloor=false) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    roughness: isFloor ? 0.6 : 0.3,
    metalness: isFloor ? 0.4 : 0.6
  });
  if (isFloor) {
    mat.map = gridTex;
    mat.color.setHex(0xffffff);
  }
  return mat;
}

function addBlock(x, y, z, sx, sy, sz, colorHex, isFloor=false) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const mat = createBoxMat(colorHex, isFloor);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  world.addBody(mesh, false);
  return mesh;
}

// Main floor — large dark showroom
addBlock(0, -0.5, 0, 80, 1, 80, '#0a0a0f', true);

// No more visible walls — fog handles the edge blending now

// ─── 3D Icon Builders — Each returns a THREE.Group ──────────────────────────
function buildIcon_crosshair(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.1 });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), mat));
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), mat);
    arm.position.y = 0.35;
    const pivot = new THREE.Group();
    pivot.rotation.z = (Math.PI / 2) * i;
    pivot.add(arm);
    g.add(pivot);
  }
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 16, 32), mat));
  return g;
}

function buildIcon_ship(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 0.8, roughness: 0.2 });
  const hull = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.0, 4), mat);
  hull.rotation.x = Math.PI / 2;
  hull.rotation.y = Math.PI / 4;
  g.add(hull);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.15), mat);
  bridge.position.set(0, 0.2, -0.1);
  g.add(bridge);
  const wake = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.02, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 })
  );
  wake.rotation.x = Math.PI / 2;
  wake.position.y = -0.15;
  g.add(wake);
  return g;
}

function buildIcon_splat(color) {
  const g = new THREE.Group();
  const count = 12;
  for (let i = 0; i < count; i++) {
    const r = 0.08 + Math.random() * 0.15;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 12),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).offsetHSL(Math.random() * 0.2 - 0.1, 0, 0),
        emissive: color, emissiveIntensity: 0.3,
        transparent: true, opacity: 0.5 + Math.random() * 0.3,
        metalness: 0.1, roughness: 0.8
      })
    );
    sphere.position.set(
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.6
    );
    g.add(sphere);
  }
  return g;
}

function buildIcon_voxel(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.7, roughness: 0.2 });
  const wireMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, wireframe: true });
  const sizes = [[0.3, 0.5, 0.3], [0.25, 0.8, 0.25], [0.35, 0.35, 0.35], [0.2, 0.6, 0.2]];
  const offsets = [[-0.2, 0, -0.15], [0.2, 0, 0.1], [0, 0, 0.25], [-0.05, 0, -0.3]];
  sizes.forEach((s, i) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(...s), mat);
    box.position.set(offsets[i][0], s[1] / 2 - 0.3, offsets[i][2]);
    box.add(new THREE.Mesh(new THREE.BoxGeometry(s[0]+0.01, s[1]+0.01, s[2]+0.01), wireMat));
    g.add(box);
  });
  return g;
}

function buildIcon_gem(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.4,
    metalness: 1.0, roughness: 0.05, transparent: true, opacity: 0.85
  });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), mat);
  gem.scale.y = 1.3;
  g.add(gem);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), sparkMat);
    const a = (i / 5) * Math.PI * 2;
    sp.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.3, 0);
    g.add(sp);
  }
  return g;
}

function buildIcon_atom(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.1 });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), mat));
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
  [0, Math.PI / 3, -Math.PI / 3].forEach((tilt, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.015, 8, 48), ringMat);
    ring.rotation.x = tilt;
    ring.rotation.y = (i * Math.PI) / 4;
    g.add(ring);
    const electron = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), mat);
    electron.position.x = 0.45;
    ring.add(electron);
  });
  return g;
}

function buildIcon_shield(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.2, side: THREE.DoubleSide });
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);
  shape.quadraticCurveTo(0.45, 0.4, 0.45, 0);
  shape.quadraticCurveTo(0.45, -0.3, 0, -0.55);
  shape.quadraticCurveTo(-0.45, -0.3, -0.45, 0);
  shape.quadraticCurveTo(-0.45, 0.4, 0, 0.5);
  const extGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 });
  const shield = new THREE.Mesh(extGeo, mat);
  shield.position.z = -0.04;
  g.add(shield);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  star.position.z = 0.06;
  g.add(star);
  return g;
}

function buildIcon_bolt(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.3, side: THREE.DoubleSide });
  const shape = new THREE.Shape();
  shape.moveTo(-0.05, 0.5);
  shape.lineTo(0.15, 0.5);
  shape.lineTo(0.0, 0.1);
  shape.lineTo(0.2, 0.1);
  shape.lineTo(-0.1, -0.55);
  shape.lineTo(0.05, -0.05);
  shape.lineTo(-0.15, -0.05);
  const extGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
  g.add(new THREE.Mesh(extGeo, mat));
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.55, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
  );
  g.add(halo);
  return g;
}

function buildIcon_warehouse(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.6, roughness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), mat);
  body.position.y = -0.05;
  g.add(body);
  const roofGeo = new THREE.BufferGeometry();
  const rv = new Float32Array([
    -0.4, 0.2, -0.3,  0.4, 0.2, -0.3,  0, 0.45, -0.3,
    -0.4, 0.2,  0.3,  0.4, 0.2,  0.3,  0, 0.45,  0.3,
    -0.4, 0.2, -0.3, -0.4, 0.2,  0.3,  0, 0.45,  0.3,
     0, 0.45, -0.3, -0.4, 0.2, -0.3,  0, 0.45,  0.3,
     0.4, 0.2, -0.3,  0.4, 0.2,  0.3,  0, 0.45,  0.3,
     0, 0.45, -0.3,  0.4, 0.2, -0.3,  0, 0.45,  0.3
  ]);
  roofGeo.setAttribute('position', new THREE.BufferAttribute(rv, 3));
  roofGeo.computeVertexNormals();
  g.add(new THREE.Mesh(roofGeo, accentMat));
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.35), accentMat);
  door.position.set(0, -0.12, 0.301);
  g.add(door);
  return g;
}

function buildIcon_rocket(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.1 });
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.7, 16), mat);
  g.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 16), mat);
  nose.position.y = 0.5;
  g.add(nose);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 });
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.18), finMat);
    fin.position.y = -0.3;
    const pivot = new THREE.Group();
    pivot.rotation.y = (Math.PI * 2 / 3) * i;
    fin.position.x = 0.15;
    pivot.add(fin);
    g.add(pivot);
  }
  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.25, 12),
    new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.6 })
  );
  exhaust.position.y = -0.47;
  exhaust.rotation.x = Math.PI;
  g.add(exhaust);
  return g;
}

// ─── Icon builder dispatch ───────────────────────────────────────────────────
const ICON_BUILDERS = {
  crosshair: buildIcon_crosshair,
  ship: buildIcon_ship,
  splat: buildIcon_splat,
  voxel: buildIcon_voxel,
  gem: buildIcon_gem,
  atom: buildIcon_atom,
  shield: buildIcon_shield,
  bolt: buildIcon_bolt,
  warehouse: buildIcon_warehouse,
  rocket: buildIcon_rocket,
};

// ─── Create Particle Ring around a portal pedestal ───────────────────────────
function createParticleRing(parent, color, radius = 1.4, count = 30) {
  const positions = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    positions[i * 3]     = Math.cos(a) * radius;
    positions[i * 3 + 1] = Math.random() * 0.5;
    positions[i * 3 + 2] = Math.sin(a) * radius;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color, size: 0.06, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.position.y = 0.8;
  parent.add(points);
  return { points, positions, count };
}

// ─── Build All Demo Portals ──────────────────────────────────────────────────
const deskHoloRef = { mesh: null }; // Keep ref for animation
const portalGroups = [];  // Track portal groups for re-layout
const portalSpots = [];   // Track spotlight refs for re-layout

function createDemoPortal(x, z, def) {
  const pGrp = new THREE.Group();
  pGrp.position.set(x, 0, z);
  scene.add(pGrp);

  // ── Hexagonal pedestal base ──
  const pedGeo = new THREE.CylinderGeometry(1.3, 1.5, 0.6, 6);
  const pedMat = new THREE.MeshStandardMaterial({
    color: 0x111118, metalness: 0.9, roughness: 0.15,
    emissive: new THREE.Color(def.color), emissiveIntensity: 0.05
  });
  const pedestal = new THREE.Mesh(pedGeo, pedMat);
  pedestal.position.y = 0.3;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  pGrp.add(pedestal);
  world.addBody(pedestal, false);

  // ── Glow ring on top of pedestal ──
  const glowRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.04, 8, 64),
    new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.8 })
  );
  glowRing.rotation.x = Math.PI / 2;
  glowRing.position.y = 0.62;
  pGrp.add(glowRing);

  // ── Secondary inner ring ──
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.02, 8, 48),
    new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.4 })
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.63;
  pGrp.add(innerRing);

  // ── Spotlight ──
  const spot = new THREE.SpotLight(new THREE.Color(def.color), 40, 15, 0.45, 0.6, 1);
  spot.position.set(x, 7, z);
  spot.target = pedestal;
  scene.add(spot);
  portalSpots.push(spot);

  // ── Ground glow disc ──
  const glowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.8, 32),
    new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.08, side: THREE.DoubleSide })
  );
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.y = 0.02;
  pGrp.add(glowDisc);

  // ── Particle ring ──
  const pSys = createParticleRing(pGrp, def.color);
  particleSystems.push(pSys);

  // ── Label — Dark text with white glow for bright sky readability ──
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const cx = c.getContext('2d');
  const catColors = { game: '#882233', world: '#005566', tool: '#226633', training: '#665500', creator: '#553388' };
  const catLabels = { game: 'GAME', world: 'WORLD', tool: 'TOOL', training: 'TRAINING', creator: 'CREATE' };

  // Background halo for readability
  cx.fillStyle = 'rgba(255,255,255,0.5)';
  cx.beginPath();
  cx.roundRect(60, 5, 392, 145, 16);
  cx.fill();

  cx.fillStyle = catColors[def.category] || '#444';
  cx.font = 'bold 16px monospace';
  cx.textAlign = 'center';
  cx.fillText(catLabels[def.category] || '', 256, 28);

  // Main label — dark text with white outer glow
  cx.shadowColor = 'rgba(255,255,255,0.9)';
  cx.shadowBlur = 12;
  cx.fillStyle = '#111';
  cx.font = 'bold 38px Orbitron, sans-serif';
  cx.fillText(def.label, 256, 80);
  cx.fillText(def.label, 256, 80); // double-pass for stronger glow
  cx.shadowBlur = 0;

  cx.font = '20px Inter, sans-serif';
  cx.fillStyle = '#333';
  cx.fillText(def.desc, 256, 118);

  cx.strokeStyle = '#555';
  cx.lineWidth = 1;
  cx.globalAlpha = 0.4;
  cx.beginPath();
  cx.moveTo(140, 135);
  cx.lineTo(372, 135);
  cx.stroke();
  cx.globalAlpha = 1;

  const labelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 1.0),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, side: THREE.DoubleSide })
  );
  labelMesh.position.y = 3.6;
  pGrp.add(labelMesh);

  // ── Build the 3D icon ──
  const builder = ICON_BUILDERS[def.icon];
  const iconMesh = builder ? builder(def.color) : buildIcon_gem(def.color);
  iconMesh.position.y = 1.8;
  iconMesh.scale.setScalar(1.2);
  pGrp.add(iconMesh);
  floatingObjects.push(iconMesh);

  // ── Interaction ──
  const isWizard = def.icon === 'rocket' && !def.url;
  const interactable = {
    worldPos: new THREE.Vector3(x, 0, z),
    triggerRadius: 3.5,
    name: def.label.toUpperCase(),
    hint: isWizard
      ? 'Press <span class="key">E</span> to Open AI Wizard'
      : 'Press <span class="key">E</span> to Launch',
    colorHex: def.color,
    onInteract: () => {
      if (isWizard) {
        window.openWizard();
        return;
      }
      if (def.url) {
        document.body.style.transition = 'opacity 0.8s';
        document.body.style.opacity = '0';
        const warpInterval = setInterval(() => {
          camera.fov += 2;
          camera.updateProjectionMatrix();
        }, 16);
        setTimeout(() => {
          clearInterval(warpInterval);
          window.location.href = def.url;
        }, 800);
      }
    },
    mesh: iconMesh,
    label: labelMesh
  };
  interactables.push(interactable);

  portalGroups.push({ group: pGrp, def, interactable, spot });
  return pGrp;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTAL LAYOUT ENGINE — Dynamic arrangement presets
// ═══════════════════════════════════════════════════════════════════════════════

const layoutSettings = {
  shape: 'arc',       // 'arc', 'line', 'circle', 'grid', 'v-formation'
  radius: 18,         // distance from center
  spacing: 6,         // for line/grid spacing
  yRotation: 0,       // rotate entire layout
};

function layoutPortals() {
  const count = portalGroups.length;
  if (count === 0) return;

  const positions = [];

  switch (layoutSettings.shape) {
    case 'line': {
      const totalW = (count - 1) * layoutSettings.spacing;
      for (let i = 0; i < count; i++) {
        const x = -totalW / 2 + i * layoutSettings.spacing;
        positions.push([x, -layoutSettings.radius]);
      }
      break;
    }
    case 'circle': {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        positions.push([
          Math.sin(a) * layoutSettings.radius,
          -Math.cos(a) * layoutSettings.radius,
        ]);
      }
      break;
    }
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const totalX = (cols - 1) * layoutSettings.spacing;
        const totalZ = (Math.ceil(count / cols) - 1) * layoutSettings.spacing;
        positions.push([
          -totalX / 2 + col * layoutSettings.spacing,
          -layoutSettings.radius + row * layoutSettings.spacing - totalZ / 2,
        ]);
      }
      break;
    }
    case 'v-formation': {
      const half = Math.floor(count / 2);
      for (let i = 0; i < count; i++) {
        const side = i < half ? -1 : 1;
        const idx = i < half ? i : i - half;
        const depth = idx * layoutSettings.spacing * 0.7;
        const spread = (idx + 1) * layoutSettings.spacing * 0.5;
        positions.push([side * spread, -(layoutSettings.radius + depth)]);
      }
      break;
    }
    default: { // arc
      const ARC_START = -Math.PI * 0.8;
      const ARC_END   =  Math.PI * 0.8;
      const ARC_SPAN  = ARC_END - ARC_START;
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0.5;
        const angle = ARC_START + t * ARC_SPAN;
        positions.push([
          Math.sin(angle) * layoutSettings.radius,
          -Math.cos(angle) * layoutSettings.radius,
        ]);
      }
    }
  }

  // Apply rotation offset
  const cosR = Math.cos(layoutSettings.yRotation);
  const sinR = Math.sin(layoutSettings.yRotation);

  for (let i = 0; i < count; i++) {
    const [rawX, rawZ] = positions[i];
    const x = rawX * cosR - rawZ * sinR;
    const z = rawX * sinR + rawZ * cosR;
    const pg = portalGroups[i];
    pg.group.position.set(x, 0, z);
    pg.spot.position.set(x, 7, z);
    pg.interactable.worldPos.set(x, 0, z);
  }
}

// ── Create ALL portals ──
ALL_DEMOS.forEach((demo) => {
  createDemoPortal(0, 0, demo); // positions set by layoutPortals()
});
layoutPortals(); // arrange them with default arc

// ── Central Hub Beacon — REMOVED (was a decorative ball with no interaction) ──

// ─── Avatar NPCs ─────────────────────────────────────────────────────────────
const npcs = [];
async function spawnNPC(vrmUrl, startX, startZ) {
  try {
    const model = await loadCharacterModel(vrmUrl, 'vrm');
    scene.add(model.scene);
    model.scene.position.set(startX, 0, startZ);

    const clipWalk = await loadCharacterAnimation(model, WalkAnimationUrl, undefined, true);
    const action = model.mixer.clipAction(clipWalk);
    action.play();

    npcs.push({
      model: model,
      url: vrmUrl,
      angle: Math.random() * Math.PI * 2,
      velocity: new THREE.Vector3(),
      update: function(delta) {
        this.angle += (Math.random() - 0.5) * delta;
        const speed = 1.2;
        this.velocity.set(Math.cos(this.angle) * speed, 0, Math.sin(this.angle) * speed);
        this.model.scene.position.addScaledVector(this.velocity, delta);
        
        // Face velocity — VRM models face -Z forward, flip 180°
        this.model.scene.rotation.y = Math.atan2(this.velocity.x, this.velocity.z) + Math.PI;
        
        // Bounds checking
        let px = this.model.scene.position.x;
        let pz = this.model.scene.position.z;
        if (px < -25 || px > 25 || pz < -25 || pz > 25) {
            this.angle += Math.PI;
            this.model.scene.position.x = THREE.MathUtils.clamp(px, -25, 25);
            this.model.scene.position.z = THREE.MathUtils.clamp(pz, -25, 25);
        }
        
        this.model.mixer.update(delta);
        if (this.model.update) this.model.update(delta);
      }
    });
    console.log(`🧑 NPC spawned: ${vrmUrl.split('/').pop()}`);
  } catch (err) {
    console.error("Failed to load NPC", vrmUrl, err);
  }
}

// ─── Open Source Avatar Library ──────────────────────────────────────────────
const AVATAR_LIBRARY = [
  { name: 'Orion',          url: 'https://dweb.link/ipfs/Qmed8jVF5FvBn6Jerxk8Wm5DwRjuAHRfBXgofTue37orBC/Avatar_Orion.vrm' },
  { name: 'ChubbyTubbyCat', url: 'https://dweb.link/ipfs/QmY4NQRArQaEWPgyzyTuCSvyAnBUhtsshFKPjJHbbzVKLL/ChubbyTubbyCat.vrm' },
  { name: 'MaxHax',         url: 'https://dweb.link/ipfs/QmZ5FRKE3jEAwiV2ryatqmrzcwAEa5sZrU4qqkzP9dqu7x/MaxHax.vrm' },
  { name: 'Cyborg',         url: 'https://dweb.link/ipfs/Qmed8jVF5FvBn6Jerxk8Wm5DwRjuAHRfBXgofTue37orBC/Avatar_Cyborg.vrm' },
  { name: 'CowgirlRobot',   url: 'https://dweb.link/ipfs/QmY4NQRArQaEWPgyzyTuCSvyAnBUhtsshFKPjJHbbzVKLL/CowgirlRobot.vrm' },
  { name: 'Skeleton',       url: 'https://dweb.link/ipfs/QmZ5FRKE3jEAwiV2ryatqmrzcwAEa5sZrU4qqkzP9dqu7x/Skeleton.vrm' },
];

// Spawn initial NPCs
spawnNPC(AVATAR_LIBRARY[0].url, 5, 5);
spawnNPC(AVATAR_LIBRARY[1].url, -5, 5);
spawnNPC(AVATAR_LIBRARY[2].url, 10, -5);

// ─── Hub Host Avatar (Saneko from VTubeJS) ───────────────────────────────────
const avaSettings = {
  posX: 3, posY: 0, posZ: -3,
  scale: 2.0,
  rotationY: 0.5,
  greeting: 'Welcome to Viverse Hub! I am Ava, your host.',
  spotIntensity: 60,
};

// ─── VTubeJS Server URL (for OpenAI + ElevenLabs proxy) ─────────────────────
// Live Render.com server — falls back to local VTubeJS server if unreachable
const VTUBEJS_SERVER = (() => {
  // Use Render prod by default; swap to localhost for local-only dev
  const RENDER_URL   = 'https://viverse-backend.onrender.com';
  const LOCAL_URL    = 'http://localhost:3000';
  // Check if we're running on localhost (Vite dev server)
  const isLocal = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  // Always prefer Render — it has the real API keys
  return RENDER_URL;
})();

// ─── AI Chat State ──────────────────────────────────────────────────────────
let avaChatHistory = [];
const AVA_SYSTEM_PROMPT = `You are Ava, a friendly, enthusiastic VTuber host who welcomes visitors to the Viverse Hub — a 3D interactive lobby showcasing creative projects. You help visitors explore games, tools, and worlds. Keep responses concise (2-3 sentences max), warm, and playful. Use occasional emoji.`;
let avaAudioEl = null;
let avaAudioCtx = null;
let avaAnalyser = null;

function initAvaAudio() {
  if (avaAudioEl) return;
  avaAudioEl = document.createElement('audio');
  try { avaAudioEl.crossOrigin = 'anonymous'; } catch (_) {}
  avaAudioEl.style.display = 'none';
  document.body.appendChild(avaAudioEl);

  avaAudioEl.addEventListener('play', () => {
    hubHost.setSpeaking(true, 0.6);
    // Audio analysis for lip sync
    try {
      if (!avaAudioCtx) avaAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = avaAudioCtx.createMediaElementSource(avaAudioEl);
      avaAnalyser = avaAudioCtx.createAnalyser();
      avaAnalyser.fftSize = 256;
      src.connect(avaAnalyser);
      avaAnalyser.connect(avaAudioCtx.destination);
    } catch (_) {}
  });
  avaAudioEl.addEventListener('ended', () => { hubHost.setSpeaking(false); });
  avaAudioEl.addEventListener('pause', () => { if (!avaAudioEl.ended) hubHost.setSpeaking(false); });
}

/**
 * Send a message to Ava via the VTubeJS server proxy → OpenAI.
 * Then speak the reply via ElevenLabs TTS (also proxied).
 */
async function chatWithAva(userText) {
  initAvaAudio();
  avaChatHistory.push({ role: 'user', content: userText });

  try {
    // 1. Get AI response via server proxy
    const chatResp = await fetch(`${VTUBEJS_SERVER}/api/openai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: AVA_SYSTEM_PROMPT },
          ...avaChatHistory
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!chatResp.ok) throw new Error(`OpenAI proxy error: ${chatResp.status}`);
    const chatData = await chatResp.json();
    const reply = chatData.reply || chatData.choices?.[0]?.message?.content || 'Hmm, I\'m not sure what to say!';
    avaChatHistory.push({ role: 'assistant', content: reply });

    console.log('🤖 Ava says:', reply);

    // Show speech bubble
    showAvaSpeechBubble(reply);

    // 2. TTS via ElevenLabs (server proxy)
    // API returns JSON: { audio: 'data:audio/mpeg;base64,...', alignment?, has_phonemes }
    try {
      const ttsResp = await fetch(`${VTUBEJS_SERVER}/api/elevenlabs-tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: reply,
          voice_id: 'EXAVITQu4vr4xnSDxMaL', // ElevenLabs "Sarah" — warm female voice
          model_id: 'eleven_multilingual_v2',
          with_timestamps: false,
        }),
      });
      if (ttsResp.ok) {
        const ttsData = await ttsResp.json();
        if (ttsData.audio) {
          // Server returns base64 data URI directly — just assign to src
          initAvaAudio();
          avaAudioEl.src = ttsData.audio;
          await avaAudioEl.play();
        } else {
          console.warn('ElevenLabs TTS: no audio in response', ttsData);
          speakFallback(reply);
        }
      } else {
        const errBody = await ttsResp.json().catch(() => ({}));
        console.warn('ElevenLabs TTS failed:', ttsResp.status, errBody.error);
        speakFallback(reply);
      }
    } catch (ttsErr) {
      console.warn('ElevenLabs TTS error:', ttsErr);
      speakFallback(reply);
    }

    return reply;
  } catch (err) {
    console.error('Ava chat error:', err);
    showAvaSpeechBubble('Sorry, I\'m having trouble connecting. Try again? 🤔');
    return null;
  }
}

function speakFallback(text) {
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.1; u.pitch = 1.15;
    u.onstart = () => hubHost.setSpeaking(true, 0.5);
    u.onend = () => hubHost.setSpeaking(false);
    speechSynthesis.speak(u);
  }
}

function showAvaSpeechBubble(text) {
  let bubble = document.getElementById('ava-speech');
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.id = 'ava-speech';
    document.body.appendChild(bubble);
  }
  bubble.textContent = text;
  bubble.style.cssText = `
    position:fixed; bottom:160px; left:50%; transform:translateX(-50%);
    max-width:500px; padding:18px 28px; border-radius:16px;
    background:rgba(255,255,255,0.85); backdrop-filter:blur(12px);
    color:#111; font:500 15px/1.5 'Outfit',sans-serif;
    box-shadow:0 8px 32px rgba(0,0,0,0.15); border:1px solid rgba(0,0,0,0.08);
    z-index:60; text-align:center; opacity:1; transition:opacity 0.5s;
  `;
  clearTimeout(bubble._timer);
  bubble._timer = setTimeout(() => { bubble.style.opacity = '0'; }, 8000);
}

// Expose for global access
window.chatWithAva = chatWithAva;

const hubHost = new HubHostAvatar();
let avaSpot = null;
let avaGlow = null;

hubHost.load(scene, {
  position: [avaSettings.posX, avaSettings.posY, avaSettings.posZ],
  rotationY: Math.PI + avaSettings.rotationY,
  scale: avaSettings.scale,
}).then(async (ok) => {
  if (!ok) return;
  console.log('🤖 Ava host avatar loaded into hub (2x scale)');

  // ── Load FBX idle animation for Ava ──
  try {
    const fbxLoader = new FBXLoader();
    const idleFBXUrl = '/VTubeJS_Min-master/VTubeJS_Min-master/public/fbx/Standing Idle.fbx';
    const fbx = await new Promise((resolve, reject) => {
      fbxLoader.load(idleFBXUrl, resolve, undefined, reject);
    });

    if (fbx.animations && fbx.animations.length > 0) {
      const rawClip = fbx.animations[0];

      // Retarget Mixamo bones → VRM humanoid bones
      const vrm = hubHost.vrm;
      const tracks = [];
      const mixamoMap = {
        mixamorigHips:'hips', mixamorigSpine:'spine', mixamorigSpine1:'chest',
        mixamorigSpine2:'upperChest', mixamorigNeck:'neck', mixamorigHead:'head',
        mixamorigLeftShoulder:'leftShoulder', mixamorigLeftArm:'leftUpperArm',
        mixamorigLeftForeArm:'leftLowerArm', mixamorigLeftHand:'leftHand',
        mixamorigRightShoulder:'rightShoulder', mixamorigRightArm:'rightUpperArm',
        mixamorigRightForeArm:'rightLowerArm', mixamorigRightHand:'rightHand',
        mixamorigLeftUpLeg:'leftUpperLeg', mixamorigLeftLeg:'leftLowerLeg',
        mixamorigLeftFoot:'leftFoot', mixamorigRightUpLeg:'rightUpperLeg',
        mixamorigRightLeg:'rightLowerLeg', mixamorigRightFoot:'rightFoot',
      };

      const restInverse = new THREE.Quaternion();
      const parentRest = new THREE.Quaternion();

      rawClip.tracks.forEach(track => {
        const parts = track.name.split('.');
        const mixName = parts[0];
        const vrmBone = mixamoMap[mixName];
        if (!vrmBone) return;
        const node = vrm.humanoid?.getNormalizedBoneNode(vrmBone);
        if (!node) return;
        const fbxBone = fbx.getObjectByName(mixName);
        if (!fbxBone) return;

        if (track instanceof THREE.QuaternionKeyframeTrack) {
          fbxBone.getWorldQuaternion(restInverse).invert();
          fbxBone.parent.getWorldQuaternion(parentRest);

          const vals = track.values.slice();
          const q = new THREE.Quaternion();
          for (let i = 0; i < vals.length; i += 4) {
            q.set(vals[i], vals[i+1], vals[i+2], vals[i+3]);
            q.premultiply(parentRest).multiply(restInverse);
            vals[i] = q.x; vals[i+1] = q.y; vals[i+2] = q.z; vals[i+3] = q.w;
          }
          tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, track.times, vals));
        }
      });

      if (tracks.length > 0) {
        const clip = new THREE.AnimationClip('ava_idle', rawClip.duration, tracks);
        const mixer = new THREE.AnimationMixer(vrm.scene);
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat);
        action.play();
        hubHost._fbxMixer = mixer;
        console.log(`🎬 Ava FBX idle loaded: ${tracks.length} tracks`);
      }
    }
  } catch (fbxErr) {
    console.warn('⚠️ FBX idle load for Ava failed (procedural idle still runs):', fbxErr);
  }

  // Dedicated spotlight
  avaSpot = new THREE.SpotLight(0xc4b8ff, avaSettings.spotIntensity, 20, 0.5, 0.7, 1);
  avaSpot.position.set(avaSettings.posX, 8, avaSettings.posZ);
  avaSpot.target = hubHost.vrmScene;
  avaSpot.castShadow = true;
  avaSpot.shadow.mapSize.set(1024, 1024);
  scene.add(avaSpot);

  // Ground glow beneath her (scaled up for 2x avatar)
  avaGlow = new THREE.Mesh(
    new THREE.CircleGeometry(3.0, 32),
    new THREE.MeshBasicMaterial({
      color: 0x7c5cff, transparent: true, opacity: 0.12,
      side: THREE.DoubleSide,
    })
  );
  avaGlow.rotation.x = -Math.PI / 2;
  avaGlow.position.set(avaSettings.posX, 0.02, avaSettings.posZ);
  scene.add(avaGlow);

  // Add her as an interactable — pressing E opens chat input
  interactables.push({
    worldPos: new THREE.Vector3(avaSettings.posX, avaSettings.posY, avaSettings.posZ),
    triggerRadius: 5.0,
    name: 'AVA — HOST',
    hint: 'Press <span class="key">E</span> to chat with Ava',
    colorHex: '#c4b8ff',
    onInteract: () => {
      openAvaChatInput();
    },
    mesh: hubHost.vrmScene,
    label: null,
  });

  // Build settings panel after host loads
  buildSettingsGUI();

  // ── Welcome tooltip from Ava after a brief delay ──
  setTimeout(() => {
    showAvaSpeechBubble('👋 Welcome to the Viverse Hub! Walk to a portal to explore, or come talk to me!');
  }, 2500);
});

// ─── Controls (Avatar SimpleCharacter) ──────────────────────────
const character = new SimpleCharacter(camera, world, renderer.domElement, {
  model: true,
});
scene.add(character);
character.position.set(0, 2, 0);
// Face toward portals (arc is in -Z direction)
camera.rotation.y = Math.PI; // face south toward the portal arc

let _levelActive = false;

// ─── Proximity & Interaction ─────────────────────────────────────────────────
let _nearestObj = null;
const _playerPos2D = new THREE.Vector2();
const _objPos2D    = new THREE.Vector2();
const portalHud    = document.getElementById('portal-hud');
const portalNameEl = document.getElementById('portal-name');
const portalHintEl = document.getElementById('portal-hint');

function checkProximity() {
  _playerPos2D.set(character.position.x, character.position.z);
  let nearest = null;
  let nearestDist = Infinity;

  for (const obj of interactables) {
    _objPos2D.set(obj.worldPos.x, obj.worldPos.z);
    const dist = _playerPos2D.distanceTo(_objPos2D);
    if (dist < obj.triggerRadius && dist < nearestDist) {
      nearestDist = dist;
      nearest = obj;
    }
  }

  _nearestObj = nearest;

  if (nearest) {
    portalNameEl.textContent = nearest.name;
    portalNameEl.style.color = nearest.colorHex;
    portalHintEl.innerHTML = nearest.hint;
    portalHud.classList.add('visible');
  } else {
    portalHud.classList.remove('visible');
  }
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && _nearestObj) {
    _nearestObj.onInteract();
  }
});


// ─── Auto-start (no splash) ─────────────────────────────────────────────────
const splash = document.getElementById('splash');
const crosshair = document.getElementById('crosshair');
const hint = document.getElementById('hint');

if (splash) { splash.style.display = 'none'; }
if (crosshair) { crosshair.style.display = 'none'; }
if (hint) { hint.style.display = 'none'; }
_levelActive = true;


// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS PANEL — lil-gui based control panel (Tab key to toggle)
// ═══════════════════════════════════════════════════════════════════════════════

let gui = null;

function buildSettingsGUI() {
  gui = new GUI({ title: '⚙️ Hub Settings', width: 320 });
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.top = '10px';
  gui.domElement.style.right = '10px';
  gui.domElement.style.zIndex = '1000';
  gui.close(); // start closed

  // ── Ava Host Settings ──
  const avaFolder = gui.addFolder('🤖 Ava — Host Avatar');

  avaFolder.add(avaSettings, 'scale', 0.5, 2.5, 0.05).name('Scale').onChange(v => {
    if (hubHost.vrmScene) hubHost.vrmScene.scale.setScalar(v);
  });
  avaFolder.add(avaSettings, 'posX', -30, 30, 0.5).name('Position X').onChange(updateAvaPos);
  avaFolder.add(avaSettings, 'posY', -2, 5, 0.1).name('Position Y').onChange(updateAvaPos);
  avaFolder.add(avaSettings, 'posZ', -30, 30, 0.5).name('Position Z').onChange(updateAvaPos);
  avaFolder.add(avaSettings, 'rotationY', -3.14, 3.14, 0.05).name('Rotation').onChange(v => {
    if (hubHost.vrmScene) hubHost.vrmScene.rotation.y = Math.PI + v;
  });
  avaFolder.add(avaSettings, 'spotIntensity', 0, 120, 5).name('Spot Light').onChange(v => {
    if (avaSpot) avaSpot.intensity = v;
  });
  avaFolder.add(avaSettings, 'greeting').name('Welcome Greeting');
  avaFolder.open();

  function updateAvaPos() {
    if (hubHost.vrmScene) {
      hubHost.vrmScene.position.set(avaSettings.posX, avaSettings.posY, avaSettings.posZ);
    }
    if (avaSpot) avaSpot.position.set(avaSettings.posX, 8, avaSettings.posZ);
    if (avaGlow) avaGlow.position.set(avaSettings.posX, 0.02, avaSettings.posZ);
  }

  // ── OpenAI Integration ──
  const aiFolder = gui.addFolder('🧠 OpenAI Integration');
  const aiSettings = {
    apiKey: localStorage.getItem('hub_openai_key') || '',
    model: 'gpt-4o-mini',
    systemPrompt: 'You are Ava, a friendly VTuber host who welcomes visitors to the Viverse Hub. You help them explore games and create new ones.',
    temperature: 0.7,
    maxTokens: 256,
    testConnection: async () => {
      if (!aiSettings.apiKey) { alert('Please enter your OpenAI API key first!'); return; }
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${aiSettings.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: aiSettings.model,
            messages: [
              { role: 'system', content: aiSettings.systemPrompt },
              { role: 'user', content: 'Say a short welcome message for the Viverse Hub.' },
            ],
            max_tokens: aiSettings.maxTokens,
            temperature: aiSettings.temperature,
          }),
        });
        const data = await resp.json();
        const msg = data.choices?.[0]?.message?.content || 'No response';
        alert(`✅ OpenAI connected!\n\nAva says: "${msg}"`);
        // Store for future use
        window._avaAIConfig = aiSettings;
        hubHost.setSpeaking(true, 0.6);
        setTimeout(() => hubHost.setSpeaking(false), 3000);
      } catch (e) {
        alert(`❌ Connection failed: ${e.message}`);
      }
    },
    save: () => {
      localStorage.setItem('hub_openai_key', aiSettings.apiKey);
      localStorage.setItem('hub_openai_model', aiSettings.model);
      localStorage.setItem('hub_openai_prompt', aiSettings.systemPrompt);
      window._avaAIConfig = aiSettings;
      alert('✅ AI settings saved!');
    },
  };
  aiFolder.add(aiSettings, 'apiKey').name('API Key');
  aiFolder.add(aiSettings, 'model', ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo']).name('Model');
  aiFolder.add(aiSettings, 'systemPrompt').name('System Prompt');
  aiFolder.add(aiSettings, 'temperature', 0, 2, 0.05).name('Temperature');
  aiFolder.add(aiSettings, 'maxTokens', 64, 1024, 32).name('Max Tokens');
  aiFolder.add(aiSettings, 'testConnection').name('🔌 Test Connection');
  aiFolder.add(aiSettings, 'save').name('💾 Save Settings');

  // ── Portal Layout Settings ──
  const portalFolder = gui.addFolder('🌀 Portal Layout');
  portalFolder.add(layoutSettings, 'shape', ['arc', 'line', 'circle', 'grid', 'v-formation']).name('Arrangement').onChange(() => layoutPortals());
  portalFolder.add(layoutSettings, 'radius', 8, 35, 0.5).name('Distance').onChange(() => layoutPortals());
  portalFolder.add(layoutSettings, 'spacing', 3, 15, 0.5).name('Spacing').onChange(() => layoutPortals());
  portalFolder.add(layoutSettings, 'yRotation', -Math.PI, Math.PI, 0.05).name('Rotation').onChange(() => layoutPortals());

  // Quick preset buttons
  const presets = {
    '📐 Arc (Default)': () => { layoutSettings.shape = 'arc'; layoutSettings.radius = 18; layoutSettings.spacing = 6; layoutSettings.yRotation = 0; layoutPortals(); refreshPortalGUI(); },
    '➡️ Straight Line':  () => { layoutSettings.shape = 'line'; layoutSettings.radius = 18; layoutSettings.spacing = 7; layoutSettings.yRotation = 0; layoutPortals(); refreshPortalGUI(); },
    '⭕ Full Circle':    () => { layoutSettings.shape = 'circle'; layoutSettings.radius = 14; layoutSettings.spacing = 6; layoutSettings.yRotation = 0; layoutPortals(); refreshPortalGUI(); },
    '▦ Grid':           () => { layoutSettings.shape = 'grid'; layoutSettings.radius = 12; layoutSettings.spacing = 8; layoutSettings.yRotation = 0; layoutPortals(); refreshPortalGUI(); },
    '🔱 V-Formation':   () => { layoutSettings.shape = 'v-formation'; layoutSettings.radius = 15; layoutSettings.spacing = 6; layoutSettings.yRotation = 0; layoutPortals(); refreshPortalGUI(); },
  };
  for (const [label, fn] of Object.entries(presets)) {
    portalFolder.add({ [label]: fn }, label);
  }
  portalFolder.open();

  function refreshPortalGUI() {
    for (const c of portalFolder.controllers) { c.updateDisplay(); }
  }

  // ── Atmosphere / Fog Settings ──
  const atmosFolder = gui.addFolder('🌫️ Atmosphere');
  const atmosSettings = {
    fogDensity: 0.012,
    fogColor: '#0c1228',
    ambientIntensity: ambient.intensity,
    exposure: renderer.toneMappingExposure,
    starOpacity: starMat.opacity,
  };
  atmosFolder.add(atmosSettings, 'fogDensity', 0, 0.05, 0.001).name('Fog Density').onChange(v => {
    scene.fog.density = v;
  });
  atmosFolder.addColor(atmosSettings, 'fogColor').name('Fog Color').onChange(v => {
    scene.fog.color.set(v);
  });
  atmosFolder.add(atmosSettings, 'ambientIntensity', 0, 5, 0.1).name('Ambient Light').onChange(v => {
    ambient.intensity = v;
  });
  atmosFolder.add(atmosSettings, 'exposure', 0.5, 4, 0.1).name('Exposure').onChange(v => {
    renderer.toneMappingExposure = v;
  });
  atmosFolder.add(atmosSettings, 'starOpacity', 0, 1, 0.05).name('Stars').onChange(v => {
    starMat.opacity = v;
  });

  // ── Open Source Avatars Panel ──
  const npcFolder = gui.addFolder('👥 Open Source Avatars');
  const npcSettings = { customUrl: '' };
  for (const avatar of AVATAR_LIBRARY) {
    npcSettings[`Spawn ${avatar.name}`] = () => {
      const rx = (Math.random() - 0.5) * 20;
      const rz = (Math.random() - 0.5) * 20;
      spawnNPC(avatar.url, rx, rz);
    };
    npcFolder.add(npcSettings, `Spawn ${avatar.name}`);
  }
  npcFolder.add(npcSettings, 'customUrl').name('Custom VRM URL');
  npcSettings['Spawn Custom'] = () => {
    if (npcSettings.customUrl) {
      const rx = (Math.random() - 0.5) * 20;
      const rz = (Math.random() - 0.5) * 20;
      spawnNPC(npcSettings.customUrl, rx, rz);
    }
  };
  npcFolder.add(npcSettings, 'Spawn Custom').name('🚀 Spawn Custom VRM');
  npcSettings['Remove All NPCs'] = () => {
    for (const npc of npcs) {
      try { scene.remove(npc.model.scene); } catch (_) {}
    }
    npcs.length = 0;
    console.log('🧹 All NPCs removed');
  };
  npcFolder.add(npcSettings, 'Remove All NPCs').name('🗑️ Remove All');
}

// Toggle settings panel with Tab key
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    if (gui) {
      if (gui._closed) gui.open();
      else gui.close();
    }
  }
});


// ─── Animation loop ─────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (_levelActive) {
    character.update(delta);

    for (let npc of npcs) {
      npc.update(delta);
    }

    // Respawn if fell off
    if (character.position.y < -10) {
      character.position.set(0, 2, 0);
    }

    checkProximity();

    // ── Hub Host Avatar — idle animation + face player ──
    if (hubHost.loaded) {
      hubHost.update(delta);
      hubHost.lookAt(character.position);
      // Update FBX mixer if loaded
      if (hubHost._fbxMixer) hubHost._fbxMixer.update(delta);
      // Drive lip sync from audio analyser
      if (avaAnalyser && avaAudioEl && !avaAudioEl.paused) {
        const data = new Uint8Array(avaAnalyser.frequencyBinCount);
        avaAnalyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const env = Math.min(1, (sum / data.length) / 80);
        hubHost.setSpeaking(true, env);
        // Drive mouth shapes
        hubHost.setExpression('aa', env * 0.8);
        hubHost.setExpression('oh', env * 0.3);
      }
    }
  }

  // Animate stuff
  const t = performance.now() * 0.001;

  // Float and spin all 3D icons
  for (let i = 0; i < floatingObjects.length; i++) {
    const obj = floatingObjects[i];
    obj.rotation.y = t * 0.4 + i * 0.5;
    obj.position.y = 1.8 + Math.sin(t * 1.5 + i * 0.7) * 0.15;
  }

  // (beacon removed)
  
  // Make labels face camera (billboard)
  for (const obj of interactables) {
    if (obj.label) {
      obj.label.lookAt(camera.position);
    }
  }

  // Animate particle rings
  for (const ps of particleSystems) {
    const posArr = ps.points.geometry.attributes.position.array;
    for (let i = 0; i < ps.count; i++) {
      posArr[i * 3 + 1] = 0.2 + Math.sin(t * 2 + i * 0.8) * 0.4;
    }
    ps.points.geometry.attributes.position.needsUpdate = true;
    ps.points.rotation.y = t * 0.15;
  }

  // Animate ground fog
  const fogArr = fogCloud.geometry.attributes.position.array;
  for (let i = 0; i < fogParticleCount; i++) {
    fogArr[i * 3 + 1] = 0.5 + Math.sin(t * 0.3 + i * 0.5) * 0.8;
  }
  fogCloud.geometry.attributes.position.needsUpdate = true;

  renderer.render(scene, camera);
}
animate();

// ─── Resize ──────────────────────────────────────────────────────────────────
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
