import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type ViteDevServer } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

function watchBrandLogoForIconRegeneration() {
  return {
    name: 'dw-brand-icon-regeneration',
    configureServer(server: ViteDevServer) {
      const appRoot = import.meta.dirname;
      const brandDirectory = path.resolve(appRoot, 'public', 'brand');
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      let generationRunning = false;
      let generationQueued = false;

      const runGeneration = () => {
        if (generationRunning) {
          generationQueued = true;
          return;
        }
        generationRunning = true;
        execFile('bash', [path.resolve(appRoot, 'scripts', 'generate-brand-icons.sh')], { cwd: appRoot }, (error, _stdout, stderr) => {
          generationRunning = false;
          if (error) {
            server.config.logger.error(`[brand-icons] Regeneration failed: ${stderr || error.message}`);
          } else {
            server.config.logger.info('[brand-icons] Regenerated static icons from the updated logo.');
            server.ws.send({ type: 'full-reload' });
          }
          if (generationQueued) {
            generationQueued = false;
            runGeneration();
          }
        });
      };

      const watcher = watch(brandDirectory, (_eventType, filename) => {
        if (filename?.toString() !== 'deux-wild-logo.png') return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runGeneration, 300);
      });

      server.httpServer?.once('close', () => {
        watcher.close();
        if (debounceTimer) clearTimeout(debounceTimer);
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  // FFmpeg's worker URL import is not compatible with Vite's dep optimizer.
  // Keep it as a native module so on-device Gift Studio processing can load.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg'],
  },
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    watchBrandLogoForIconRegeneration(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
