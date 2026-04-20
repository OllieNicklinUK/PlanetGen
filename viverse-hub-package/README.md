# Viverse Hub — Standalone Package

This package contains everything you need to drop the Viverse 3D Hub (Lobby & Portals) into your existing Three.js / Vite project. 

It is completely self-contained, meaning the paths to the avatar model and physics controller have been fixed to load cleanly from this directory.

## What's Included:
- `hub.html`: The entry point (UI Overlay + Styles).
- `src/hub.js`: The main scene, BVH physics world, lighting, and portal layout.
- `src/hub-host-avatar.js`: Loads the Saneko VRM and handles idle/breathing/blinking animations.
- `public/models/Saneko_Modest_viverse2.vrm`: The avatar model.
- `src/core/`: EventBus and StateManager required by the avatar.
- `viverse-main/`: The custom physics and character controller library.

## Quick Start (Running This Folder Directly)

If you just want to run this folder by itself to see it working:
1. Open a terminal in this folder.
2. Run `npm install`
3. Run `npm run dev`
4. Open the localhost link in your browser.

## Integration Into Your Own Project

1. **Copy the Assets**: Copy the contents of `public/models/` into your project's `public/` directory so the VRM can load.
2. **Copy the Source**: Move `hub.js`, `hub-host-avatar.js`, and the `core/` folder into your `src/` directory.
3. **Copy the Physics Lib**: Move the `viverse-main` folder into the root of your project.
4. **Install Dependencies**: Ensure you have the required packages installed in your project:
   ```bash
   npm install three three-mesh-bvh @pixiv/three-vrm lil-gui
   npm install file:./viverse-main/packages/viverse
   ```
5. **Use the Entry Point**: Use `hub.html` as your entry point, or copy its `canvas` and UI `<divs>` into your own HTML file.

Happy building!
