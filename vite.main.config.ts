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
      // Community packs ship one level down: NOT selectable as UI languages
      // (the language list and loader read the top level only), but their
      // md.* values still feed the markdown heading-alias scan, so output
      // files saved under a since-removed built-in locale keep parsing.
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
        /*
         * Chunks sit beside the entry, NOT under an assets/ subfolder. The main process
         * resolves sibling bundles off `__dirname` (windows.ts: '../preload/index.js'), so a
         * chunk one level deeper silently retargets those paths — the preload then fails to
         * load and the whole renderer comes up blank with no build error anywhere. Which code
         * Rollup decides to hoist into a chunk changes whenever a dynamic import is added, so
         * this must not depend on the entry keeping everything.
         */
        chunkFileNames: '[name]-[hash].js',
      },
    },
  },
});
