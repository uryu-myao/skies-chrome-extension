import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { BUILD_TARGETS, manifestFor, TARGET_ONLY_FILES, type BuildTarget } from './manifest.config';
import { version } from './package.json';

// Vite copies public/ into dist/ as is — Finder's .DS_Store files included,
// which would then ride along into the store package. Removes them (and
// AppleDouble "._" files) from the build output once it's written.
function dropMacMetadata(): Plugin {
  let outDir = '';
  return {
    name: 'skies:drop-mac-metadata',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const file of fs.readdirSync(outDir, { recursive: true, encoding: 'utf8' })) {
        const name = path.basename(file);
        if (name === '.DS_Store' || name.startsWith('._')) {
          fs.rmSync(path.join(outDir, file));
        }
      }
    },
  };
}

// Paths a manifest points at inside the package: the popup, the background
// script, every icon.
function referencedFiles(value: unknown): string[] {
  if (typeof value === 'string') return /\.(html|js|png|svg)$/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(referencedFiles);
  if (value && typeof value === 'object') return Object.values(value).flatMap(referencedFiles);
  return [];
}

// Writes the target's manifest.json (manifest.config.ts) and drops the other
// targets' files that public/ carries. Fails the build if the manifest points
// at a file the package doesn't have — the stores reject that package anyway.
function extensionManifest(target: BuildTarget): Plugin {
  let outDir = '';
  const manifest = manifestFor(target, version);
  return {
    name: 'skies:manifest',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
    closeBundle() {
      for (const other of BUILD_TARGETS.filter((t) => t !== target)) {
        for (const file of TARGET_ONLY_FILES[other]) {
          fs.rmSync(path.join(outDir, file), { force: true });
        }
      }
      const missing = referencedFiles(manifest).filter((file) => !fs.existsSync(path.join(outDir, file)));
      if (missing.length > 0) {
        this.error(`${target} manifest points at files missing from ${outDir}: ${missing.join(', ')}`);
      }
    },
  };
}

// `vite build --mode firefox` builds for Firefox; every other mode —
// including dev and vitest — is Chrome.
function targetOf(mode: string): BuildTarget {
  return mode === 'firefox' ? 'firefox' : 'chrome';
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const target = targetOf(mode);
  return {
    plugins: [react(), extensionManifest(target), dropMacMetadata()],
    envPrefix: 'VITE_',
    // Target-specific code branches on this compile-time constant, never on
    // the user agent at runtime, so each package only carries its own branch.
    define: {
      __TARGET__: JSON.stringify(target),
    },
    build: {
      outDir: `dist/${target}`,
      // The city library (src/data/cities.ts, ~700 kB) is a chunk of its own,
      // loaded only when the search opens — large on purpose.
      chunkSizeWarningLimit: 800,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@components': path.resolve(__dirname, 'src/components'),
        '@styles': path.resolve(__dirname, 'src/styles'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    // server: {
    //   proxy: {
    //     '/api': {
    //       target: 'https://api.timezonedb.com',
    //       changeOrigin: true,
    //       rewrite: (path) => path.replace(/^\/api/, ''),
    //     },
    //   },
    // },
  };
});
