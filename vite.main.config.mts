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

/**
 * The entry Electron boots is a hand-written stub, not part of this bundle: it turns Node's
 * compile cache on before requiring index.js, which is the only order in which the bundle can
 * be served from that cache (see src/main/entry.cjs). Copied verbatim, never transformed.
 */
function copyEntryStubPlugin(): Plugin {
  // Resolved from the build, not hardcoded: the release smoke test builds into a temp
  // --outDir, and an entry left behind in ./out would make it test the wrong bundle.
  let outDir = resolve(import.meta.dirname, 'out/main');
  return {
    name: 'copy-main-entry-stub',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      copyFileSync(resolve(import.meta.dirname, 'src/main/entry.cjs'), join(outDir, 'entry.cjs'));
    },
  };
}

const EXTERNALIZED = [
  'electron',
  // Native module (LINE wxSQLite3 driver): keep as a runtime require, never bundle its .node.
  'better-sqlite3-multiple-ciphers',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  plugins: [copyLanguageFilesPlugin(), copyEntryStubPlugin()],
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
