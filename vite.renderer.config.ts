import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

function hotReloadLanguageFiles(): Plugin {
  const langDir = resolve(__dirname, 'language');
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

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), hotReloadLanguageFiles()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        capture: resolve(__dirname, 'src/renderer/capture.html'),
      },
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/katex')) return 'vendor-katex';
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
