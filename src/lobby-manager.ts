import {
  Scene, PerspectiveCamera, Vector3, Group, Mesh,
  BoxGeometry, CylinderGeometry, TorusGeometry, PlaneGeometry,
  CircleGeometry, SphereGeometry, ConeGeometry, OctahedronGeometry,
  BufferGeometry, BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial,
  AmbientLight, HemisphereLight, PointLight, SpotLight,
  Points, PointsMaterial, CanvasTexture, Color,
  FogExp2, AdditiveBlending, DoubleSide, RepeatWrapping, MathUtils,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { BvhPhysicsWorld } from '@pmndrs/viverse';

const DESTINATIONS = [
  { label: 'PlanetGen World', desc: 'Procedural Frontier',  url: 'world',               color: '#44ff88', icon: 'rocket',    category: 'world'    },
  { label: 'Snow World',      desc: 'Infinite Snowboard',   url: 'snow',                color: '#88ddff', icon: 'snow',      category: 'world'    },
  { label: 'Splat World',     desc: '3DGS Explorer',        url: '/index.html?level=3', color: '#ff44ff', icon: 'splat',     category: 'game'     },
  { label: 'Prop Library',    desc: 'Meshy AI Assets',      url: '/library.html',       color: '#ffaa00', icon: 'gem',       category: 'tool'     },
  { label: 'Google → 3DGS',   desc: 'Google 3D Tiles',      url: '/tile-test.html',     color: '#00ffff', icon: 'voxel',     category: 'world'    },
  { label: 'Warehouse CQB',   desc: 'Room Clearing',        url: '/index.html?level=6', color: '#64c8ff', icon: 'warehouse', category: 'training' },
];

// Must match SAFE_HEIGHT in noise.js so portals sit flush on the safe-zone terrain
export const LOBBY_Y = 2;

interface PortalEntry {
  group:     Group;
  url:       string;
  worldPos:  Vector3;
  color:     string;
}

// ─── Icon builders ─────────────────────────────────────────────────────────────

function buildIcon_crosshair(color: string) {
  const g = new Group(); const mat = new MeshStandardMaterial({ color, emissive: color as any, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.1 });
  g.add(new Mesh(new SphereGeometry(0.15, 16, 16), mat));
  for (let i = 0; i < 4; i++) { const arm = new Mesh(new BoxGeometry(0.08, 0.5, 0.08), mat); arm.position.y = 0.35; const pivot = new Group(); pivot.rotation.z = (Math.PI / 2) * i; pivot.add(arm); g.add(pivot); }
  g.add(new Mesh(new TorusGeometry(0.55, 0.03, 16, 32), mat)); return g;
}
function buildIcon_splat(color: string) {
  const g = new Group(); const base = new Color(color);
  for (let i = 0; i < 12; i++) { const r = 0.08 + Math.random() * 0.15; const sphere = new Mesh(new SphereGeometry(r, 12, 12), new MeshStandardMaterial({ color: base.clone().offsetHSL(Math.random() * 0.2 - 0.1, 0, 0) as any, emissive: color as any, emissiveIntensity: 0.3, transparent: true, opacity: 0.5 + Math.random() * 0.3, metalness: 0.1, roughness: 0.8 })); sphere.position.set((Math.random()-0.5)*0.6,(Math.random()-0.5)*0.6,(Math.random()-0.5)*0.6); g.add(sphere); } return g;
}
function buildIcon_voxel(color: string) {
  const g = new Group(); const mat = new MeshStandardMaterial({ color: 0x222233, metalness: 0.7, roughness: 0.2 }); const wm = new MeshStandardMaterial({ color: color as any, emissive: color as any, emissiveIntensity: 0.5, wireframe: true });
  const sizes=[[0.3,0.5,0.3],[0.25,0.8,0.25],[0.35,0.35,0.35],[0.2,0.6,0.2]]; const offs=[[-0.2,0,-0.15],[0.2,0,0.1],[0,0,0.25],[-0.05,0,-0.3]];
  sizes.forEach((s,i)=>{ const b=new Mesh(new BoxGeometry(s[0],s[1],s[2]),mat); b.position.set(offs[i][0],s[1]/2-0.3,offs[i][2]); b.add(new Mesh(new BoxGeometry(s[0]+0.01,s[1]+0.01,s[2]+0.01),wm)); g.add(b); }); return g;
}
function buildIcon_gem(color: string) {
  const g = new Group(); const mat = new MeshStandardMaterial({ color: color as any, emissive: color as any, emissiveIntensity: 0.4, metalness: 1.0, roughness: 0.05, transparent: true, opacity: 0.85 }); const gem = new Mesh(new OctahedronGeometry(0.4, 0), mat); gem.scale.y = 1.3; g.add(gem);
  const sm = new MeshBasicMaterial({ color: 0xffffff }); for (let i = 0; i < 5; i++) { const a=(i/5)*Math.PI*2; const sp=new Mesh(new OctahedronGeometry(0.04,0),sm); sp.position.set(Math.cos(a)*0.55,Math.sin(a)*0.3,0); g.add(sp); } return g;
}
function buildIcon_warehouse(color: string) {
  const g=new Group(); const mat=new MeshStandardMaterial({color:0x334455,metalness:0.6,roughness:0.3}); const am=new MeshStandardMaterial({color:color as any,emissive:color as any,emissiveIntensity:0.5,metalness:0.5,roughness:0.2});
  const body=new Mesh(new BoxGeometry(0.8,0.5,0.6),mat); body.position.y=-0.05; g.add(body);
  const rv=new Float32Array([-0.4,0.2,-0.3, 0.4,0.2,-0.3, 0,0.45,-0.3, -0.4,0.2,0.3, 0.4,0.2,0.3, 0,0.45,0.3, -0.4,0.2,-0.3,-0.4,0.2,0.3,0,0.45,0.3, 0,0.45,-0.3,-0.4,0.2,-0.3,0,0.45,0.3, 0.4,0.2,-0.3,0.4,0.2,0.3,0,0.45,0.3, 0,0.45,-0.3,0.4,0.2,-0.3,0,0.45,0.3]);
  const rg=new BufferGeometry(); rg.setAttribute('position',new BufferAttribute(rv,3)); rg.computeVertexNormals(); g.add(new Mesh(rg,am));
  const door=new Mesh(new PlaneGeometry(0.25,0.35),am); door.position.set(0,-0.12,0.301); g.add(door); return g;
}
function buildIcon_rocket(color: string) {
  const g=new Group(); const mat=new MeshStandardMaterial({color:color as any,emissive:color as any,emissiveIntensity:0.5,metalness:0.8,roughness:0.1}); const fm=new MeshStandardMaterial({color:0x222222,metalness:0.8,roughness:0.2});
  g.add(new Mesh(new CylinderGeometry(0.12,0.15,0.7,16),mat)); const nose=new Mesh(new ConeGeometry(0.12,0.3,16),mat); nose.position.y=0.5; g.add(nose);
  for(let i=0;i<3;i++){const fin=new Mesh(new BoxGeometry(0.02,0.2,0.18),fm);fin.position.set(0.15,-0.3,0);const p=new Group();p.rotation.y=(Math.PI*2/3)*i;p.add(fin);g.add(p);}
  const ex=new Mesh(new ConeGeometry(0.1,0.25,12),new MeshBasicMaterial({color:0xff6600,transparent:true,opacity:0.6}));ex.position.y=-0.47;ex.rotation.x=Math.PI;g.add(ex); return g;
}
function buildIcon_snow(color: string) {
  const g=new Group(); const mat=new MeshStandardMaterial({color:color as any,emissive:color as any,emissiveIntensity:0.6,metalness:0.2,roughness:0.08,transparent:true,opacity:0.9});
  for(let i=0;i<3;i++){const arm=new Mesh(new BoxGeometry(1.0,0.06,0.06),mat);arm.rotation.y=(Math.PI/3)*i;g.add(arm);}
  for(let i=0;i<6;i++){const a=(Math.PI/3)*i;const b=new Mesh(new BoxGeometry(0.28,0.05,0.05),mat);b.rotation.y=a+Math.PI/4;b.position.set(Math.sin(a)*0.3,0,Math.cos(a)*0.3);g.add(b);}
  g.add(new Mesh(new CylinderGeometry(0.05,0.02,0.55,6),mat)); return g;
}
const ICON_BUILDERS: Record<string,(c:string)=>Group> = { crosshair:buildIcon_crosshair, splat:buildIcon_splat, voxel:buildIcon_voxel, gem:buildIcon_gem, warehouse:buildIcon_warehouse, rocket:buildIcon_rocket, snow:buildIcon_snow };

// ─── LobbyManager ─────────────────────────────────────────────────────────────

export class LobbyManager {
  onEnterWorld:    (() => void) | null = null;
  onEnterSnow:     (() => void) | null = null;
  onReturnToLobby: (() => void) | null = null;

  private _sceneObjects:  any[]        = [];
  private _portals:       PortalEntry[] = [];
  private _iconMeshes:    Group[]       = [];
  private _particleRings: Group[]       = [];
  private _labelMeshes:   Mesh[]        = [];
  private _floorMesh:     Mesh | null   = null;
  private _transitioning = false;
  private _scratch       = new Vector3();
  private _playerProx    = new Vector3();
  private _cleanups:     (() => void)[] = [];

  constructor(
    private _scene:        Scene,
    private _physicsWorld: BvhPhysicsWorld,
    private _camera:       PerspectiveCamera,
    private _getPlayerPos: () => Vector3,
    private _setPlayerPos: (pos: {x:number;y:number;z:number}) => void,
  ) {}

  init(opts?: { worldMode?: boolean }) {
    if (!opts?.worldMode) {
      // Standalone lobby: build its own sky, stars, fog, and floor.
      // In world mode these are provided by WorldManager + the procedural terrain.
      this._buildAtmosphere();
      this._buildFloor();
    }
    this._buildPortals();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'b' && e.key !== 'B') return;
      this._setPlayerPos({ x: 0, y: LOBBY_Y + 1.5, z: 0 });
      this._transitioning = false;
      this.onReturnToLobby?.();
    };
    document.addEventListener('keydown', onKey);
    this._cleanups.push(() => document.removeEventListener('keydown', onKey));
  }

  update(delta: number, time: number) {
    if (this._transitioning) return;

    this._playerProx.copy(this._getPlayerPos());
    this._camera.getWorldPosition(this._scratch);

    for (let i = 0; i < this._iconMeshes.length; i++) {
      this._iconMeshes[i].rotation.y += delta * 0.4;
      (this._iconMeshes[i] as any).position.y = 1.8 + Math.sin(time * 0.8 + i * 0.9) * 0.12;
    }
    for (const ring of this._particleRings) ring.rotation.y += delta * 0.3;
    for (const label of this._labelMeshes) label.lookAt(this._scratch);

    // Proximity portal activation
    for (const portal of this._portals) {
      const dist = this._playerProx.distanceTo(portal.worldPos);
      if (dist < 1.5) this._activatePortal(portal);
    }
  }

  private _activatePortal(portal: PortalEntry) {
    if (this._transitioning) return;
    const { url } = portal;
    if (url === 'world') {
      this._onPortalEntry(LOBBY_Y + 1.5, this.onEnterWorld);
    } else if (url === 'snow') {
      this._onPortalEntry(300, this.onEnterSnow);
    } else if (url) {
      window.open(url, '_blank');
    }
  }

  private _onPortalEntry(spawnY: number, onEnter: (() => void) | null) {
    this._transitioning = true;

    if (this._floorMesh) {
      this._physicsWorld.removeBody(this._floorMesh);
      this._scene.remove(this._floorMesh);
      this._floorMesh = null;
    }

    onEnter?.();
    setTimeout(() => { this._transitioning = false; }, 2000);
  }

  private _buildAtmosphere() {
    const sky = new Sky(); sky.scale.setScalar(10000); this._scene.add(sky);
    const su = sky.material.uniforms;
    su['turbidity'].value = 2; su['rayleigh'].value = 1.5; su['mieCoefficient'].value = 0.005; su['mieDirectionalG'].value = 0.85;
    const sunPos = new Vector3(); sunPos.setFromSphericalCoords(1, MathUtils.degToRad(88), MathUtils.degToRad(200));
    su['sunPosition'].value.copy(sunPos);
    this._sceneObjects.push(sky);

    this._scene.fog = new FogExp2(0x0c1228, 0.012);

    const STAR_COUNT = 2000; const starPos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const r=400+Math.random()*600, t=Math.random()*Math.PI*2, p=Math.acos(2*Math.random()-1);
      starPos[i*3]=r*Math.sin(p)*Math.cos(t); starPos[i*3+1]=Math.abs(r*Math.cos(p))+20; starPos[i*3+2]=r*Math.sin(p)*Math.sin(t);
    }
    const starGeo=new BufferGeometry(); starGeo.setAttribute('position',new BufferAttribute(starPos,3));
    const stars=new Points(starGeo,new PointsMaterial({color:0xffffff,size:1.5,transparent:true,opacity:0.85,blending:AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
    stars.position.y=LOBBY_Y; this._scene.add(stars); this._sceneObjects.push(stars);

    const fogCount=200; const fogPos=new Float32Array(fogCount*3);
    for(let i=0;i<fogCount;i++){fogPos[i*3]=(Math.random()-0.5)*70;fogPos[i*3+1]=LOBBY_Y+Math.random()*1.5;fogPos[i*3+2]=(Math.random()-0.5)*70;}
    const fogGeo=new BufferGeometry(); fogGeo.setAttribute('position',new BufferAttribute(fogPos,3));
    const fogCloud=new Points(fogGeo,new PointsMaterial({color:0x4455aa,size:3.0,transparent:true,opacity:0.06,blending:AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
    this._scene.add(fogCloud); this._sceneObjects.push(fogCloud);

    const ambient=new AmbientLight(0x8899bb,1.8); this._scene.add(ambient); this._sceneObjects.push(ambient);
    const hemi=new HemisphereLight(0x6688dd,0x223344,2.0); this._scene.add(hemi); this._sceneObjects.push(hemi);
    const fill=new PointLight(0x7788cc,3.0,60,1.5); fill.position.set(0,LOBBY_Y+12,0); this._scene.add(fill); this._sceneObjects.push(fill);
    const warm=new PointLight(0x7c5cff,1.5,40,2); warm.position.set(0,LOBBY_Y+1,0); this._scene.add(warm); this._sceneObjects.push(warm);
  }

  private _buildFloor() {
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=1024;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#0a0a0f'; ctx.fillRect(0,0,1024,1024);
    ctx.strokeStyle='rgba(100,140,255,0.08)'; ctx.lineWidth=1;
    const hexR=32;
    for(let row=0;row<40;row++) for(let col=0;col<40;col++){
      const cx=col*hexR*1.75+(row%2?hexR*0.875:0), cy=row*hexR*1.5;
      ctx.beginPath();
      for(let i=0;i<6;i++){const a=(Math.PI/3)*i-Math.PI/6; i===0?ctx.moveTo(cx+hexR*Math.cos(a),cy+hexR*Math.sin(a)):ctx.lineTo(cx+hexR*Math.cos(a),cy+hexR*Math.sin(a));}
      ctx.closePath(); ctx.stroke();
    }
    const hexTex=new CanvasTexture(canvas); hexTex.wrapS=hexTex.wrapT=RepeatWrapping; hexTex.repeat.set(8,8);

    const floor=new Mesh(new BoxGeometry(80,1,80),new MeshStandardMaterial({map:hexTex,color:0xffffff,roughness:0.6,metalness:0.4}));
    floor.position.y=LOBBY_Y-0.5; floor.receiveShadow=true;
    this._scene.add(floor);
    floor.updateWorldMatrix(true,true);
    this._physicsWorld.addBody(floor, false);
    this._floorMesh=floor;
  }

  private _buildPortals() {
    const count=DESTINATIONS.length;
    for(let i=0;i<count;i++){
      const dest=DESTINATIONS[i];
      const t=count>1?i/(count-1):0.5;
      const angle=MathUtils.degToRad(-144+t*288);
      const radius=11;
      const x=Math.sin(angle)*radius, z=-Math.cos(angle)*radius;

      const portalGroup=this._buildPortalGroup(dest);
      portalGroup.position.set(x,LOBBY_Y,z);
      portalGroup.lookAt(0,LOBBY_Y,0);
      this._scene.add(portalGroup);

      this._portals.push({ group: portalGroup, url: dest.url, worldPos: new Vector3(x, LOBBY_Y, z), color: dest.color });

      const spot=new SpotLight(new Color(dest.color) as any,40,15,0.45,0.6,1);
      spot.position.set(x,LOBBY_Y+7,z); spot.target.position.set(x,LOBBY_Y,z);
      this._scene.add(spot); this._scene.add(spot.target);
      this._sceneObjects.push(spot, spot.target);
    }
  }

  private _buildPortalGroup(def: typeof DESTINATIONS[0]) {
    const g = new Group();
    const pedestal=new Mesh(new CylinderGeometry(1.3,1.5,0.6,6),new MeshStandardMaterial({color:0x111118,metalness:0.9,roughness:0.15,emissive:new Color(def.color) as any,emissiveIntensity:0.05}));
    pedestal.position.y=0.3; pedestal.castShadow=pedestal.receiveShadow=true; g.add(pedestal);

    const outerRing=new Mesh(new TorusGeometry(1.2,0.04,8,64),new MeshBasicMaterial({color:def.color as any,transparent:true,opacity:0.8}));
    outerRing.rotation.x=Math.PI/2; outerRing.position.y=0.62; g.add(outerRing);
    const innerRing=new Mesh(new TorusGeometry(0.7,0.02,8,48),new MeshBasicMaterial({color:def.color as any,transparent:true,opacity:0.4}));
    innerRing.rotation.x=Math.PI/2; innerRing.position.y=0.63; g.add(innerRing);

    const disc=new Mesh(new CircleGeometry(1.8,32),new MeshBasicMaterial({color:def.color as any,transparent:true,opacity:0.08,side:DoubleSide}));
    disc.rotation.x=-Math.PI/2; disc.position.y=0.02; g.add(disc);

    this._particleRings.push(this._buildParticleRing(g, def.color));

    const builder=ICON_BUILDERS[def.icon]||buildIcon_gem;
    const icon=builder(def.color); icon.position.y=1.8; icon.scale.setScalar(1.2); g.add(icon);
    this._iconMeshes.push(icon);

    const label=this._buildLabel(def); label.position.y=3.6; g.add(label);
    this._labelMeshes.push(label);

    return g;
  }

  private _buildParticleRing(parent: Group, color: string, radius=1.4, count=30) {
    const positions=new Float32Array(count*3);
    for(let i=0;i<count;i++){const a=(i/count)*Math.PI*2; positions[i*3]=Math.cos(a)*radius; positions[i*3+1]=Math.random()*0.5; positions[i*3+2]=Math.sin(a)*radius;}
    const geo=new BufferGeometry(); geo.setAttribute('position',new BufferAttribute(positions,3));
    const ring=new Points(geo,new PointsMaterial({color:color as any,size:0.06,transparent:true,opacity:0.7,blending:AdditiveBlending,depthWrite:false})) as unknown as Group;
    (ring as any).position.y=0.8; parent.add(ring as any); return ring;
  }

  private _buildLabel(def: typeof DESTINATIONS[0]) {
    const CAT_COLORS: Record<string,string>={game:'#882233',world:'#005566',tool:'#226633',training:'#665500',creator:'#553388'};
    const CAT_LABELS: Record<string,string>={game:'GAME',world:'WORLD',tool:'TOOL',training:'TRAINING',creator:'CREATE'};
    const c=document.createElement('canvas'); c.width=512; c.height=160;
    const cx=c.getContext('2d')!;
    cx.fillStyle='rgba(255,255,255,0.5)'; cx.fillRect(60,5,392,145);
    cx.fillStyle=CAT_COLORS[def.category]||'#444'; cx.font='bold 16px monospace'; cx.textAlign='center'; cx.fillText(CAT_LABELS[def.category]||(def.category||'').toUpperCase(),256,28);
    cx.shadowColor='rgba(255,255,255,0.9)'; cx.shadowBlur=12; cx.fillStyle='#111'; cx.font='bold 38px Arial, sans-serif'; cx.fillText(def.label,256,80);
    cx.shadowBlur=0; cx.font='20px Arial, sans-serif'; cx.fillStyle='#333'; cx.fillText(def.desc,256,118);
    cx.strokeStyle='#555'; cx.lineWidth=1; cx.globalAlpha=0.4; cx.beginPath(); cx.moveTo(140,135); cx.lineTo(372,135); cx.stroke(); cx.globalAlpha=1;
    return new Mesh(new PlaneGeometry(3.2,1.0),new MeshBasicMaterial({map:new CanvasTexture(c),transparent:true,depthTest:false,side:DoubleSide}));
  }

  dispose() {
    for (const o of this._sceneObjects) this._scene.remove(o);
    for (const p of this._portals) this._scene.remove(p.group);
    if (this._floorMesh) { this._physicsWorld.removeBody(this._floorMesh); this._scene.remove(this._floorMesh); }
    this._sceneObjects=[]; this._portals=[]; this._iconMeshes=[]; this._particleRings=[]; this._labelMeshes=[];
    this._scene.fog=null;
    for (const fn of this._cleanups) fn();
    this._cleanups=[];
  }
}
