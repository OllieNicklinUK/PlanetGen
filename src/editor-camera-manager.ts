import { Vector3, PerspectiveCamera } from 'three';
import type { Signal } from '@preact/signals-core';

const DEG = Math.PI / 180;

export interface BuilderGlobals {
  builderActive: Signal<boolean>;
  builderView: Signal<string>;
}

export class EditorCameraManager {
  private _theta  = 45 * DEG;
  private _phi    = 40 * DEG;
  private _dist   = 16;
  private _target = new Vector3(0, 0.5, 0);

  private _drag = false;
  private _btn  = 0;
  private _lx   = 0;
  private _ly   = 0;

  private _cleanups: (() => void)[] = [];

  constructor(
    private _el: HTMLElement,
    private _camera: PerspectiveCamera,
    private _globals: BuilderGlobals,
  ) {}

  private get _active(): boolean {
    return (
      this._globals.builderActive.peek() === true &&
      this._globals.builderView.peek() === '3d'
    );
  }

  init() {
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
        const sp = this._dist * 0.0012;
        const rx =  Math.cos(this._theta);
        const rz = -Math.sin(this._theta);
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

    this._el.addEventListener('mousedown',    onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    this._el.addEventListener('wheel',        onWhl, { passive: false });
    this._el.addEventListener('contextmenu',  onCtx);

    this._cleanups.push(() => {
      this._el.removeEventListener('mousedown',   onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      this._el.removeEventListener('wheel',        onWhl);
      this._el.removeEventListener('contextmenu',  onCtx);
    });
  }

  update() {
    if (!this._active) return;
    const c = Math.cos, s = Math.sin;
    this._camera.position.set(
      this._target.x + this._dist * c(this._phi) * s(this._theta),
      this._target.y + this._dist * s(this._phi),
      this._target.z + this._dist * c(this._phi) * c(this._theta),
    );
    this._camera.lookAt(this._target);
  }

  setTarget(x: number, y: number, z: number) {
    this._target.set(x, y, z);
  }

  dispose() {
    for (const fn of this._cleanups) fn();
    this._cleanups = [];
  }
}
