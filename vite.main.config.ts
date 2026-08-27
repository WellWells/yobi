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
      copyJsonFiles(resolve(__dirname, 'language'), resolve(__dirname, 'out/language'));
      copyJsonFiles(resolve(__dirname, 'language/community'), resolve(__dirname, 'out/language/community'));
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
      '@shared': resolve(__dirname, 'src/shared'),
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
    ssr: resolve(__dirname, 'src/main/index.ts'),
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
      },
    },
  },
});
