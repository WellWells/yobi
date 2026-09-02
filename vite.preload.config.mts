import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

const EXTERNALIZED = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  resolve: {
    conditions: ['node'],
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
  ssr: {
    external: EXTERNALIZED,
    noExternal: true,
  },
  build: {
    outDir: 'out/preload',
    emptyOutDir: true,
    sourcemap: true,
    ssr: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'src/preload/index.ts'),
        worker: resolve(import.meta.dirname, 'src/preload/worker.ts'),
        browserPage: resolve(import.meta.dirname, 'src/preload/browserPage.ts'),
      },
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
      },
    },
  },
});
