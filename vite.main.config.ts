import { defineConfig, type Plugin } from 'vite';
import { builtinModules } from 'node:module';
import { resolve, join } from 'node:path';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

function copyLanguageFilesPlugin(): Plugin {
  return {
    name: 'copy-language-files',
    closeBundle() {
      const src = resolve(__dirname, 'language');
      const dest = resolve(__dirname, 'out/language');
      mkdirSync(dest, { recursive: true });
      for (const file of readdirSync(src)) {
        if (file.endsWith('.json')) {
          copyFileSync(join(src, file), join(dest, file));
        }
      }
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
      },
    },
  },
});
