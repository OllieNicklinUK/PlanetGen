import { defineConfig } from 'vite';
import { resolve } from 'path';

// Viverse build: base is '/' so all asset paths are root-relative.
// The polygon-streaming service worker and basis_transcoder work without
// the /PlanetGen/ prefix used for GitHub Pages.
export default defineConfig({
  resolve: {
    // Same deduplication fix as vite.config.ts — see comment there.
    dedupe: ['three', 'three-mesh-bvh'],
    alias: {
      '@pmndrs/viverse': resolve('./viverse-main/packages/viverse/src/index.ts'),
    },
  },
  build: {
    outDir: 'viverse-dist',
    sourcemap: false,
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: '/',
});
