declare module '@pmndrs/viverse' {
  import { Object3D, Ray, Vector3, Box3 } from 'three';
  import type { ExtendedTriangle } from 'three-mesh-bvh';

  export class BvhPhysicsWorld {
    addBody(object: Object3D, kinematic: boolean): void;
    removeBody(object: Object3D): void;
    addSensor(
      object: Object3D,
      isStatic: boolean,
      onIntersectedChanged: (intersected: boolean) => void,
    ): void;
    removeSensor(object: Object3D): void;
    raycast(ray: Ray, far: number): { distance: number } | undefined;
    shapecast(
      intersectsBounds: (box: Box3) => boolean,
      intersectsTriangle: (tri: ExtendedTriangle) => void,
    ): void;
    updateSensors(
      playerCenter: Vector3,
      intersectsBounds: (box: Box3) => boolean,
      intersectsTriangle: (tri: ExtendedTriangle) => boolean,
    ): void;
  }

  export class BvhCharacterPhysics {
    readonly inputVelocity: Vector3;
    readonly isGrounded: boolean;
    applyVelocity(velocity: Vector3): void;
    update(model: Object3D, delta: number, options?: any): void;
  }

  export class CharacterCameraBehavior {
    rotationPitch: number;
    rotationYaw: number;
    zoomDistance: number;
    update(
      camera: Object3D,
      target: Object3D,
      delta: number,
      raycast?: (ray: Ray, far: number) => number | undefined,
      options?: any,
    ): void;
    dispose(): void;
  }

  export class SimpleCharacter extends Object3D {
    readonly physics: BvhCharacterPhysics;
    readonly cameraBehavior: CharacterCameraBehavior;
    constructor(
      camera: Object3D,
      world: BvhPhysicsWorld,
      domElement: HTMLElement,
      options?: { model?: boolean | object; [key: string]: any },
    );
    update(delta: number): void;
    dispose(): void;
  }
}
