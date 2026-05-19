import {
  Scene, PerspectiveCamera, WebGLRenderer,
  AmbientLight, DirectionalLight,
  BoxGeometry, CylinderGeometry, SphereGeometry, ConeGeometry,
  MeshStandardMaterial, MeshBasicMaterial,
  Mesh, Vector3,
} from 'three';
import type { Signal } from '@preact/signals-core';
import type { BvhPhysicsWorld } from '@pmndrs/viverse';
import { setPlacedObject, getPlacedObject } from './components/placed-object.js';
import type { EditorCameraManager, BuilderGlobals } from './editor-camera-manager.js';

const GRID_SNAP = 1;
const PX_PER_M  = 22;

interface AssetDef {
  label: string; category: 'floor' | 'wall' | 'prop';
  planW: number; planD: number; yOffset: number; hexColor: number;
  createMesh(): Mesh;
}
const ASSETS: Record<string, AssetDef> = {
  'floor-1x1':  { label:'1×1 Floor',  category:'floor', planW:1, planD:1, yOffset:0.05, hexColor:0x7a6040, createMesh:()=>new Mesh(new BoxGeometry(1,0.1,1),   new MeshStandardMaterial({color:0x7a6040,roughness:0.9}))},
  'floor-2x2':  { label:'2×2 Floor',  category:'floor', planW:2, planD:2, yOffset:0.05, hexColor:0x7a6040, createMesh:()=>new Mesh(new BoxGeometry(2,0.1,2),   new MeshStandardMaterial({color:0x7a6040,roughness:0.9}))},
  'floor-4x4':  { label:'4×4 Floor',  category:'floor', planW:4, planD:4, yOffset:0.05, hexColor:0x7a6040, createMesh:()=>new Mesh(new BoxGeometry(4,0.1,4),   new MeshStandardMaterial({color:0x7a6040,roughness:0.9}))},
  'floor-plat': { label:'Platform',   category:'floor', planW:2, planD:2, yOffset:0.15, hexColor:0x557755, createMesh:()=>new Mesh(new BoxGeometry(2,0.3,2),   new MeshStandardMaterial({color:0x557755,roughness:0.8}))},
  'wall-1m':    { label:'Wall 1m',    category:'wall',  planW:1, planD:0.2,yOffset:1.5, hexColor:0xb09878, createMesh:()=>new Mesh(new BoxGeometry(1,3,0.2),   new MeshStandardMaterial({color:0xb09878,roughness:0.8}))},
  'wall-2m':    { label:'Wall 2m',    category:'wall',  planW:2, planD:0.2,yOffset:1.5, hexColor:0xb09878, createMesh:()=>new Mesh(new BoxGeometry(2,3,0.2),   new MeshStandardMaterial({color:0xb09878,roughness:0.8}))},
  'wall-4m':    { label:'Wall 4m',    category:'wall',  planW:4, planD:0.2,yOffset:1.5, hexColor:0xb09878, createMesh:()=>new Mesh(new BoxGeometry(4,3,0.2),   new MeshStandardMaterial({color:0xb09878,roughness:0.8}))},
  'wall-corner':{ label:'Corner',     category:'wall',  planW:0.3,planD:0.3,yOffset:1.5,hexColor:0xa08868, createMesh:()=>new Mesh(new BoxGeometry(0.3,3,0.3), new MeshStandardMaterial({color:0xa08868,roughness:0.8}))},
  'pillar':     { label:'Pillar',     category:'wall',  planW:0.35,planD:0.35,yOffset:1.5,hexColor:0x9898a8,createMesh:()=>new Mesh(new CylinderGeometry(0.15,0.15,3,8),new MeshStandardMaterial({color:0x9898a8,roughness:0.7}))},
  'prop-sphere':{ label:'Sphere',     category:'prop',  planW:1, planD:1, yOffset:0.5, hexColor:0x6688cc, createMesh:()=>new Mesh(new SphereGeometry(0.5,12,8), new MeshStandardMaterial({color:0x6688cc,roughness:0.5}))},
  'prop-cone':  { label:'Cone',       category:'prop',  planW:1, planD:1, yOffset:1,   hexColor:0x88aa66, createMesh:()=>new Mesh(new ConeGeometry(0.5,2,8),    new MeshStandardMaterial({color:0x88aa66,roughness:0.6}))},
};

interface ObjRecord { modelKey:string; gridX:number; gridZ:number; rotY:number; }

export class LevelBuilderManager {
  private _active = false;
  private _placed: Mesh[] = [];
  private _selectedMesh: Mesh | null = null;

  // DOM
  private _ui:       HTMLDivElement | null = null;
  private _planEl:   HTMLCanvasElement | null = null;
  private _planCtx:  CanvasRenderingContext2D | null = null;
  private _statusEl: HTMLElement | null = null;
  private _coordEl:  HTMLElement | null = null;
  private _propsEl:  HTMLElement | null = null;
  private _colorEl:  HTMLInputElement | null = null;
  private _assetGrid:HTMLElement | null = null;

  private _selectedAsset = 'floor-1x1';
  private _activeCat: 'floor'|'wall'|'prop' = 'floor';
  private _activeView: 'plan'|'3d' = 'plan';
  private _activeTool: 'select'|'place' = 'place';
  private _planDirty = true;
  private _pzoom = PX_PER_M; private _pox = 0; private _poy = 0;
  private _panning = false; private _panSX=0; private _panSY=0; private _panBX=0; private _panBY=0;
  private _ghostGX = 0; private _ghostGZ = 0; private _ghostOn = false;
  private _ghostMesh: Mesh | null = null;
  private _undo: ObjRecord[][] = []; private _redo: ObjRecord[][] = [];
  private _sceneObjs: any[] = [];
  private _cleanups: (() => void)[] = [];

  constructor(
    private _scene:       Scene,
    private _physicsWorld: BvhPhysicsWorld,
    private _camera:      PerspectiveCamera,
    private _renderer:    WebGLRenderer,
    private _globals:     BuilderGlobals,
    private _editorCam:   EditorCameraManager,
  ) {}

  activate() {
    this._active = true;
    this._addEditorScene();
    this._createUI();
    this._loadFromStorage();
  }

  deactivate() {
    this._active = false;
    this._destroyUI();
    this._removeEditorScene();
  }

  update(delta: number) {
    if (!this._active) return;
    if (this._planDirty && this._activeView === 'plan') { this._drawPlan(); this._planDirty = false; }
    if (this._ghostMesh) this._ghostMesh.visible = this._ghostOn && this._activeView === '3d';
    this._editorCam.update();
  }

  dispose() {
    this.deactivate();
    for (const fn of this._cleanups) fn();
    this._cleanups = [];
  }

  private _addEditorScene() {
    const ambient = new AmbientLight(0xffffff, 0.7);
    const sun     = new DirectionalLight(0xffeedd, 1.4);
    sun.position.set(8, 16, 6); sun.castShadow = true;
    this._scene.add(ambient, sun); this._sceneObjs.push(ambient, sun);
  }

  private _removeEditorScene() {
    for (const o of this._sceneObjs) this._scene.remove(o);
    this._sceneObjs = [];
    if (this._ghostMesh) { this._scene.remove(this._ghostMesh); (this._ghostMesh.material as any).dispose(); this._ghostMesh = null; }
  }

  private _createUI() {
    if (this._ui) return;
    const style = document.createElement('style');
    style.textContent = this._css();
    document.head.appendChild(style);
    this._cleanups.push(() => style.remove());

    const div = document.createElement('div');
    div.id = 'lb'; div.innerHTML = this._html();
    document.body.appendChild(div); this._ui = div;
    this._cleanups.push(() => div.remove());

    this._planEl   = div.querySelector<HTMLCanvasElement>('#lb-plan')!;
    this._planCtx  = this._planEl.getContext('2d')!;
    this._statusEl = div.querySelector('#lb-status-msg')!;
    this._coordEl  = div.querySelector('#lb-coord')!;
    this._propsEl  = div.querySelector('#lb-props')!;
    this._colorEl  = div.querySelector<HTMLInputElement>('#lb-obj-color')!;
    this._assetGrid= div.querySelector('#lb-assets')!;

    this._resizePlan();
    const onResize = () => this._resizePlan();
    window.addEventListener('resize', onResize);
    this._cleanups.push(() => window.removeEventListener('resize', onResize));
    this._pox = (this._planEl.width / (window.devicePixelRatio||1)) / 2;
    this._poy = (this._planEl.height / (window.devicePixelRatio||1)) / 2;
    this._wireEvents();
    this._renderAssets('floor');
    this._globals.builderActive.value = true;
    this._planDirty = true;
  }

  private _destroyUI() { this._ui?.remove(); this._ui = null; }

  private _wireEvents() {
    const q = <T extends HTMLElement>(sel: string) => this._ui!.querySelector<T>(sel)!;

    q('#lb-t-place').addEventListener('click', () => this._setTool('place'));
    q('#lb-t-select').addEventListener('click', () => this._setTool('select'));
    q('#lb-v-plan').addEventListener('click', () => this._setView('plan'));
    q('#lb-v-3d').addEventListener('click', () => this._setView('3d'));
    q('#lb-undo').addEventListener('click', () => this._doUndo());
    q('#lb-redo').addEventListener('click', () => this._doRedo());
    q('#lb-clear').addEventListener('click', () => { if (confirm('Clear all?')) this._clearAll(); });
    q('#lb-save').addEventListener('click', () => { this._saveToStorage(); this._status('Saved.'); });
    q('#lb-load').addEventListener('click', () => { this._loadFromStorage(); this._status('Loaded.'); });
    q('#lb-enter').addEventListener('click', () => this._enterExploreMode());
    q('#lb-recenter').addEventListener('click', () => this._recenterPlan());

    this._ui!.querySelectorAll<HTMLElement>('.lb-cat').forEach(btn =>
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat as 'floor'|'wall'|'prop';
        this._ui!.querySelectorAll('.lb-cat').forEach(b=>b.classList.remove('lb-cat-active'));
        btn.classList.add('lb-cat-active'); this._renderAssets(cat);
      }),
    );

    this._colorEl!.addEventListener('input', () => {
      if (!this._selectedMesh) return;
      const m = this._selectedMesh.material as MeshStandardMaterial;
      if (m?.color) m.color.setStyle(this._colorEl!.value);
      this._planDirty = true;
    });
    this._ui!.querySelectorAll<HTMLElement>('[data-rot]').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!this._selectedMesh) return;
        const rot = parseFloat(btn.dataset.rot!);
        this._selectedMesh.rotation.y = rot;
        const d = getPlacedObject(this._selectedMesh); if (d) d.rotY = rot;
        this._ui!.querySelectorAll('[data-rot]').forEach(b=>b.classList.remove('lb-rot-active'));
        btn.classList.add('lb-rot-active'); this._planDirty = true;
      }),
    );
    q('#lb-delete').addEventListener('click', () => {
      if (!this._selectedMesh) return;
      this._removeMesh(this._selectedMesh); this._selectedMesh = null; this._showProps(false);
    });

    const onKey = (e: KeyboardEvent) => {
      if (!this._active) return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this._selectedMesh) { this._removeMesh(this._selectedMesh); this._selectedMesh = null; this._showProps(false); }
      }
      if ((e.ctrlKey||e.metaKey) && e.key==='z') { e.preventDefault(); this._doUndo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.shiftKey&&e.key==='z'))) { e.preventDefault(); this._doRedo(); }
      if (e.key==='p'||e.key==='P') this._setTool('place');
      if (e.key==='s'||e.key==='S') this._setTool('select');
    };
    document.addEventListener('keydown', onKey);
    this._cleanups.push(() => document.removeEventListener('keydown', onKey));
    this._wirePlanCanvas();
  }

  private _wirePlanCanvas() {
    const el = this._planEl!; let moved = false;
    const onDown = (e: MouseEvent) => { moved=false; if(e.button===1||e.button===2){this._panning=true;this._panSX=e.clientX;this._panSY=e.clientY;this._panBX=this._pox;this._panBY=this._poy;} };
    const onMove = (e: MouseEvent) => {
      moved=true;
      if(this._panning){this._pox=this._panBX+(e.clientX-this._panSX);this._poy=this._panBY+(e.clientY-this._panSY);this._planDirty=true;return;}
      const[wx,wz]=this._c2w(e.offsetX,e.offsetY);
      this._ghostGX=this._snap(wx);this._ghostGZ=this._snap(wz);this._ghostOn=this._activeTool==='place';
      this._updateGhostMesh();
      if(this._coordEl)this._coordEl.textContent=`x:${this._ghostGX}  z:${this._ghostGZ}`;
      this._planDirty=true;
    };
    const onUp = (e: MouseEvent) => {
      if(this._panning){this._panning=false;return;} if(moved)return;
      const[wx,wz]=this._c2w(e.offsetX,e.offsetY);
      const gx=this._snap(wx),gz=this._snap(wz);
      if(this._activeTool==='place') this._placeObject(gx,gz);
      else this._selectMesh(this._hitTest(gx,gz));
    };
    const onLeave=()=>{this._ghostOn=false;this._panning=false;this._planDirty=true;};
    const onWheel=(e:WheelEvent)=>{
      e.preventDefault();const factor=e.deltaY<0?1.12:0.89;
      const[wx,wz]=this._c2w(e.offsetX,e.offsetY);
      this._pzoom=Math.max(4,Math.min(100,this._pzoom*factor));
      const[nx,nz]=this._w2c(wx,wz);this._pox+=e.offsetX-nx;this._poy+=e.offsetY-nz;this._planDirty=true;
    };
    el.addEventListener('mousedown',onDown);el.addEventListener('mousemove',onMove);el.addEventListener('mouseup',onUp);
    el.addEventListener('mouseleave',onLeave);el.addEventListener('wheel',onWheel,{passive:false});
    el.addEventListener('contextmenu',(e)=>e.preventDefault());
    this._cleanups.push(()=>{el.removeEventListener('mousedown',onDown);el.removeEventListener('mousemove',onMove);el.removeEventListener('mouseup',onUp);el.removeEventListener('mouseleave',onLeave);el.removeEventListener('wheel',onWheel);});
  }

  private _renderAssets(cat: 'floor'|'wall'|'prop') {
    this._activeCat=cat; if(!this._assetGrid)return; this._assetGrid.innerHTML='';
    const icons:Record<string,string>={floor:'▬',wall:'▐',prop:'●'};
    Object.entries(ASSETS).filter(([,d])=>d.category===cat).forEach(([key,def])=>{
      const btn=document.createElement('div');btn.className='lb-asset';
      if(key===this._selectedAsset)btn.classList.add('lb-asset-active');
      btn.innerHTML=`<span class="lb-asset-icon">${icons[cat]}</span><span>${def.label}</span>`;
      btn.addEventListener('click',()=>{
        this._selectedAsset=key;this._activeTool='place';
        this._assetGrid!.querySelectorAll('.lb-asset').forEach(b=>b.classList.remove('lb-asset-active'));
        btn.classList.add('lb-asset-active');this._setTool('place');this._updateGhostMesh();
        this._status(`Selected: ${def.label}`);
      });
      this._assetGrid!.appendChild(btn);
    });
  }

  private _resizePlan() {
    if(!this._planEl)return; const dpr=window.devicePixelRatio||1;
    const el=this._planEl; el.width=el.clientWidth*dpr; el.height=el.clientHeight*dpr;
    this._planCtx!.scale(dpr,dpr); this._planDirty=true;
  }

  private _recenterPlan() {
    if(!this._planEl)return; const dpr=window.devicePixelRatio||1;
    this._pox=(this._planEl.width/dpr)/2; this._poy=(this._planEl.height/dpr)/2;
    this._pzoom=PX_PER_M; this._planDirty=true;
  }

  private _drawPlan() {
    const ctx=this._planCtx; if(!ctx||!this._planEl)return;
    const dpr=window.devicePixelRatio||1, cw=this._planEl.width/dpr, ch=this._planEl.height/dpr;
    ctx.save(); ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#0a1628'; ctx.fillRect(0,0,cw,ch);
    const gStep=this._pzoom;
    ctx.strokeStyle='#152232'; ctx.lineWidth=1; ctx.beginPath();
    for(let x=((this._pox%gStep)+gStep)%gStep-gStep;x<cw+gStep;x+=gStep){ctx.moveTo(x,0);ctx.lineTo(x,ch);}
    for(let y=((this._poy%gStep)+gStep)%gStep-gStep;y<ch+gStep;y+=gStep){ctx.moveTo(0,y);ctx.lineTo(cw,y);}
    ctx.stroke();
    const mg=gStep*5; ctx.strokeStyle='#1a2e44'; ctx.lineWidth=1; ctx.beginPath();
    for(let x=((this._pox%mg)+mg)%mg-mg;x<cw+mg;x+=mg){ctx.moveTo(x,0);ctx.lineTo(x,ch);}
    for(let y=((this._poy%mg)+mg)%mg-mg;y<ch+mg;y+=mg){ctx.moveTo(0,y);ctx.lineTo(cw,y);}
    ctx.stroke();
    ctx.strokeStyle='#2a5070';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(this._pox-12,this._poy);ctx.lineTo(this._pox+12,this._poy);ctx.moveTo(this._pox,this._poy-12);ctx.lineTo(this._pox,this._poy+12);ctx.stroke();

    for(const mesh of this._placed){
      const d=getPlacedObject(mesh); if(!d||!ASSETS[d.modelKey])continue;
      const def=ASSETS[d.modelKey]; const[cx,cy]=this._w2c(d.gridX,d.gridZ);
      const pw=def.planW*this._pzoom, pd=def.planD*this._pzoom, isSel=mesh===this._selectedMesh;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(d.rotY);
      if(def.category==='floor'){ctx.fillStyle=isSel?'#2a6040':'#1e3830';ctx.strokeStyle=isSel?'#44cc88':'#3a7060';}
      else if(def.category==='wall'){ctx.fillStyle=isSel?'#5a4a3a':'#2e2418';ctx.strokeStyle=isSel?'#dda060':'#7a5a38';}
      else{ctx.fillStyle=isSel?'#2a3a5a':'#1a2040';ctx.strokeStyle=isSel?'#6080dd':'#3a50a0';}
      ctx.lineWidth=isSel?2:1;ctx.fillRect(-pw/2,-pd/2,pw,pd);ctx.strokeRect(-pw/2,-pd/2,pw,pd);
      ctx.restore();
    }
    if(this._ghostOn&&this._activeTool==='place'&&ASSETS[this._selectedAsset]){
      const def=ASSETS[this._selectedAsset];const[cx,cy]=this._w2c(this._ghostGX,this._ghostGZ);
      ctx.fillStyle='rgba(64,128,255,0.25)';ctx.strokeStyle='#4080ff';ctx.lineWidth=1;
      ctx.fillRect(cx-def.planW*this._pzoom/2,cy-def.planD*this._pzoom/2,def.planW*this._pzoom,def.planD*this._pzoom);
      ctx.strokeRect(cx-def.planW*this._pzoom/2,cy-def.planD*this._pzoom/2,def.planW*this._pzoom,def.planD*this._pzoom);
    }
    ctx.restore();
  }

  private _w2c(wx:number,wz:number):[number,number]{return[wx*this._pzoom+this._pox,wz*this._pzoom+this._poy];}
  private _c2w(cx:number,cy:number):[number,number]{return[(cx-this._pox)/this._pzoom,(cy-this._poy)/this._pzoom];}
  private _snap(v:number){return Math.round(v/GRID_SNAP)*GRID_SNAP;}

  private _placeObject(gx:number,gz:number){
    const key=this._selectedAsset,def=ASSETS[key]; if(!def)return;
    this._pushUndo();
    const mesh=def.createMesh();
    mesh.position.set(gx,def.yOffset,gz); mesh.castShadow=mesh.receiveShadow=true;
    setPlacedObject(mesh,{modelKey:key,category:def.category,gridX:gx,gridZ:gz,rotY:0});
    this._scene.add(mesh); this._placed.push(mesh);
    this._planDirty=true; this._status(`Placed ${def.label} at (${gx},${gz})`);
  }

  private _removeMesh(mesh:Mesh){
    this._pushUndo();
    if(mesh.userData.__hasPhysics){this._physicsWorld.removeBody(mesh);mesh.userData.__hasPhysics=false;}
    this._scene.remove(mesh); this._placed.splice(this._placed.indexOf(mesh),1);
    this._planDirty=true;
  }

  private _clearAll(){
    this._pushUndo();
    for(const m of [...this._placed])this._removeMesh(m);
    this._selectedMesh=null; this._showProps(false);
    this._planDirty=true; this._status('Cleared.');
  }

  private _updateGhostMesh(){
    if(this._ghostMesh){this._scene.remove(this._ghostMesh);(this._ghostMesh.material as any).dispose();this._ghostMesh=null;}
    const def=ASSETS[this._selectedAsset]; if(!def||!this._ghostOn)return;
    const ghost=def.createMesh();
    (ghost.material as MeshStandardMaterial).dispose();
    ghost.material=new MeshBasicMaterial({color:0x4488ff,transparent:true,opacity:0.4,depthWrite:false});
    ghost.position.set(this._ghostGX,def.yOffset,this._ghostGZ);
    ghost.visible=this._activeView==='3d'; this._scene.add(ghost); this._ghostMesh=ghost;
  }

  private _hitTest(gx:number,gz:number):Mesh|null{
    for(const mesh of this._placed){
      const d=getPlacedObject(mesh); if(!d)continue; const def=ASSETS[d.modelKey]; if(!def)continue;
      const hw=def.planW/2+0.1,hd=def.planD/2+0.1;
      if(gx>=d.gridX-hw&&gx<=d.gridX+hw&&gz>=d.gridZ-hd&&gz<=d.gridZ+hd)return mesh;
    }
    return null;
  }

  private _selectMesh(mesh:Mesh|null){
    this._selectedMesh=mesh; this._showProps(mesh!==null);
    if(mesh){const m=mesh.material as MeshStandardMaterial;if(m?.color&&this._colorEl)this._colorEl.value='#'+m.color.getHexString();}
    this._planDirty=true;
  }

  private _showProps(visible:boolean){this._propsEl?.classList.toggle('lb-visible',visible);}

  private _setView(view:'plan'|'3d'){
    this._activeView=view;
    const planEl=this._planEl,vpEl=this._ui?.querySelector<HTMLElement>('#lb-viewport');
    if(view==='plan'){planEl?.classList.remove('lb-3d-mode');vpEl?.classList.remove('lb-3d-active');this._globals.builderView.value='plan';}
    else{
      planEl?.classList.add('lb-3d-mode');vpEl?.classList.add('lb-3d-active');this._globals.builderView.value='3d';
      let cx=0,cz=0,n=0;
      for(const m of this._placed){const d=getPlacedObject(m);if(d){cx+=d.gridX;cz+=d.gridZ;n++;}}
      if(n>0)this._editorCam.setTarget(cx/n,0.5,cz/n);
    }
    this._ui?.querySelector('#lb-v-plan')?.classList.toggle('lb-view-active',view==='plan');
    this._ui?.querySelector('#lb-v-3d')?.classList.toggle('lb-view-active',view==='3d');
    if(this._ghostMesh)this._ghostMesh.visible=view==='3d'&&this._ghostOn;
    this._planDirty=true;
  }

  private _setTool(tool:'select'|'place'){
    this._activeTool=tool;
    this._ui?.querySelector('#lb-t-place')?.classList.toggle('lb-tool-active',tool==='place');
    this._ui?.querySelector('#lb-t-select')?.classList.toggle('lb-tool-active',tool==='select');
    if(tool==='select'){this._ghostOn=false;this._planDirty=true;}
  }

  private _enterExploreMode(){
    for(const mesh of this._placed){
      const d=getPlacedObject(mesh); if(!d)continue;
      if((d.category==='floor'||d.category==='wall')&&!mesh.userData.__hasPhysics){
        mesh.updateWorldMatrix(true,true);
        this._physicsWorld.addBody(mesh,false);
        mesh.userData.__hasPhysics=true;
      }
    }
    if(this._ui)this._ui.style.display='none';
    this._globals.builderActive.value=false;
    this._status('Explore mode — press [Escape] or close browser to return to builder.');
  }

  private _pushUndo(){this._undo.push(this._serialize());this._redo=[];if(this._undo.length>50)this._undo.shift();}
  private _doUndo(){if(!this._undo.length)return;this._redo.push(this._serialize());this._restoreSnapshot(this._undo.pop()!);}
  private _doRedo(){if(!this._redo.length)return;this._undo.push(this._serialize());this._restoreSnapshot(this._redo.pop()!);}

  private _serialize():ObjRecord[]{
    return this._placed.map(m=>{const d=getPlacedObject(m)!;return{modelKey:d.modelKey,gridX:d.gridX,gridZ:d.gridZ,rotY:d.rotY};});
  }

  private _restoreSnapshot(records:ObjRecord[]){
    for(const m of[...this._placed])this._removeMesh(m);
    this._selectedMesh=null;this._showProps(false);
    for(const r of records)this._recreate(r);this._planDirty=true;
  }

  private _recreate(r:ObjRecord){
    const def=ASSETS[r.modelKey]; if(!def)return;
    const mesh=def.createMesh();
    mesh.position.set(r.gridX,def.yOffset,r.gridZ); mesh.rotation.y=r.rotY;
    mesh.castShadow=mesh.receiveShadow=true;
    setPlacedObject(mesh,{modelKey:r.modelKey,category:def.category,gridX:r.gridX,gridZ:r.gridZ,rotY:r.rotY});
    this._scene.add(mesh); this._placed.push(mesh);
  }

  private _saveToStorage(){localStorage.setItem('lb-level',JSON.stringify(this._serialize()));}
  private _loadFromStorage(){
    const raw=localStorage.getItem('lb-level'); if(!raw)return;
    try{const records:ObjRecord[]=JSON.parse(raw);for(const m of[...this._placed])this._removeMesh(m);for(const r of records)this._recreate(r);this._planDirty=true;this._status(`Loaded ${records.length} objects.`);}catch{}
  }
  private _status(msg:string){if(this._statusEl)this._statusEl.textContent=msg;}

  private _html(){return`<div id="lb-toolbar"><span class="lb-brand">⬡ Level Builder</span><div class="lb-sep"></div><button class="lb-tool lb-tool-active" id="lb-t-place">＋ Place</button><button class="lb-tool" id="lb-t-select">↖ Select</button><div class="lb-sep"></div><button id="lb-undo">↩</button><button id="lb-redo">↪</button><button id="lb-clear">⊗</button><div class="lb-sep"></div><button id="lb-save">💾 Save</button><button id="lb-load">📂 Load</button><div class="lb-flex"></div><button class="lb-view-btn lb-view-active" id="lb-v-plan">📐 Plan</button><button class="lb-view-btn" id="lb-v-3d">⬛ 3D</button><div class="lb-sep"></div><button id="lb-enter" class="lb-enter-btn">▶ Enter World</button></div><div id="lb-main"><div id="lb-sidebar"><div id="lb-cats"><button class="lb-cat lb-cat-active" data-cat="floor">Floor</button><button class="lb-cat" data-cat="wall">Wall</button><button class="lb-cat" data-cat="prop">Prop</button></div><div id="lb-assets"></div><div id="lb-props"><div class="lb-prop-title">Properties</div><div class="lb-prop-row"><span>Rotation</span><div id="lb-rot-btns"><button data-rot="0">0°</button><button data-rot="1.5708">90°</button><button data-rot="3.1416">180°</button><button data-rot="4.7124">270°</button></div></div><div class="lb-prop-row"><span>Color</span><input type="color" id="lb-obj-color" value="#b09878"></div><button id="lb-delete" class="lb-delete-btn">🗑 Delete</button></div></div><div id="lb-viewport"><canvas id="lb-plan"></canvas><div id="lb-vp-hud"><button id="lb-recenter">⊕</button><span id="lb-coord"></span></div></div></div><div id="lb-statusbar"><span id="lb-status-msg">Select an asset and click the grid.</span></div>`;}

  private _css(){return`#lb{position:fixed;inset:0;display:flex;flex-direction:column;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#c8d8e8;z-index:1000;pointer-events:none;background:transparent;}#lb-toolbar{pointer-events:all;flex-shrink:0;height:46px;background:#0d1b2a;border-bottom:1px solid #1e3a5f;display:flex;align-items:center;padding:0 10px;gap:5px;}.lb-brand{font-weight:600;font-size:14px;color:#7ab8e8;margin-right:4px;}.lb-sep{width:1px;height:24px;background:#1e3a5f;margin:0 2px;}.lb-flex{flex:1;}#lb-toolbar button{background:#152230;border:1px solid #2a4a6a;color:#a8c8e0;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;}#lb-toolbar button:hover{background:#1e3a5f;}.lb-tool-active{background:#1e3a5f !important;color:#fff !important;border-color:#4080c0 !important;}.lb-view-active{background:#1e3a5f !important;color:#fff !important;}.lb-enter-btn{background:#0e5a28 !important;color:#88ffaa !important;border-color:#1a9a44 !important;font-weight:600;padding:4px 14px !important;}.lb-enter-btn:hover{background:#1a7a38 !important;}#lb-main{flex:1;display:flex;overflow:hidden;pointer-events:none;}#lb-sidebar{pointer-events:all;width:180px;background:#0f1a27;border-right:1px solid #1e3a5f;display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto;}#lb-cats{display:flex;}.lb-cat{flex:1;background:#0d1b2a;border:none;border-bottom:2px solid transparent;color:#7090a8;padding:8px 4px;cursor:pointer;font-size:12px;}.lb-cat:hover{color:#c8d8e8;}.lb-cat-active{color:#a8d8ff;border-bottom-color:#4080c0;background:#111f2e;}#lb-assets{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:6px;}.lb-asset{background:#152230;border:1px solid #1e3a5f;border-radius:4px;padding:8px 4px;cursor:pointer;text-align:center;font-size:11px;color:#a0b8c8;display:flex;flex-direction:column;align-items:center;gap:3px;}.lb-asset:hover{background:#1e3a5f;color:#c8e8ff;}.lb-asset-active{border-color:#4080c0 !important;background:#1a3050 !important;color:#fff !important;}.lb-asset-icon{font-size:20px;}#lb-props{border-top:1px solid #1e3a5f;padding:8px;display:none;flex-direction:column;gap:6px;}#lb-props.lb-visible{display:flex;}.lb-prop-title{font-size:11px;color:#6080a0;text-transform:uppercase;letter-spacing:0.05em;}.lb-prop-row{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#8098b0;}#lb-rot-btns{display:flex;gap:2px;}#lb-rot-btns button{flex:1;background:#152230;border:1px solid #1e3a5f;color:#a0b8c8;border-radius:3px;padding:2px 0;cursor:pointer;font-size:10px;}#lb-rot-btns button:hover{background:#1e3a5f;}#lb-rot-btns button.lb-rot-active{background:#1e3a5f;color:#fff;border-color:#4080c0;}#lb-obj-color{width:100%;height:24px;border:1px solid #1e3a5f;border-radius:3px;cursor:pointer;background:none;}.lb-delete-btn{background:#3a1010 !important;border:1px solid #6a2020 !important;color:#ff8888 !important;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:12px;width:100%;}.lb-delete-btn:hover{background:#5a1818 !important;}#lb-viewport{flex:1;position:relative;pointer-events:none;}#lb-plan{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:all;cursor:crosshair;}#lb-plan.lb-3d-mode{pointer-events:none;display:none;}#lb-viewport.lb-3d-active{pointer-events:all;}#lb-vp-hud{pointer-events:all;position:absolute;top:8px;right:10px;display:flex;align-items:center;gap:8px;}#lb-recenter{background:#0d1b2acc;border:1px solid #1e3a5f;color:#7ab8e8;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:13px;}#lb-coord{font-size:11px;color:#406080;}#lb-statusbar{pointer-events:none;flex-shrink:0;height:22px;background:#0d1b2a;border-top:1px solid #1e3a5f;display:flex;align-items:center;padding:0 10px;color:#4a7090;}`;}
}
