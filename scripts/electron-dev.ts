import { build, createServer, type Plugin } from 'vite';
import { spawn, type ChildProcess } from 'node:child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBin = require('electron') as string;

let electronProcess: ChildProcess | null = null;
let rendererUrl = '';

let restartTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    electronProcess?.kill();
    electronProcess = spawn(electronBin, ['out/main/index.js'], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RENDERER_URL: rendererUrl },
    });
  }, 300);
}

function watcherPlugin(): Plugin {
  return {
    name: 'electron-restart',
    closeBundle() {
      scheduleRestart();
    },
  };
}

async function main() {
  const server = await createServer({ configFile: 'vite.renderer.config.ts' });
  await server.listen();
  server.printUrls();

  rendererUrl = server.resolvedUrls?.local[0] ?? 'http://localhost:5173';

  await build({
    configFile: 'vite.preload.config.ts',
    build: { watch: {} },
    plugins: [watcherPlugin()],
  });

  await build({
    configFile: 'vite.main.config.ts',
    build: { watch: {} },
    plugins: [watcherPlugin()],
  });

  process.on('SIGINT', () => {
    electronProcess?.kill();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
