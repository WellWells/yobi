import { defineConfig, type Plugin, type Rolldown } from 'vite';
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
  // Native FFI loader for the LINE send core; lazy-imported on win32 only.
  'koffi',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

/**
 * Bundler warnings about dependency code that is harmless in this bundle. Each is matched by its
 * code AND the package that raised it, so the same warning from our own code or any other package
 * still prints. The release self-test build uses the same filter.
 */
const KNOWN_DEPENDENCY_WARNINGS = [
  // unpdf calls `import.meta.resolve('pdfjs-dist/package.json')` inside a try, to default the cMap
  // and standard-font URLs. In this CJS bundle `import.meta` becomes `{}`, so the call throws and
  // is caught. Those URLs never existed here: pdfjs-dist is not installed (unpdf bundles its own
  // pdf.js) and the packaged app ships no node_modules.
  { code: 'EMPTY_IMPORT_META', pkg: 'unpdf' },
] as const;

export function onBuildLog(level: Rolldown.LogLevel, log: Rolldown.RolldownLog, defaultHandler: Rolldown.LogOrStringHandler): void {
  const id = log.id?.replace(/\\/g, '/') ?? '';
  const known = level === 'warn' && KNOWN_DEPENDENCY_WARNINGS.some((w) => w.code === log.code && id.includes(`/node_modules/${w.pkg}/`));
  if (!known) defaultHandler(level, log);
}

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
      onLog: onBuildLog,
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
      },
    },
  },
});
