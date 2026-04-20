// ═══════════════════════════════════════════════════════════════════════════════
// Hub Host Avatar — Saneko VRM Host integrated from VTubeJS_Min-master
//
// This module re-uses the VTubeJS modular architecture (EventBus, StateManager,
// VRMRenderer) via direct ES module imports. It adapts VRMRenderer to work
// inside the hub's existing Three.js scene (instead of owning its own scene).
//
// The host avatar stands near the center of the hub as a welcoming guide.
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMExpressionPresetName } from '@pixiv/three-vrm';

// ──────────────────────────────────────────────────────────────────────────────
// Lightweight EventBus & StateManager from VTubeJS (imported directly)
// ──────────────────────────────────────────────────────────────────────────────
import { EventBus } from './core/EventBus.js';
import { StateManager } from './core/StateManager.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const DEG = Math.PI / 180;

// Fallback paths for the Saneko VRM (Vite serves from project root in dev)
const SANEKO_VRM_CANDIDATES = [
  '/models/Saneko_Modest_viverse2.vrm',
  '/VTubeJS_Min-master/VTubeJS_Min-master/public/VRMS_forFacetracking/Saneko_Modest_viverse2.vrm',
  '/models/Saneko_Modest_viverse2.vrm',
];

/**
 * HubHostAvatar — loads the Saneko VRM into any Three.js scene and runs
 * the full idle animation system (head bob, blink, expression, arm gestures)
 * from VTubeJS_Min-master, without duplicating the logic.
 */
export class HubHostAvatar {
  constructor() {
    this.eventBus = new EventBus();
    this.stateManager = new StateManager();

    // VRM runtime
    this.vrm = null;
    this.vrmScene = null;
    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser));

    // Humanoid bone cache
    this.bones = {
      head: null, neck: null, spine: null, chest: null,
      leftUpperArm: null, rightUpperArm: null,
      leftLowerArm: null, rightLowerArm: null,
      leftHand: null, rightHand: null,
      leftShoulder: null, rightShoulder: null,
    };

    // Idle animation state
    this.idleTime = 0;
    this.idleStartTime = Date.now();
    this.lastBlink = 0;
    this.blinking = false;
    this.blinkEnd = 0;
    this._envSmooth = 0;

    // Arm gesture state
    this._armGestureTime = 0;
    this._nextGestureAt = 3 + Math.random() * 4; // seconds until next gesture
    this._gestureActive = false;
    this._gestureType = 0;
    this._gestureProgress = 0;
    this._gestureDuration = 2.0;

    // Chat / speech state
    this._speaking = false;
    this._speechEnvelope = 0;

    // Expose for external control
    this.loaded = false;
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  async load(scene, opts = {}) {
    const position = opts.position || [0, 0, -5];
    const rotationY = opts.rotationY ?? (Math.PI + 0.35);
    const scale = opts.scale ?? 1;

    let url = opts.url || null;
    if (!url) {
      for (const candidate of SANEKO_VRM_CANDIDATES) {
        try {
          const resp = await fetch(candidate, { method: 'HEAD' });
          if (resp.ok) { url = candidate; break; }
        } catch (_) {}
      }
      if (!url) url = SANEKO_VRM_CANDIDATES[0];
    }

    try {
      console.log(`🤖 HubHostAvatar: loading ${url}`);
      const gltf = await this.loader.loadAsync(url);
      this.vrm = gltf.userData.vrm;
      this.vrmScene = this.vrm.scene;

      this.vrmScene.position.set(...position);
      this.vrmScene.rotation.y = rotationY;
      this.vrmScene.scale.setScalar(scale);

      this.vrmScene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
        }
      });

      scene.add(this.vrmScene);

      this._cacheBones();
      this._applyBasePose();

      this.loaded = true;
      console.log('🤖 HubHostAvatar: Saneko loaded successfully');
      return true;
    } catch (e) {
      console.error('🤖 HubHostAvatar: load failed', e);
      return false;
    }
  }

  // ── Update (call every frame) ──────────────────────────────────────────
  update(delta) {
    if (!this.vrm || !this.loaded) return;
    this.idleTime += delta;

    const elapsed = (Date.now() - this.idleStartTime) / 1000;
    const head = this.bones.head;

    // ── Head bob (from VTubeJS VRMRenderer._animateIdle) ──
    if (head) {
      const lfo1x = Math.sin(elapsed * 0.17) * 0.9;
      const lfo2x = Math.sin(elapsed * 0.11) * 0.6;
      const lfo1y = Math.sin(elapsed * 0.13) * 0.6;
      const lfo2y = Math.sin(elapsed * 0.07) * 0.4;

      const baseAmp = 2.3;
      const baseSpd = 1.5;
      const baseX = Math.sin(elapsed * baseSpd * 0.9) * (baseAmp * 0.6);
      const baseY = Math.cos(elapsed * baseSpd * 0.8) * (baseAmp * 0.4);

      const envAlpha = 0.08;
      this._envSmooth = THREE.MathUtils.lerp(this._envSmooth, this._speechEnvelope, envAlpha);
      const envPitch = this._envSmooth * 9.0;
      const envYaw = this._envSmooth * 3.0;

      const xDeg = baseX + lfo1x + lfo2x + envPitch;
      const yDeg = baseY + lfo1y + lfo2y + envYaw;

      const maxStep = 2.4 * DEG;
      const targetX = xDeg * DEG;
      const targetY = yDeg * DEG;
      const nextX = THREE.MathUtils.clamp(targetX, head.rotation.x - maxStep, head.rotation.x + maxStep);
      const nextY = THREE.MathUtils.clamp(targetY, head.rotation.y - maxStep, head.rotation.y + maxStep);
      head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, nextX, 0.16);
      head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, nextY, 0.16);
    }

    // ── Spine & chest breathing sway ──
    if (this.bones.spine) {
      this.bones.spine.rotation.z = Math.sin(this.idleTime * 0.6) * 0.5 * DEG;
      this.bones.spine.rotation.x = Math.sin(this.idleTime * 0.35) * 0.8 * DEG; // breathing
    }
    if (this.bones.chest) {
      this.bones.chest.rotation.x = Math.sin(this.idleTime * 0.35 + 0.5) * 0.4 * DEG;
    }

    // ── Arm gestures — periodic natural movements ──
    this._updateArmGestures(delta, elapsed);

    // ── Blink ──
    const now = performance.now();
    if (!this.blinking && now - this.lastBlink > 3500 + Math.random() * 2500) {
      this.blinking = true;
      this.blinkEnd = now + 150;
      this.lastBlink = now;
    }
    if (this.blinking) {
      const p = 1 - (this.blinkEnd - now) / 150;
      let w = p < 0.4 ? p / 0.4 : p < 0.6 ? 1.0 : 1 - (p - 0.6) / 0.4;
      try { this.vrm.expressionManager?.setValue('blink', Math.max(0, Math.min(1, w))); } catch (_) {}
      if (now >= this.blinkEnd) {
        this.blinking = false;
        try { this.vrm.expressionManager?.setValue('blink', 0); } catch (_) {}
      }
    }

    // ── Subtle happy expression ──
    try {
      this.vrm.expressionManager?.setValue('happy', 0.15 + Math.sin(this.idleTime * 0.3) * 0.05);
    } catch (_) {}

    // ── Core VRM update ──
    this.vrm.update(delta);
  }

  // ── Arm gesture system ────────────────────────────────────────────────
  _updateArmGestures(delta, elapsed) {
    this._armGestureTime += delta;

    // Start a new gesture periodically
    if (!this._gestureActive && this._armGestureTime > this._nextGestureAt) {
      this._gestureActive = true;
      this._gestureProgress = 0;
      this._gestureType = Math.floor(Math.random() * 4);
      this._gestureDuration = 1.5 + Math.random() * 1.5;
      this._armGestureTime = 0;
      this._nextGestureAt = 4 + Math.random() * 6;
    }

    // Smooth ease-in-out for gesture blend
    let blend = 0;
    if (this._gestureActive) {
      this._gestureProgress += delta / this._gestureDuration;
      if (this._gestureProgress >= 1) {
        this._gestureActive = false;
        this._gestureProgress = 0;
        blend = 0;
      } else {
        // Smooth bell curve: 0→1→0
        blend = Math.sin(this._gestureProgress * Math.PI);
        blend = blend * blend; // softer curve
      }
    }

    // Base natural idle pose (from VTubeJS) — arms slightly out, relaxed
    const basePose = {
      leftUpperArm:  { x: 0, y: 0, z: 55 },
      rightUpperArm: { x: 0, y: 0, z: -55 },
      leftLowerArm:  { x: 0, y: -35, z: 0 },
      rightLowerArm: { x: 0, y: 35, z: 0 },
      leftHand:      { x: 10, y: -5, z: 0 },
      rightHand:     { x: 10, y: 5, z: 0 },
    };

    // Gesture target poses
    const gestures = [
      { // 0: slight wave / greeting
        rightUpperArm: { x: -15, y: 0, z: -45 },
        rightLowerArm: { x: 0, y: 50, z: 0 },
        rightHand: { x: 0, y: 10, z: -15 },
      },
      { // 1: hands together / thinking
        leftUpperArm:  { x: -5, y: 10, z: 45 },
        rightUpperArm: { x: -5, y: -10, z: -45 },
        leftLowerArm:  { x: 0, y: -55, z: 0 },
        rightLowerArm: { x: 0, y: 55, z: 0 },
      },
      { // 2: left hand on hip, confident
        leftUpperArm:  { x: 5, y: 10, z: 40 },
        leftLowerArm:  { x: 0, y: -65, z: 0 },
        leftHand:      { x: 15, y: -10, z: 5 },
      },
      { // 3: both arms slight shift (weight shift)
        leftUpperArm:  { x: 2, y: 3, z: 52 },
        rightUpperArm: { x: -2, y: -3, z: -58 },
        leftLowerArm:  { x: 0, y: -30, z: 0 },
        rightLowerArm: { x: 0, y: 40, z: 0 },
      },
    ];

    // Gentle continuous arm float
    const armFloat = Math.sin(elapsed * 0.4) * 2;
    const armFloat2 = Math.cos(elapsed * 0.3) * 1.5;

    const gesture = this._gestureActive ? gestures[this._gestureType] : {};

    const applyBone = (boneName, base) => {
      const bone = this.bones[boneName];
      if (!bone) return;
      const g = gesture[boneName] || base;
      const tx = THREE.MathUtils.lerp(base.x, g.x, blend) + armFloat * 0.3;
      const ty = THREE.MathUtils.lerp(base.y, g.y, blend) + armFloat2 * 0.2;
      const tz = THREE.MathUtils.lerp(base.z, g.z, blend);
      // Smooth toward target
      bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, tx * DEG, 0.08);
      bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, ty * DEG, 0.08);
      bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, tz * DEG, 0.08);
    };

    for (const [name, base] of Object.entries(basePose)) {
      applyBone(name, base);
    }
  }

  // ── Speech control ────────────────────────────────────────────────────
  setSpeaking(speaking, envelope = 0.5) {
    this._speaking = speaking;
    this._speechEnvelope = speaking ? envelope : 0;
  }

  setExpression(key, value) {
    if (!this.vrm) return;
    const mgr = this.vrm.expressionManager;
    if (!mgr) return;
    const val = Math.max(0, Math.min(1, value));
    const presetMap = {
      aa: VRMExpressionPresetName.Aa,
      ee: VRMExpressionPresetName.Ee,
      ih: 'ih',
      oh: VRMExpressionPresetName.Oh,
      ou: VRMExpressionPresetName.Ou,
    };
    const preset = presetMap[key];
    if (preset) try { mgr.setValue(preset, val); } catch (_) {}
    try { mgr.setValue(key, val); } catch (_) {}
  }

  // ── Billboard ─────────────────────────────────────────────────────────
  lookAt(targetPos) {
    if (!this.vrmScene) return;
    const dir = new THREE.Vector3().subVectors(targetPos, this.vrmScene.position);
    dir.y = 0;
    if (dir.lengthSq() < 0.01) return;
    this.vrmScene.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
  }

  // ── Internals ─────────────────────────────────────────────────────────
  _cacheBones() {
    const h = this.vrm.humanoid;
    if (!h) return;
    const bone = (name) => {
      try { return h.getNormalizedBoneNode(name) || h.getRawBoneNode?.(name) || null; } catch (_) { return null; }
    };
    this.bones.head = bone('head');
    this.bones.neck = bone('neck');
    this.bones.spine = bone('spine');
    this.bones.chest = bone('chest');
    this.bones.leftUpperArm = bone('leftUpperArm');
    this.bones.rightUpperArm = bone('rightUpperArm');
    this.bones.leftLowerArm = bone('leftLowerArm');
    this.bones.rightLowerArm = bone('rightLowerArm');
    this.bones.leftHand = bone('leftHand');
    this.bones.rightHand = bone('rightHand');
    this.bones.leftShoulder = bone('leftShoulder');
    this.bones.rightShoulder = bone('rightShoulder');
  }

  _applyBasePose() {
    const set = (bone, x, y, z) => {
      if (bone) bone.rotation.set(x * DEG, y * DEG, z * DEG);
    };
    set(this.bones.leftUpperArm, 0, 0, 55);
    set(this.bones.rightUpperArm, 0, 0, -55);
    set(this.bones.leftLowerArm, 0, -35, 0);
    set(this.bones.rightLowerArm, 0, 35, 0);
    set(this.bones.leftHand, 10, -5, 0);
    set(this.bones.rightHand, 10, 5, 0);
  }

  dispose(scene) {
    if (this.vrmScene && scene) scene.remove(this.vrmScene);
    this.vrm = null;
    this.vrmScene = null;
    this.loaded = false;
  }
}
