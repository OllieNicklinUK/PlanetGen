import { StreamController } from '@polygon-streaming/web-player-threejs';
import {
  Scene, PerspectiveCamera, WebGLRenderer, Vector3, Group,
  Mesh, BufferGeometry, BufferAttribute, MeshBasicMaterial,
} from 'three';
import type { BvhPhysicsWorld } from '@pmndrs/viverse';

export const STREAMING_ENVS = [
  { url: 'https://stream.viverse.com/polygon_file/f1e6cdf6-0b8b-452c-9258-d0049ee15aae/3ddd1a3b-6984-4cb7-a503-8efea2c3ca61/', label: 'Lobby', scale: 1.0, posY: 1 },
];

export class PolygonStreamingManager {
  private _stream:   StreamController | null = null;
  private _target  = new Vector3();
  private _dir     = new Vector3();
  private _groups: Group[]     = [];
  private _colliders: Mesh[]   = [];

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

    // Inject collider support — the stream player calls addCollider with the exact
    // geometry it streams, giving a perfect match with the visual model.
    const internalRenderer = (this._stream as any).renderer;
    Object.defineProperty(internalRenderer, 'supportsColliders', {
      value: true, writable: true, configurable: true,
    });
    internalRenderer.addCollider = (_parentGroup: any, geometry: any) => {
      this._buildBvhCollider(geometry);
    };

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
  }

  private _buildBvhCollider(geometry: { positions: Float32Array; indices: Uint32Array | Uint16Array }) {
    const { positions, indices } = geometry;
    if (!positions?.length || !indices?.length) return;

    const bufGeo = new BufferGeometry();
    bufGeo.setAttribute('position', new BufferAttribute(positions, 3));
    bufGeo.setIndex(new BufferAttribute(indices, 1));

    const env  = STREAMING_ENVS[0];
    const mesh = new Mesh(bufGeo, new MeshBasicMaterial());
    mesh.visible = false;
    mesh.scale.setScalar(env.scale);
    mesh.position.y = env.posY;
    this._scene.add(mesh);
    mesh.updateWorldMatrix(true, true);
    this._physicsWorld.addBody(mesh, false);
    this._colliders.push(mesh);
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
