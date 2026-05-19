import { createSystem, VisibilityState, Vector3 } from '@iwsdk/core';
import type { Signal } from '@preact/signals-core';

const DEG = Math.PI / 180;

export class EditorCameraSystem extends createSystem({}, {}) {
  private _theta   = 45 * DEG;   // horizontal orbit angle
  private _phi     = 40 * DEG;   // vertical orbit angle (from ground plane)
  private _dist    = 16;
  private _target  = new Vector3(0, 0.5, 0);

  private _drag = false;
  private _btn  = 0;
  private _lx   = 0;
  private _ly   = 0;

  private get _active(): boolean {
    const ba = this.globals.builderActive as Signal<boolean> | undefined;
    const bv = this.globals.builderView  as Signal<string>  | undefined;
    return (
      this.world.visibilityState.peek() === VisibilityState.NonImmersive &&
      ba?.peek() === true &&
      bv?.peek() === '3d'
    );
  }

  init() {
    const el = this.renderer.domElement;

    const onDown = (e: MouseEvent) => {
      if (!this._active) return;
      this._drag = true;
      this._btn  = e.button;
      this._lx   = e.clientX;
      this._ly   = e.clientY;
    };
    const onMove = (e: MouseEvent) => {
      if (!this._drag || !this._active) return;
      const dx = e.clientX - this._lx;
      const dy = e.clientY - this._ly;
      this._lx = e.clientX;
      this._ly = e.clientY;
      if (this._btn === 0) {
        this._theta -= dx * 0.006;
        this._phi    = Math.max(5 * DEG, Math.min(85 * DEG, this._phi + dy * 0.006));
      } else {
        // middle / right — pan in camera's XZ plane
        const sp  = this._dist * 0.0012;
        const rx  =  Math.cos(this._theta);
        const rz  = -Math.sin(this._theta);
        this._target.x += (-dx * rx + dy * rz) * sp;
        this._target.z += (-dx * rz - dy * rx) * sp;
      }
    };
    const onUp  = () => { this._drag = false; };
    const onWhl = (e: WheelEvent) => {
      if (!this._active) return;
      e.preventDefault();
      this._dist = Math.max(2, Math.min(60, this._dist * (1 + e.deltaY * 0.001)));
    };
    const onCtx = (e: Event) => { if (this._active) e.preventDefault(); };

    el.addEventListener('mousedown',    onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    el.addEventListener('wheel',        onWhl, { passive: false });
    el.addEventListener('contextmenu',  onCtx);

    this.cleanupFuncs.push(() => {
      el.removeEventListener('mousedown',   onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      el.removeEventListener('wheel',        onWhl);
      el.removeEventListener('contextmenu',  onCtx);
    });
  }

  update() {
    if (!this._active) return;
    const c = Math.cos, s = Math.sin;
    this.camera.position.set(
      this._target.x + this._dist * c(this._phi) * s(this._theta),
      this._target.y + this._dist * s(this._phi),
      this._target.z + this._dist * c(this._phi) * c(this._theta),
    );
    this.camera.lookAt(this._target);
  }

  /** Called by LevelBuilderSystem to re-centre the orbit target. */
  setTarget(x: number, y: number, z: number) {
    this._target.set(x, y, z);
  }
}
