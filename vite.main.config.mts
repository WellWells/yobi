import { defineConfig, type Plugin } from 'vite';
import { builtinModules, createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
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
  // Resolved from the build config so a build into a custom --outDir gets the stub next to its own bundle.
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

/**
 * cheerio's root entry also wires up loadBuffer/fromURL, which top-level-import undici; bundled,
 * that executed a whole HTTP client on every boot. Main only ever calls `load`, so bare `cheerio`
 * resolves straight to the module that defines it: the same parse5 parser, none of the rest.
 * Not `cheerio/slim` — that is htmlparser2, which repairs broken HTML differently.
 */
const CHEERIO_LOAD_ONLY = join(
  dirname(createRequire(import.meta.url).resolve('cheerio/package.json')),
  'dist/esm/load-parse.js',
);

const EXTERNALIZED = [
  'electron',
  // Native module (LINE wxSQLite3 driver): keep as a runtime require, never bundle its .node.
  'better-sqlite3-multiple-ciphers',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  plugins: [copyLanguageFilesPlugin(), copyEntryStubPlugin()],
  // mtcute's crypto is WebAssembly; `?inline` turns the .wasm into a data URL inside the bundle
  // (src/main/telegram/mtproto/wasm.ts), since the packaged app ships no node_modules to read.
  assetsInclude: ['**/*.wasm'],
  resolve: {
    conditions: ['node'],
    alias: [{ find: /^cheerio$/, replacement: CHEERIO_LOAD_ONLY }],
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
