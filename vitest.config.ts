import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        // No DOM: core reaches storage only through an injected store (spec §12),
        // so no test can lean on a browser global by accident.
        environment: 'node',
        include: ['test/**/*.test.ts'],
      },
    })
  )
);
