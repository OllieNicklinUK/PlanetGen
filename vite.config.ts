import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { createReadStream, existsSync } from 'fs';
import { join, resolve } from 'path';

function serveLocalDir(urlPrefix: string, dirPath: string) {
  return {
    name: `serve-${urlPrefix}`,
    configureServer(server: any) {
      server.middlewares.use(`/${urlPrefix}`, (req: any, res: any, next: () => void) => {
        const file = join(dirPath, decodeURIComponent(req.url).split('?')[0].replace(/^\//, ''));
        if (existsSync(file)) {
          const ext = file.split('.').pop()?.toLowerCase() ?? '';
          const mime: Record<string, string> = { glb: 'model/gltf-binary', gltf: 'model/gltf+json' };
          if (mime[ext]) {
            res.setHeader('Content-Type', mime[ext]);
            createReadStream(file).pipe(res);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    serveLocalDir('creature-models', resolve('creature models')),
    mkcert(),
  ],
  resolve: {
    alias: {
      '@pmndrs/viverse': resolve('./viverse-main/packages/viverse/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: true,
    proxy: {
      // The polygon-streaming player fetches its own shared assets (loading spinner
      // animation etc.) from /assets/*.  Proxy that path to the Viverse CDN so the
      // dev server doesn't serve index.html for those requests.
      '/assets': {
        target: 'https://stream.viverse.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path: string) => `/public${path}`,
      },
    },
  },
  build: {
    outDir: 'docs',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: '/PlanetGen/',
});
