import { StreamController } from '@polygon-streaming/web-player-threejs';
import {
  createSystem, Types, Group, Vector3,
  Mesh, BufferGeometry, BufferAttribute, MeshBasicMaterial, LocomotionEnvironment,
  AssetManager,
} from '@iwsdk/core';

export const STREAMING_ENVS = [
  { url: 'https://stream.viverse.com/polygon_file/f1e6cdf6-0b8b-452c-9258-d0049ee15aae/3ddd1a3b-6984-4cb7-a503-8efea2c3ca61/', label: 'Lobby', scale: 1.0, posY: 0 },
];

// System config schema — configure via world.getSystem(PolygonStreamingSystem).config
const SCHEMA = {
  // Index into STREAMING_ENVS, or -1 to use customUrl
  envIndex:       { type: Types.Int32,   default: 0 },
  // Override URL (used when envIndex === -1)
  customUrl:      { type: Types.String,  default: '' },
  customScale:    { type: Types.Float32, default: 1.0 },
  customPosY:     { type: Types.Float32, default: 0.0 },
  triangleBudget: { type: Types.Float32, default: 5_000_000 },
};

export class PolygonStreamingSystem extends createSystem({}, SCHEMA) {
  /** @type {StreamController | null} */
  _stream = null;
  /** @type {Vector3} */
  _target = null;
  /** @type {Vector3} */
  _dir    = null;
  /** @type {THREE.Group[]} */
  _groups = [];
  _colliderEntities = [];

  init() {
    this._target = new Vector3();
    this._dir    = new Vector3();

    this._stream = new StreamController(
      this.camera,
      this.renderer,
      this.scene,
      this._target,
      {
        cameraType:           'player',
        triangleBudget:       this.config.triangleBudget.peek(),
        mobileTriangleBudget: 3_000_000,
        // Don't stop improving geometry beyond a quality threshold — useful for
        // static environments where the player can walk close to surfaces.
        maximumQuality:       0,
        closeUpDistance:      4,
        closeUpDistanceFactor: 3,
      },
    );

    // If the XRG embeds a collider.xrgc (info.json has a top-level "collider" key),
    // the streaming system decompresses it and calls renderer.addCollider().
    // H0 (Three.js renderer) has no addCollider or supportsColliders by default, so
    // we inject both to activate that path. Models without a collider key fall through
    // to the onModelLoaded visual-mesh fallback below.
    const internalRenderer = this._stream.renderer;
    // supportsColliders is a read-only getter on H0's prototype — shadow it.
    Object.defineProperty(internalRenderer, 'supportsColliders', {
      value: true, writable: true, configurable: true,
    });
    internalRenderer.addCollider = (parentGroup, geometry) => {
      this._buildLocomotionCollider(geometry);
    };

    // Build collision from the dedicated nexus.gltf model. The asset is loaded
    // upfront in the AssetManifest so it's available synchronously here.
    const gltf = AssetManager.getGLTF('nexusCollider');
    if (gltf?.scene) {
      gltf.scene.visible = false;
      const entity = this.world.createTransformEntity(gltf.scene, {
        parent: this.world.sceneEntity,
        persistent: true,
      });
      entity.addComponent(LocomotionEnvironment);
      this._colliderEntities.push(entity);
    }

    const activeIdx = this.config.envIndex.peek();

    STREAMING_ENVS.forEach((env, i) => {
      const group = new Group();
      group.scale.setScalar(env.scale);
      group.position.y = env.posY;
      group.visible = i === activeIdx;
      this.scene.add(group);
      this._groups.push(group);

      this._stream.addModel(env.url, group, {
        qualityPriority: 1,
        castShadows:     true,
        receiveShadows:  true,
      });
    });

    // Listen for config changes to switch environments at runtime.
    this.cleanupFuncs.push(
      this.config.envIndex.subscribe((idx) => this._showEnv(idx)),
    );
  }

  /**
   * Primary path: build BVH from the XRG's embedded collider.xrgc geometry.
   * geometry = { positions: Float32Array, indices: Uint32Array|Uint16Array }
   */
  _buildLocomotionCollider(geometry) {
    const { positions, indices } = geometry;
    if (!positions?.length || !indices?.length) return;

    const bufGeo = new BufferGeometry();
    bufGeo.setAttribute('position', new BufferAttribute(positions, 3));
    bufGeo.setIndex(new BufferAttribute(indices, 1));

    const env = STREAMING_ENVS[this.config.envIndex.peek()] ?? STREAMING_ENVS[0];
    const mesh = new Mesh(bufGeo, new MeshBasicMaterial());
    mesh.visible = false;
    mesh.scale.setScalar(env.scale);
    mesh.position.y = env.posY;

    const entity = this.world.createTransformEntity(mesh, {
      parent: this.world.sceneEntity,
      persistent: true,
    });
    entity.addComponent(LocomotionEnvironment);
    this._colliderEntities.push(entity);
  }

  /** Switch the visible streaming environment (0-based index into STREAMING_ENVS). */
  _showEnv(idx) {
    this._groups.forEach((g, i) => { g.visible = i === idx; });
  }

  update() {
    if (!this._stream) return;

    // Point the LOD target 6 m in front of the player — streaming prioritises
    // geometry in the direction the player is looking, not what's behind them.
    this.player.head.getWorldPosition(this._target);
    this.camera.getWorldDirection(this._dir);
    this._target.addScaledVector(this._dir, 6);

    this._stream.update();
  }

  destroy() {
    super.destroy();
    for (const g of this._groups) this.scene.remove(g);
    for (const e of this._colliderEntities) e.dispose();
    this._groups = [];
    this._colliderEntities = [];
    this._stream = null;
  }
}
