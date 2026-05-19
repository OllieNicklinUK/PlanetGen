import {
  Scene, PerspectiveCamera, Vector3, AnimationMixer,
} from 'three';
import type { AnimationAction, AnimationClip } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const ALERT_RADIUS   = 8;
const CLEAR_RADIUS   = 10;
const INTERACT_DIST  = 2.5;
const LOOK_SPEED     = 3.0;

type NpcState = 'idle' | 'alerted' | 'interacting';

interface NpcRuntime {
  scene:       any;
  mixer:       AnimationMixer | null;
  idleAction:  AnimationAction | null;
  alertAction: AnimationAction | null;
  state:       NpcState;
  name:        string;
  dialogue:    string;
  worldPos:    Vector3;
  object3D:    any;
}

export interface NpcSpawnDef {
  x: number;
  z: number;
  y: number;
  name: string;
  dialogue: string;
  modelUrl: string;
}

export class NpcManager {
  private _loader    = new GLTFLoader();
  private _npcs:       NpcRuntime[] = [];
  private _playerPos = new Vector3();
  private _npcPos    = new Vector3();
  private _lookDir   = new Vector3();
  private _panel:    HTMLDivElement | null = null;
  private _cleanups: (() => void)[] = [];
  private _activeNpc: NpcRuntime | null = null;

  constructor(
    private _scene: Scene,
    private _camera: PerspectiveCamera,
    private _getPlayerPos: () => Vector3,
  ) {}

  init() {
    this._buildPanel();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this._panel) {
        this._panel.style.display = 'none';
        if (this._activeNpc) {
          this._activeNpc.state = 'alerted';
          this._activeNpc = null;
        }
      }
    };
    document.addEventListener('keydown', onKey);
    this._cleanups.push(() => document.removeEventListener('keydown', onKey));
  }

  addNpc(def: NpcSpawnDef) {
    const runtime: NpcRuntime = {
      scene:       null,
      mixer:       null,
      idleAction:  null,
      alertAction: null,
      state:       'idle',
      name:        def.name,
      dialogue:    def.dialogue,
      worldPos:    new Vector3(def.x, def.y, def.z),
      object3D:    null,
    };
    this._npcs.push(runtime);

    this._loader.loadAsync(def.modelUrl)
      .then((gltf: GLTF) => {
        const root = gltf.scene;
        root.position.set(def.x, def.y, def.z);
        root.traverse((o: any) => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
        this._scene.add(root);
        runtime.scene  = root;
        runtime.object3D = root;

        if (gltf.animations?.length) {
          const mixer   = new AnimationMixer(root);
          runtime.mixer = mixer;

          const findClip = (...names: string[]): AnimationClip =>
            gltf.animations.find((c: AnimationClip) =>
              names.some((n) => c.name.toLowerCase().includes(n)),
            ) ?? gltf.animations[0];

          const idleClip  = findClip('idle', 'stand', 'wait', 'tpose', 't-pose');
          const alertClip = gltf.animations.find((c: AnimationClip) =>
            ['wave', 'react', 'hello', 'look', 'greet'].some((n) => c.name.toLowerCase().includes(n)),
          ) ?? null;

          runtime.idleAction = mixer.clipAction(idleClip);
          runtime.idleAction.play();
          if (alertClip) {
            runtime.alertAction = mixer.clipAction(alertClip);
            runtime.alertAction.enabled = false;
          }
        }
      })
      .catch((e: Error) => console.warn('[NpcManager] model load failed:', def.modelUrl, e));
  }

  update(delta: number) {
    this._playerPos.copy(this._getPlayerPos());

    for (const rt of this._npcs) {
      if (rt.mixer) rt.mixer.update(delta);
      if (!rt.object3D) continue;

      rt.object3D.getWorldPosition(this._npcPos);
      const dist = this._playerPos.distanceTo(this._npcPos);

      if (rt.state !== 'interacting') {
        if (rt.state === 'idle' && dist < ALERT_RADIUS) {
          this._transition(rt, 'alerted');
        } else if (rt.state === 'alerted' && dist > CLEAR_RADIUS) {
          this._transition(rt, 'idle');
        }

        // Auto-interact on proximity
        if (rt.state === 'alerted' && dist < INTERACT_DIST && this._activeNpc !== rt) {
          this._showDialogue(rt);
        }
      }

      if (rt.state !== 'idle') {
        this._lookDir.subVectors(this._playerPos, this._npcPos);
        this._lookDir.y = 0;
        if (this._lookDir.lengthSq() > 0.001) {
          const target = Math.atan2(this._lookDir.x, this._lookDir.z);
          const cur    = rt.object3D.rotation.y;
          const diff   = ((target - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          rt.object3D.rotation.y += diff * Math.min(1, LOOK_SPEED * delta);
        }
      }
    }
  }

  private _showDialogue(rt: NpcRuntime) {
    if (!this._panel) return;
    this._activeNpc = rt;
    rt.state = 'interacting';
    (this._panel.querySelector('#npc-name') as HTMLElement).textContent = rt.name;
    (this._panel.querySelector('#npc-text') as HTMLElement).textContent = rt.dialogue;
    this._panel.style.display = 'flex';
  }

  private _transition(rt: NpcRuntime, to: NpcState) {
    if (rt.state === to) return;
    rt.state = to;
    if (!rt.mixer) return;
    if (to === 'alerted' && rt.alertAction) {
      rt.idleAction?.fadeOut(0.3);
      rt.alertAction.reset().fadeIn(0.3).play();
      rt.alertAction.enabled = true;
    } else if (to === 'idle') {
      rt.alertAction?.fadeOut(0.3);
      rt.idleAction?.reset().fadeIn(0.3).play();
    }
  }

  private _buildPanel() {
    const div = document.createElement('div');
    div.id = 'npc-panel';
    div.style.cssText = `
      display:none; position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:rgba(10,10,20,0.92); border:1px solid rgba(100,160,255,0.4);
      border-radius:10px; padding:18px 24px; max-width:400px; min-width:260px;
      font-family:monospace; color:#cce0ff; z-index:999; flex-direction:column; gap:8px;
      backdrop-filter:blur(10px);
    `;
    div.innerHTML = `
      <div style="font-size:13px;font-weight:bold;color:#88bbff;letter-spacing:1px;" id="npc-name">NPC</div>
      <div style="font-size:12px;line-height:1.5;" id="npc-text"></div>
      <div style="font-size:10px;color:#556677;margin-top:4px;">Press Esc to close</div>
    `;
    document.body.appendChild(div);
    this._panel = div;
    this._cleanups.push(() => div.remove());
  }

  dispose() {
    for (const rt of this._npcs) {
      if (rt.scene) this._scene.remove(rt.scene);
      rt.mixer?.stopAllAction();
    }
    this._npcs = [];
    for (const fn of this._cleanups) fn();
    this._cleanups = [];
  }
}
