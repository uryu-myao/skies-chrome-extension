import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropMacMetadata()],
  envPrefix: 'VITE_',
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
});
