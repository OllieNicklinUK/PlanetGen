import { SessionMode, World, LocomotionSystem, Vector3 } from '@iwsdk/core';
import { SnowWorldSystem, getSnowHeight } from './snow-world-system.js';

World.create(document.getElementById('scene-container'), {
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'always',
    features: { handTracking: { required: true } },
  },
  features: {
    locomotion: {
      useWorker: true,
      initialPlayerPosition: [0, 3.5, 0],
    },
    grabbing: false,
    physics: false,
  },
}).then((world) => {
  world.getSystem(LocomotionSystem).config.slidingSpeed.value = 50;
  world.registerSystem(SnowWorldSystem);

  const spawnY = getSnowHeight(0, 0) + 2;
  const spawnPos = new Vector3(0, spawnY, 0);
  world.player.position.set(0, spawnY, 0);
  world.getSystem(LocomotionSystem)?.['locomotor']?.teleport(spawnPos);
});
