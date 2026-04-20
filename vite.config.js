
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { compileUIKit } from '@iwsdk/vite-plugin-uikitml';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { createReadStream, existsSync } from 'fs';
import { join, resolve } from 'path';

// Serve a local directory at a URL prefix (dev only)
function serveLocalDir(urlPrefix, dirPath) {
  return {
    name: `serve-${urlPrefix}`,
    configureServer(server) {
      server.middlewares.use(`/${urlPrefix}`, (req, res, next) => {
        const file = join(dirPath, decodeURIComponent(req.url).split('?')[0].replace(/^\//, ''));
        if (existsSync(file)) {
          const ext = file.split('.').pop().toLowerCase();
          const mime = { glb: 'model/gltf-binary', gltf: 'model/gltf+json' }[ext];
          if (mime) { res.setHeader('Content-Type', mime); createReadStream(file).pipe(res); return; }
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
    iwsdkDev({
      emulator: {
        device: 'metaQuest3'
        
      },
      ai: { tools: ['claude']  },
      verbose: true
    }),
    
    compileUIKit({ sourceDir: 'ui', outputDir: 'public/ui', verbose: true }),
  ],
  server: { host: '0.0.0.0', port: 8081, open: true },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' }
  },
  esbuild: { target: 'esnext' },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    esbuildOptions: { target: 'esnext' }
  },
  publicDir: 'public',
  base: './'
});
