import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

function hotReloadLanguageFiles(): Plugin {
  const langDir = resolve(import.meta.dirname, 'language');
  return {
    name: 'hot-reload-language-files',
    configureServer(server) {
      server.watcher.add(langDir);
      server.watcher.on('change', (file) => {
        const normalized = file.replace(/\\/g, '/');
        if (normalized.includes('/language/') && normalized.endsWith('.json')) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
  };
}

const KATEX_STYLESHEET = /\/node_modules\/katex\/dist\/katex(?:\.min)?\.css$/;
const NON_WOFF2_FONT_SOURCE = /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\)/g;

/**
 * KaTeX's stylesheet lists every font as woff2, woff and ttf, and Vite emits whatever it lists.
 * Chromium always takes the woff2, so the other two only add ~0.8 MB to the bundle.
 * Exported for the test suite.
 */
export function katexWoff2Only(): Plugin {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!KATEX_STYLESHEET.test(id.split('?')[0].replace(/\\/g, '/'))) return null;
      return code.replace(NON_WOFF2_FONT_SOURCE, '');
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  plugins: [react(), hotReloadLanguageFiles(), katexWoff2Only()],
  resolve: {
    alias: {
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'out/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'src/renderer/index.html'),
        capture: resolve(import.meta.dirname, 'src/renderer/capture.html'),
        prompt: resolve(import.meta.dirname, 'src/renderer/prompt.html'),
      },
      output: {
        manualChunks(id: string) {
          // KaTeX is reached only through the dynamic import in utils/katexBundle.
          // Naming a chunk here would hoist it back into the eagerly preloaded
          // vendor graph (rehype-katex otherwise matches the `rehype-` rule below),
          // which is exactly what keeping it off the first paint has to avoid —
          // let rollup leave both in the on-demand chunk.
          if (id.includes('node_modules/katex') || id.includes('node_modules/rehype-katex')) return;
          if (
            id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/remark-') ||
            id.includes('node_modules/rehype-') ||
            id.includes('node_modules/micromark') ||
            id.includes('node_modules/unified') ||
            id.includes('node_modules/mdast-') ||
            id.includes('node_modules/hast-') ||
            id.includes('node_modules/unist-') ||
            id.includes('node_modules/vfile') ||
            id.includes('node_modules/decode-named-character-reference') ||
            id.includes('node_modules/character-entities')
          ) return 'vendor-markdown';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/')
          ) return 'vendor-react';
          if (id.includes('node_modules/lucide-react')) return 'vendor-lucide';
          if (id.includes('node_modules/zustand')) return 'vendor-state';
        },
      },
    },
  },
});
