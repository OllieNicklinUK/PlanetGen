import {
  createSystem,
  createComponent,
  Types,
  LocomotionEnvironment,
  Interactable,
  Pressed,
  AmbientLight,
  HemisphereLight,
  PointLight,
  SpotLight,
  Color,
  FogExp2,
  MathUtils,
  Vector3,
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  TorusGeometry,
  PlaneGeometry,
  CircleGeometry,
  SphereGeometry,
  ConeGeometry,
  OctahedronGeometry,
  BufferGeometry,
  BufferAttribute,
  MeshStandardMaterial,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  CanvasTexture,
  AdditiveBlending,
  DoubleSide,
  RepeatWrapping,
} from '@iwsdk/core';

import { Sky } from 'three/examples/jsm/objects/Sky.js';

// ─── Destinations ─────────────────────────────────────────────────────────────
// 'world' url = in-place transition to procedural PlanetGen terrain.
// All other urls open in a new tab (XR session stays alive).
const DESTINATIONS = [
  { label: 'PlanetGen World', desc: 'Procedural Frontier',  url: 'world',               color: '#44ff88', icon: 'rocket',    category: 'world'    },
  { label: 'Splat World',     desc: '3DGS Explorer',        url: '/index.html?level=3', color: '#ff44ff', icon: 'splat',     category: 'game'     },
  { label: 'Prop Library',    desc: 'Meshy AI Assets',      url: '/library.html',       color: '#ffaa00', icon: 'gem',       category: 'tool'     },
  { label: 'Google → 3DGS',   desc: 'Google 3D Tiles',      url: '/tile-test.html',     color: '#00ffff', icon: 'voxel',     category: 'world'    },
  { label: 'Warehouse CQB',   desc: 'Room Clearing',        url: '/index.html?level=6', color: '#64c8ff', icon: 'warehouse', category: 'training' },
];

// ─── PortalDestination component (kept with its system per convention) ─────────
export const PortalDestination = createComponent('PortalDestination', {
  url:      { type: Types.String, default: '' },
  label:    { type: Types.String, default: '' },
  colorHex: { type: Types.String, default: '#ffffff' },
});

// ─── Icon builders (each returns a THREE.Group) ───────────────────────────────

function buildIcon_crosshair(color) {
  const g   = new Group();
  const mat = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.1 });
  g.add(new Mesh(new SphereGeometry(0.15, 16, 16), mat));
  for (let i = 0; i < 4; i++) {
    const arm   = new Mesh(new BoxGeometry(0.08, 0.5, 0.08), mat);
    arm.position.y = 0.35;
    const pivot = new Group();
    pivot.rotation.z = (Math.PI / 2) * i;
    pivot.add(arm);
    g.add(pivot);
  }
  g.add(new Mesh(new TorusGeometry(0.55, 0.03, 16, 32), mat));
  return g;
}

function buildIcon_splat(color) {
  const g   = new Group();
  const base = new Color(color);
  for (let i = 0; i < 12; i++) {
    const r      = 0.08 + Math.random() * 0.15;
    const sphere = new Mesh(new SphereGeometry(r, 12, 12), new MeshStandardMaterial({
      color: base.clone().offsetHSL(Math.random() * 0.2 - 0.1, 0, 0),
      emissive: color, emissiveIntensity: 0.3,
      transparent: true, opacity: 0.5 + Math.random() * 0.3,
      metalness: 0.1, roughness: 0.8,
    }));
    sphere.position.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6);
    g.add(sphere);
  }
  return g;
}

function buildIcon_voxel(color) {
  const g       = new Group();
  const mat     = new MeshStandardMaterial({ color: 0x222233, metalness: 0.7, roughness: 0.2 });
  const wireMat = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, wireframe: true });
  const sizes   = [[0.3, 0.5, 0.3], [0.25, 0.8, 0.25], [0.35, 0.35, 0.35], [0.2, 0.6, 0.2]];
  const offsets = [[-0.2, 0, -0.15], [0.2, 0, 0.1], [0, 0, 0.25], [-0.05, 0, -0.3]];
  sizes.forEach((s, i) => {
    const box = new Mesh(new BoxGeometry(...s), mat);
    box.position.set(offsets[i][0], s[1] / 2 - 0.3, offsets[i][2]);
    box.add(new Mesh(new BoxGeometry(s[0] + 0.01, s[1] + 0.01, s[2] + 0.01), wireMat));
    g.add(box);
  });
  return g;
}

function buildIcon_gem(color) {
  const g   = new Group();
  const mat = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 1.0, roughness: 0.05, transparent: true, opacity: 0.85 });
  const gem = new Mesh(new OctahedronGeometry(0.4, 0), mat);
  gem.scale.y = 1.3;
  g.add(gem);
  const sparkMat = new MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 5; i++) {
    const sp = new Mesh(new OctahedronGeometry(0.04, 0), sparkMat);
    const a  = (i / 5) * Math.PI * 2;
    sp.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.3, 0);
    g.add(sp);
  }
  return g;
}

function buildIcon_warehouse(color) {
  const g         = new Group();
  const mat       = new MeshStandardMaterial({ color: 0x334455, metalness: 0.6, roughness: 0.3 });
  const accentMat = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.2 });
  const body = new Mesh(new BoxGeometry(0.8, 0.5, 0.6), mat);
  body.position.y = -0.05;
  g.add(body);
  const rv = new Float32Array([
    -0.4, 0.2, -0.3,  0.4, 0.2, -0.3,  0, 0.45, -0.3,
    -0.4, 0.2,  0.3,  0.4, 0.2,  0.3,  0, 0.45,  0.3,
    -0.4, 0.2, -0.3, -0.4, 0.2,  0.3,  0, 0.45,  0.3,
     0, 0.45, -0.3,  -0.4, 0.2, -0.3,  0, 0.45,  0.3,
     0.4, 0.2, -0.3,  0.4, 0.2,  0.3,  0, 0.45,  0.3,
     0, 0.45, -0.3,   0.4, 0.2, -0.3,  0, 0.45,  0.3,
  ]);
  const roofGeo = new BufferGeometry();
  roofGeo.setAttribute('position', new BufferAttribute(rv, 3));
  roofGeo.computeVertexNormals();
  g.add(new Mesh(roofGeo, accentMat));
  const door = new Mesh(new PlaneGeometry(0.25, 0.35), accentMat);
  door.position.set(0, -0.12, 0.301);
  g.add(door);
  return g;
}

function buildIcon_rocket(color) {
  const g      = new Group();
  const mat    = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.1 });
  const finMat = new MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 });
  g.add(new Mesh(new CylinderGeometry(0.12, 0.15, 0.7, 16), mat));
  const nose = new Mesh(new ConeGeometry(0.12, 0.3, 16), mat);
  nose.position.y = 0.5;
  g.add(nose);
  for (let i = 0; i < 3; i++) {
    const fin = new Mesh(new BoxGeometry(0.02, 0.2, 0.18), finMat);
    fin.position.set(0.15, -0.3, 0);
    const pivot = new Group();
    pivot.rotation.y = (Math.PI * 2 / 3) * i;
    pivot.add(fin);
    g.add(pivot);
  }
  const exhaust = new Mesh(new ConeGeometry(0.1, 0.25, 12), new MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.6 }));
  exhaust.position.y = -0.47;
  exhaust.rotation.x = Math.PI;
  g.add(exhaust);
  return g;
}

const ICON_BUILDERS = {
  crosshair: buildIcon_crosshair,
  splat:     buildIcon_splat,
  voxel:     buildIcon_voxel,
  gem:       buildIcon_gem,
  warehouse: buildIcon_warehouse,
  rocket:    buildIcon_rocket,
};

// ─── LobbySystem ─────────────────────────────────────────────────────────────
export class LobbySystem extends createSystem(
  { pressedPortals: { required: [PortalDestination, Pressed] } },
  {},
) {
  // onEnterWorld: (() => void) | null  — set by index.js after registerSystem
  init() {
    this._entities      = [];
    this._sceneObjects  = [];
    this._iconMeshes    = [];
    this._particleRings = [];
    this._labelMeshes   = [];
    this._transitioning = false;
    this._scratch       = new Vector3();
    this.onEnterWorld   = null;

    this._buildAtmosphere();
    this._buildFloor();
    this._buildPortals();

    this.queries.pressedPortals.subscribe('qualify', (entity) => {
      if (this._transitioning) return;
      const url = entity.getValue(PortalDestination, 'url');
      if (url === 'world') {
        this._transitioning = true;
        this.disposeLobby();
        this.world.player.position.set(0, 100, 0);
        this.onEnterWorld?.();
      } else if (url) {
        window.open(url, '_blank');
      }
    });
  }

  _buildAtmosphere() {
    // Twilight sky — low sun angle, warm horizon
    this._sky = new Sky();
    this._sky.scale.setScalar(10000);
    this.scene.add(this._sky);
    const su = this._sky.material.uniforms;
    su['turbidity'].value       = 2;
    su['rayleigh'].value        = 1.5;
    su['mieCoefficient'].value  = 0.005;
    su['mieDirectionalG'].value = 0.85;
    const sunPos = new Vector3();
    sunPos.setFromSphericalCoords(1, MathUtils.degToRad(88), MathUtils.degToRad(200));
    su['sunPosition'].value.copy(sunPos);
    this._sceneObjects.push(this._sky);

    this.scene.fog = new FogExp2(0x0c1228, 0.012);

    // Starfield
    const STAR_COUNT = 2000;
    const starPos    = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = 400 + Math.random() * 600;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      starPos[i * 3]     = r * Math.sin(p) * Math.cos(t);
      starPos[i * 3 + 1] = Math.abs(r * Math.cos(p)) + 20;
      starPos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
    }
    const starGeo = new BufferGeometry();
    starGeo.setAttribute('position', new BufferAttribute(starPos, 3));
    const stars = new Points(starGeo, new PointsMaterial({
      color: 0xffffff, size: 1.5, transparent: true, opacity: 0.85,
      blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.scene.add(stars);
    this._sceneObjects.push(stars);

    // Ground fog haze
    const fogCount = 200;
    const fogPos   = new Float32Array(fogCount * 3);
    for (let i = 0; i < fogCount; i++) {
      fogPos[i * 3]     = (Math.random() - 0.5) * 70;
      fogPos[i * 3 + 1] = Math.random() * 1.5;
      fogPos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const fogGeo = new BufferGeometry();
    fogGeo.setAttribute('position', new BufferAttribute(fogPos, 3));
    const fogCloud = new Points(fogGeo, new PointsMaterial({
      color: 0x4455aa, size: 3.0, transparent: true, opacity: 0.06,
      blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.scene.add(fogCloud);
    this._sceneObjects.push(fogCloud);

    // Lights
    const ambient = new AmbientLight(0x8899bb, 1.8);
    this.scene.add(ambient);
    this._sceneObjects.push(ambient);

    const hemi = new HemisphereLight(0x6688dd, 0x223344, 2.0);
    this.scene.add(hemi);
    this._sceneObjects.push(hemi);

    const fill = new PointLight(0x7788cc, 3.0, 60, 1.5);
    fill.position.set(0, 12, 0);
    this.scene.add(fill);
    this._sceneObjects.push(fill);

    const warm = new PointLight(0x7c5cff, 1.5, 40, 2);
    warm.position.set(0, 1, 0);
    this.scene.add(warm);
    this._sceneObjects.push(warm);
  }

  _buildFloor() {
    // Hex grid canvas texture (ported from viverse-hub-package/src/hub.js)
    const canvas  = document.createElement('canvas');
    canvas.width  = 1024;
    canvas.height = 1024;
    const ctx     = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = 'rgba(100, 140, 255, 0.08)';
    ctx.lineWidth   = 1;
    const hexR = 32;
    for (let row = 0; row < 40; row++) {
      for (let col = 0; col < 40; col++) {
        const cx = col * hexR * 1.75 + (row % 2 ? hexR * 0.875 : 0);
        const cy = row * hexR * 1.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a  = (Math.PI / 3) * i - Math.PI / 6;
          const px = cx + hexR * Math.cos(a);
          const py = cy + hexR * Math.sin(a);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    const hexTex  = new CanvasTexture(canvas);
    hexTex.wrapS  = RepeatWrapping;
    hexTex.wrapT  = RepeatWrapping;
    hexTex.repeat.set(8, 8);

    const floorMesh = new Mesh(
      new BoxGeometry(80, 1, 80),
      new MeshStandardMaterial({ map: hexTex, color: 0xffffff, roughness: 0.6, metalness: 0.4 }),
    );
    floorMesh.position.y = -0.5;
    floorMesh.receiveShadow = true;

    const floorEntity = this.world.createTransformEntity(floorMesh);
    floorEntity.addComponent(LocomotionEnvironment);
    this._entities.push(floorEntity);
  }

  _buildPortals() {
    const count = DESTINATIONS.length;
    for (let i = 0; i < count; i++) {
      const dest   = DESTINATIONS[i];
      const t      = count > 1 ? i / (count - 1) : 0.5;
      const angle  = MathUtils.degToRad(-144 + t * 288);
      const radius = 11;
      const x      = Math.sin(angle) * radius;
      const z      = -Math.cos(angle) * radius;

      const portalGroup  = this._buildPortalGroup(dest);
      const portalEntity = this.world.createTransformEntity(portalGroup);
      portalEntity.object3D.position.set(x, 0, z);
      portalEntity.object3D.lookAt(0, 0, 0);
      portalEntity.addComponent(PortalDestination, { url: dest.url, label: dest.label, colorHex: dest.color });
      portalEntity.addComponent(Interactable);
      this._entities.push(portalEntity);

      // Spotlight targets the pedestal position; target must be in scene
      const spot = new SpotLight(new Color(dest.color), 40, 15, 0.45, 0.6, 1);
      spot.position.set(x, 7, z);
      spot.target.position.set(x, 0, z);
      this.scene.add(spot);
      this.scene.add(spot.target);
      this._sceneObjects.push(spot, spot.target);
    }
  }

  _buildPortalGroup(def) {
    const g = new Group();

    // Hexagonal pedestal
    const pedestal = new Mesh(
      new CylinderGeometry(1.3, 1.5, 0.6, 6),
      new MeshStandardMaterial({ color: 0x111118, metalness: 0.9, roughness: 0.15, emissive: new Color(def.color), emissiveIntensity: 0.05 }),
    );
    pedestal.position.y     = 0.3;
    pedestal.castShadow     = true;
    pedestal.receiveShadow  = true;
    g.add(pedestal);

    // Glow rings
    const outerRing = new Mesh(new TorusGeometry(1.2, 0.04, 8, 64), new MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.8 }));
    outerRing.rotation.x = Math.PI / 2;
    outerRing.position.y = 0.62;
    g.add(outerRing);

    const innerRing = new Mesh(new TorusGeometry(0.7, 0.02, 8, 48), new MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.4 }));
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.63;
    g.add(innerRing);

    // Ground glow disc
    const disc = new Mesh(
      new CircleGeometry(1.8, 32),
      new MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.08, side: DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    g.add(disc);

    // Particle ring (animated in update)
    this._particleRings.push(this._buildParticleRing(g, def.color));

    // Floating icon
    const builder = ICON_BUILDERS[def.icon] || buildIcon_gem;
    const icon    = builder(def.color);
    icon.position.y = 1.8;
    icon.scale.setScalar(1.2);
    g.add(icon);
    this._iconMeshes.push(icon);

    // Canvas label
    const label = this._buildLabel(def);
    label.position.y = 3.6;
    g.add(label);
    this._labelMeshes.push(label);

    return g;
  }

  _buildParticleRing(parent, color, radius = 1.4, count = 30) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a             = (i / count) * Math.PI * 2;
      positions[i * 3]     = Math.cos(a) * radius;
      positions[i * 3 + 1] = Math.random() * 0.5;
      positions[i * 3 + 2] = Math.sin(a) * radius;
    }
    const geo  = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    const ring = new Points(geo, new PointsMaterial({
      color, size: 0.06, transparent: true, opacity: 0.7,
      blending: AdditiveBlending, depthWrite: false,
    }));
    ring.position.y = 0.8;
    parent.add(ring);
    return ring;
  }

  _buildLabel(def) {
    const CAT_COLORS = { game: '#882233', world: '#005566', tool: '#226633', training: '#665500', creator: '#553388' };
    const CAT_LABELS = { game: 'GAME',    world: 'WORLD',   tool: 'TOOL',    training: 'TRAINING', creator: 'CREATE' };
    const c  = document.createElement('canvas');
    c.width  = 512;
    c.height = 160;
    const cx = c.getContext('2d');

    cx.fillStyle = 'rgba(255,255,255,0.5)';
    cx.fillRect(60, 5, 392, 145);

    cx.fillStyle = CAT_COLORS[def.category] || '#444';
    cx.font      = 'bold 16px monospace';
    cx.textAlign = 'center';
    cx.fillText(CAT_LABELS[def.category] || (def.category || '').toUpperCase(), 256, 28);

    cx.shadowColor = 'rgba(255,255,255,0.9)';
    cx.shadowBlur  = 12;
    cx.fillStyle   = '#111';
    cx.font        = 'bold 38px Arial, sans-serif';
    cx.fillText(def.label, 256, 80);

    cx.shadowBlur = 0;
    cx.font       = '20px Arial, sans-serif';
    cx.fillStyle  = '#333';
    cx.fillText(def.desc, 256, 118);

    cx.strokeStyle = '#555';
    cx.lineWidth   = 1;
    cx.globalAlpha = 0.4;
    cx.beginPath();
    cx.moveTo(140, 135);
    cx.lineTo(372, 135);
    cx.stroke();
    cx.globalAlpha = 1;

    return new Mesh(
      new PlaneGeometry(3.2, 1.0),
      new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthTest: false, side: DoubleSide }),
    );
  }

  update(delta, time) {
    if (this._transitioning) return;

    // Compute camera world pos once for billboard labels
    this.camera.getWorldPosition(this._scratch);

    for (let i = 0; i < this._iconMeshes.length; i++) {
      this._iconMeshes[i].rotation.y += delta * 0.4;
      this._iconMeshes[i].position.y  = 1.8 + Math.sin(time * 0.8 + i * 0.9) * 0.12;
    }
    for (const ring of this._particleRings) {
      ring.rotation.y += delta * 0.3;
    }
    for (const label of this._labelMeshes) {
      label.lookAt(this._scratch);
    }
  }

  disposeLobby() {
    for (const e of this._entities)     e.dispose();
    for (const o of this._sceneObjects) this.scene.remove(o);
    this._entities      = [];
    this._sceneObjects  = [];
    this._iconMeshes    = [];
    this._particleRings = [];
    this._labelMeshes   = [];
    this.scene.fog      = null;
  }
}
