import { StreamController } from '@polygon-streaming/web-player-threejs';
import {
  Scene, PerspectiveCamera, WebGLRenderer, Vector3, Group,
  Mesh, Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BvhPhysicsWorld } from '@pmndrs/viverse';

export const STREAMING_ENVS = [
  { url: 'https://stream.viverse.com/polygon_file/f1e6cdf6-0b8b-452c-9258-d0049ee15aae/3ddd1a3b-6984-4cb7-a503-8efea2c3ca61/', label: 'Lobby', scale: 1.0, posY: 1 },
];

export class PolygonStreamingManager {
  private _stream:   StreamController | null = null;
  private _target  = new Vector3();
  private _dir     = new Vector3();
  private _groups: Group[]       = [];
  private _colliders: Object3D[] = [];

  constructor(
    private _scene:          Scene,
    private _physicsWorld:   BvhPhysicsWorld,
    private _camera:         PerspectiveCamera,
    private _renderer:       WebGLRenderer,
    private _getPlayerPos:   () => Vector3,
    private _getPlayerHead:  () => { getWorldPosition(t: Vector3): void },
  ) {}

  init() {
    this._stream = new StreamController(
      this._camera,
      this._renderer,
      this._scene,
      this._target,
      {
        cameraType:            'player',
        triangleBudget:        5_000_000,
        mobileTriangleBudget:  3_000_000,
        maximumQuality:        0,
        closeUpDistance:       4,
        closeUpDistanceFactor: 3,
      },
    );

    STREAMING_ENVS.forEach((env, i) => {
      const group = new Group();
      group.scale.setScalar(env.scale);
      group.position.y = env.posY;
      group.visible = i === 0;
      this._scene.add(group);
      this._groups.push(group);

      (this._stream as StreamController).addModel(env.url, group, {
        qualityPriority: 1,
        castShadows:     true,
        receiveShadows:  true,
      });
    });

    this._loadStaticCollider(`${import.meta.env.BASE_URL}gltf/nexus.gltf`, STREAMING_ENVS[0].posY, STREAMING_ENVS[0].scale);
  }

  private _loadStaticCollider(url: string, posY: number, scale: number) {
    new GLTFLoader().loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      root.position.y = posY;
      root.scale.setScalar(scale);

      // Add to scene so the world matrix chain is fully resolved.
      this._scene.add(root);

      // updateWorldMatrix(true,true) skips children whose matrixAutoUpdate=false
      // (Three.js GLTFLoader sets this on nodes exported with a pre-baked matrix).
      // updateMatrixWorld(force=true) always propagates through the full hierarchy.
      root.updateMatrixWorld(true);

      this._physicsWorld.addBody(root, false);

      // Hide after physics registration — StaticGeometryGenerator ignores visibility
      // so ordering doesn't matter, but keep it clear.
      root.traverse((child) => { if (child instanceof Mesh) child.visible = false; });

      this._colliders.push(root);
    });
  }

  update() {
    if (!this._stream) return;
    this._getPlayerHead().getWorldPosition(this._target);
    this._camera.getWorldDirection(this._dir);
    this._target.addScaledVector(this._dir, 6);
    this._stream.update();
  }

  dispose() {
    for (const g of this._groups)   this._scene.remove(g);
    for (const m of this._colliders) { this._physicsWorld.removeBody(m); this._scene.remove(m); }
    this._groups    = [];
    this._colliders = [];
    this._stream    = null;
  }
}
