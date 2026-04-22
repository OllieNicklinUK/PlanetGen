import {
  SessionMode,
  World,
  Interactable,
  PanelUI,
  ScreenSpace,
  LocomotionSystem,
  Vector3,
  AssetType,
} from '@iwsdk/core';
import { signal } from '@preact/signals-core';

import { PanelSystem } from './panel.js';
import { WorldSystem } from './world-system.js';
import { VehicleSystem } from './vehicle-system.js';
import { SnowWorldSystem, getSnowHeight } from './snow-world-system.js';
import { createCreatureSpawnerUI } from './ui/creature-spawner.js';
import { LobbySystem, PortalDestination, LOBBY_Y } from './lobby-system.js';
import { PolygonStreamingSystem } from './polygon-streaming-system.js';
import { LevelBuilderSystem } from './level-builder-system.js';
import { EditorCameraSystem } from './editor-camera-system.js';
import { PlacedObject } from './components/placed-object.js';

const _urlMode = new URLSearchParams(window.location.search).get('mode');

World.create(document.getElementById('scene-container'), {
  assets: {
    nexusCollider: { url: '/gltf/nexus.gltf', type: AssetType.GLTF },
  },
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'always',
    features: { handTracking: { required: true }, layers: true },
  },
  features: {
    locomotion: {
      useWorker: true,
      initialPlayerPosition: [0, LOBBY_Y + 1.5, 0],
    },
    grabbing: false,
    physics: false,
    sceneUnderstanding: false,
    environmentRaycast: false,
  },
}).then((world) => {
  world.getSystem(LocomotionSystem).config.slidingSpeed.value = 50;

  // ── Level Builder mode (?mode=builder) ───────────────────────────────────────
  if (_urlMode === 'builder') {
    world.globals.builderActive = signal(false);
    world.globals.builderView   = signal('plan');
    world.registerComponent(PlacedObject);
    world.registerSystem(EditorCameraSystem);
    world.registerSystem(LevelBuilderSystem);
    world.getSystem(LevelBuilderSystem).activate();
    return; // skip lobby entirely
  }

  // ── Normal lobby mode ────────────────────────────────────────────────────────
  world.registerComponent(PortalDestination);

  // Polygon-streamed city environment — loads LOD geometry from Viverse CDN.
  // Switch environment at runtime: world.getSystem(PolygonStreamingSystem).config.envIndex.value = 1
  world.registerSystem(PolygonStreamingSystem);

  // Welcome / XR entry panel (2D overlay while in browser, VR panel in headset)
  const panelEntity = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: './ui/welcome.json',
      maxHeight: 0.8,
      maxWidth: 1.6,
    })
    .addComponent(Interactable)
    .addComponent(ScreenSpace, {
      top: '20px',
      left: '20px',
      height: '40%',
    });
  panelEntity.object3D.position.set(0, 1.5, -2);

  // LobbySystem builds the hub environment. WorldSystem + VehicleSystem are
  // deferred — registered only when the player steps through the world portal.
  world.registerSystem(PanelSystem).registerSystem(LobbySystem);

  const lobbySys = world.getSystem(LobbySystem);
  // Helper — ensures PolygonStreamingSystem is live, but not when Snow World is active.
  const ensureStreaming = () => {
    if (world.getSystem(SnowWorldSystem)) return;
    if (!world.getSystem(PolygonStreamingSystem)) world.registerSystem(PolygonStreamingSystem);
  };

  lobbySys.onReturnToLobby = () => {
    world.getSystem(SnowWorldSystem)?.resetPhysics();
    ensureStreaming();
  };

  lobbySys.onEnterSnow = () => {
    // Tear down any active world before entering a new one.
    world.unregisterSystem(WorldSystem);
    world.unregisterSystem(VehicleSystem);
    // Destroy the lobby streaming environment — too heavy for snow world.
    world.unregisterSystem(PolygonStreamingSystem);
    world.registerSystem(SnowWorldSystem); // init() → rebuildNoise, builds initial chunks

    // Spawn at the centre of the flat safe zone — origin is always the summit.
    const spawnY   = getSnowHeight(0, 0) + 2;
    const spawnPos = new Vector3(0, spawnY, 0);

    world.player.position.set(0, spawnY, 0);
    world.getSystem(LocomotionSystem)?.['locomotor']?.teleport(spawnPos);
  };
  lobbySys.onEnterWorld = () => {
    // Tear down any active world before entering a new one.
    world.unregisterSystem(SnowWorldSystem);
    ensureStreaming(); // restore lobby environment if snow destroyed it
    world.registerSystem(WorldSystem).registerSystem(VehicleSystem);

    // Spawn at lobby height so the Nexus City model appears at the same scale
    // and position as it does in the lobby (player is inside the environment,
    // not floating 10 m above it).
    const spawnPos = new Vector3(0, LOBBY_Y + 1.5, 0);
    world.player.position.set(0, LOBBY_Y + 1.5, 0);
    world.getSystem(LocomotionSystem)?.['locomotor']?.teleport(spawnPos);

    // Mount the creature spawner panel only when creatures are enabled.
    const worldSys = world.getSystem(WorldSystem);
    if (worldSys._creatureManager) {
      createCreatureSpawnerUI(
        worldSys._creatureManager,
        () => worldSys.getPlayerPos(),
      );
    }
  };
});
