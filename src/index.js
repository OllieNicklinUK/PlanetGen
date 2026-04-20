import {
  SessionMode,
  World,
  Interactable,
  PanelUI,
  ScreenSpace,
} from '@iwsdk/core';

import { PanelSystem } from './panel.js';
import { WorldSystem } from './world-system.js';
import { VehicleSystem } from './vehicle-system.js';
import { createCreatureSpawnerUI } from './ui/creature-spawner.js';
import { LobbySystem, PortalDestination } from './lobby-system.js';

World.create(document.getElementById('scene-container'), {
  assets: {},
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'always',
    features: { handTracking: { required: true }, layers: true },
  },
  features: {
    locomotion: {
      useWorker: true,
      initialPlayerPosition: [0, 1.5, 0], // spawn in lobby; transitions to [0,100,0] on portal entry
    },
    grabbing: false,
    physics: false,
    sceneUnderstanding: false,
    environmentRaycast: false,
  },
}).then((world) => {
  world.registerComponent(PortalDestination);

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
  lobbySys.onEnterWorld = () => {
    world.registerSystem(WorldSystem).registerSystem(VehicleSystem);

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
