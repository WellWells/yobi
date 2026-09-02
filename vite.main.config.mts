import { defineConfig, type Plugin } from 'vite';
import { builtinModules } from 'node:module';
import { resolve, join } from 'node:path';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

function copyLanguageFilesPlugin(): Plugin {
  const copyJsonFiles = (src: string, dest: string): void => {
    mkdirSync(dest, { recursive: true });
    for (const file of readdirSync(src)) {
      if (file.endsWith('.json')) {
        copyFileSync(join(src, file), join(dest, file));
      }
    }
  };
  return {
    name: 'copy-language-files',
    closeBundle() {
      copyJsonFiles(resolve(import.meta.dirname, 'language'), resolve(import.meta.dirname, 'out/language'));
      copyJsonFiles(resolve(import.meta.dirname, 'language/community'), resolve(import.meta.dirname, 'out/language/community'));
    },
  };
}

const EXTERNALIZED = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  plugins: [copyLanguageFilesPlugin()],
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
    outDir: 'out/main',
    emptyOutDir: true,
    sourcemap: 'hidden',
    ssr: resolve(import.meta.dirname, 'src/main/index.ts'),
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
      },
    },
  },
});
