// NPC System — interactive avatar NPCs with GLB/VRM models, AnimationMixer,
// proximity look-at, and point-to-interact dialogue.
//
// Usage: addComponent(NpcAgent, { modelUrl, npcName, dialogue }) on any entity,
// then position entity.object3D where you want the NPC to stand.
// The system loads the GLB, attaches it, and handles all interaction logic.

import {
  createSystem,
  createComponent,
  Types,
  Interactable,
  Pressed,
  Vector3,
  AssetManager,
} from '@iwsdk/core';
import type { AnimationAction, AnimationClip } from 'three';
import { AnimationMixer } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALERT_RADIUS = 8; // m — NPC starts facing player
const CLEAR_RADIUS = 10; // m — hysteresis, returns to idle
const LOOK_SPEED = 3.0; // rad/s max rotation toward player

// ── Component ─────────────────────────────────────────────────────────────────

export const NpcAgent = createComponent('NpcAgent', {
  modelUrl: { type: Types.String, default: '/gltf/robot/robot.gltf' },
  npcName: { type: Types.String, default: 'Wanderer' },
  dialogue: { type: Types.String, default: 'Hello, traveller.' },
});

// ── Runtime data (Map — holds non-serialisable Three.js objects) ──────────────

type NpcState = 'idle' | 'alerted' | 'interacting';

interface NpcRuntime {
  mixer: AnimationMixer | null;
  idleAction: AnimationAction | null;
  alertAction: AnimationAction | null;
  state: NpcState;
  name: string;
  dialogue: string;
}

// ── System ────────────────────────────────────────────────────────────────────

export class NpcSystem extends createSystem(
  {
    npcs: { required: [NpcAgent] },
    pressed: { required: [NpcAgent, Pressed] },
  },
  {},
) {
  // Keyed by entity.index — NOT stored as entity array (anti-pattern)
  private _runtimes = new Map<number, NpcRuntime>();
  private _playerPos = new Vector3();
  private _npcPos = new Vector3();
  private _lookDir = new Vector3();
  private _panel: HTMLDivElement | null = null;

  init() {
    this._buildPanel();

    this.queries.npcs.subscribe('qualify', (entity) => {
      // Read config synchronously before async load begins
      const modelUrl = entity.getValue(NpcAgent, 'modelUrl') as string;
      const npcName = entity.getValue(NpcAgent, 'npcName') as string;
      const dialogue = entity.getValue(NpcAgent, 'dialogue') as string;

      // Pre-create slot so disqualify can guard against in-flight loads
      this._runtimes.set(entity.index, {
        mixer: null,
        idleAction: null,
        alertAction: null,
        state: 'idle',
        name: npcName,
        dialogue,
      });

      AssetManager.loadGLTF(modelUrl, `npc_${entity.index}`)
        .then((gltf: GLTF) => {
          if (!this._runtimes.has(entity.index)) {
            return;
          } // removed during load
          const rt = this._runtimes.get(entity.index)!;

          const root = gltf.scene;
          root.traverse((o: any) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          entity.object3D.add(root);

          // Only add Interactable once the mesh geometry is present,
          // so InputSystem's BVH has something to raycast against.
          entity.addComponent(Interactable);

          if (gltf.animations?.length) {
            const mixer = new AnimationMixer(root);
            rt.mixer = mixer;

            const findClip = (...names: string[]): AnimationClip =>
              gltf.animations.find((c: AnimationClip) =>
                names.some((n) => c.name.toLowerCase().includes(n)),
              ) ?? gltf.animations[0];

            const idleClip = findClip('idle', 'stand', 'wait', 'tpose', 't-pose');
            const alertClip =
              gltf.animations.find((c: AnimationClip) =>
                ['wave', 'react', 'hello', 'look', 'greet'].some((n) =>
                  c.name.toLowerCase().includes(n),
                ),
              ) ?? null;

            rt.idleAction = mixer.clipAction(idleClip);
            rt.idleAction.play();
            if (alertClip) {
              rt.alertAction = mixer.clipAction(alertClip);
              rt.alertAction.enabled = false;
            }
          }
        })
        .catch((e: Error) => console.warn('[NpcSystem] model load failed:', modelUrl, e));
    });

    this.queries.npcs.subscribe('disqualify', (entity) => {
      const rt = this._runtimes.get(entity.index);
      if (rt?.mixer) {
        rt.mixer.stopAllAction();
        rt.mixer.uncacheRoot(rt.mixer.getRoot());
      }
      this._runtimes.delete(entity.index);
    });

    // Show dialogue when player points and selects an NPC
    this.queries.pressed.subscribe('qualify', (entity) => {
      const rt = this._runtimes.get(entity.index);
      if (!rt || !this._panel) {
        return;
      }
      (this._panel.querySelector('#npc-name') as HTMLElement).textContent = rt.name;
      (this._panel.querySelector('#npc-text') as HTMLElement).textContent = rt.dialogue;
      this._panel.style.display = 'flex';
      rt.state = 'interacting';
    });

    this.cleanupFuncs.push(() => {
      this._panel?.remove();
      this._panel = null;
    });
  }

  update(delta: number) {
    const player = (this as any).player;
    if (!player?.head) {
      return;
    }
    player.head.getWorldPosition(this._playerPos);

    for (const entity of this.queries.npcs.entities) {
      const rt = this._runtimes.get(entity.index);
      if (!rt) {
        continue;
      }

      rt.mixer?.update(delta);

      entity.object3D.getWorldPosition(this._npcPos);
      const dist = this._playerPos.distanceTo(this._npcPos);

      // State transitions (don't interrupt interacting state)
      if (rt.state === 'idle' && dist < ALERT_RADIUS) {
        this._transition(rt, 'alerted');
      } else if (rt.state === 'alerted' && dist > CLEAR_RADIUS) {
        this._transition(rt, 'idle');
      }

      // Look at player on Y axis when alerted or interacting
      if (rt.state !== 'idle') {
        this._lookDir.subVectors(this._playerPos, this._npcPos);
        this._lookDir.y = 0;
        if (this._lookDir.lengthSq() > 0.001) {
          const target = Math.atan2(this._lookDir.x, this._lookDir.z);
          const cur = entity.object3D.rotation.y;
          // Shortest-path angle diff, clamped by look speed
          const diff = ((target - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          entity.object3D.rotation.y += diff * Math.min(1, LOOK_SPEED * delta);
        }
      }
    }
  }

  private _transition(rt: NpcRuntime, to: NpcState) {
    if (rt.state === to) {
      return;
    }
    rt.state = to;
    if (to === 'alerted') {
      rt.idleAction?.fadeOut(0.3);
      if (rt.alertAction) {
        rt.alertAction.enabled = true;
        rt.alertAction.reset().fadeIn(0.3).play();
      }
    } else if (to === 'idle') {
      rt.alertAction?.fadeOut(0.3);
      rt.idleAction?.reset().fadeIn(0.3).play();
    }
  }

  private _buildPanel() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      'bottom:80px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(0,5,20,0.93)',
      'border:1px solid rgba(100,200,255,0.28)',
      'border-radius:12px',
      'padding:22px 30px',
      'color:#d0eeff',
      'font-family:sans-serif',
      'font-size:14px',
      'min-width:300px',
      'max-width:480px',
      'z-index:9999',
      'display:none',
      'flex-direction:column',
      'gap:14px',
      'pointer-events:auto',
      'box-shadow:0 4px 32px rgba(0,40,80,0.6)',
    ].join(';');

    el.innerHTML = `
      <div id="npc-name"
        style="font-size:16px;font-weight:bold;color:#88ddff;letter-spacing:0.5px"></div>
      <div id="npc-text"
        style="line-height:1.75;color:#c8e8ff"></div>
      <button id="npc-close"
        style="align-self:flex-end;padding:7px 20px;background:rgba(80,160,255,0.12);border:1px solid rgba(100,200,255,0.3);border-radius:6px;color:#88ccff;cursor:pointer;font-size:13px;font-family:inherit">
        Close
      </button>
    `;

    el.querySelector('#npc-close')!.addEventListener('click', () => {
      el.style.display = 'none';
    });

    document.body.appendChild(el);
    this._panel = el;
  }
}
