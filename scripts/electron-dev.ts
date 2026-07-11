import { build, createServer, type Plugin, type ViteDevServer } from 'vite';
import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBin = require('electron') as string;

let electronProcess: ChildProcess | null = null;
let rendererUrl = '';
let started = false;

function launchElectron() {
  electronProcess?.kill();
  // Ignore the child's stdin so the parent owns it for the manual-restart prompt.
  electronProcess = spawn(electronBin, ['out/main/index.js'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ELECTRON_RENDERER_URL: rendererUrl },
  });
}

// Debounce coalesces the near-simultaneous preload + main rebuilds (e.g. from a
// shared-file edit) into a single prompt.
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

const notifyRestartNeeded = debounce(() => {
  console.log(
    '\n\x1b[33m⚠  src/main or src/preload changed — Electron is NOT restarted automatically.\x1b[0m',
  );
  console.log('   Press \x1b[1mEnter\x1b[0m (or type "rs") to restart Electron now.\n');
}, 300);

// Renderer edits hot-reload via the Vite dev server; only main/preload rebuilds
// reach this plugin. build.watch's promise resolves when the watcher is created,
// not when the first bundle is written, so the initial closeBundle is what tells
// us the entry file is on disk — main() awaits it (via onFirstWrite) before
// launching Electron. Every later closeBundle only prompts for a manual restart.
function watcherPlugin(onFirstWrite?: () => void): Plugin {
  let firstWriteDone = false;
  return {
    name: 'electron-manual-restart',
    closeBundle() {
      if (!firstWriteDone) {
        firstWriteDone = true;
        onFirstWrite?.();
        return;
      }
      if (started) notifyRestartNeeded();
    },
  };
}

function printHelp() {
  console.log(
    '\n\x1b[36m──── Yobi dev ───────────────────────────────\x1b[0m\n' +
      '  renderer edits          → hot-reload (automatic)\n' +
      '  src/main | src/preload  → manual restart\n' +
      '  \x1b[1mEnter\x1b[0m / \x1b[1mrs\x1b[0m  → restart Electron\n' +
      '  \x1b[1mq\x1b[0m         → quit\n' +
      '\x1b[36m─────────────────────────────────────────────\x1b[0m\n',
  );
}

// build.watch resolves as soon as the watcher exists — before the first bundle is
// written — so await watcherPlugin's initial closeBundle to guarantee the entry
// file is on disk before Electron launches. Otherwise Electron can spawn into a
// missing out/main/index.js (emptyOutDir clears it first, widening the window) and
// show its native "Unable to find Electron app" error.
function startWatchBuild(configFile: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    build({
      configFile,
      build: { watch: {} },
      plugins: [watcherPlugin(() => resolve())],
    }).catch(reject);
  });
}

async function main() {
  const server: ViteDevServer = await createServer({ configFile: 'vite.renderer.config.ts' });
  await server.listen();
  server.printUrls();

  rendererUrl = server.resolvedUrls?.local[0] ?? 'http://localhost:5173';

  // Wait for each initial bundle to be written to disk before booting Electron.
  await startWatchBuild('vite.preload.config.ts');
  await startWatchBuild('vite.main.config.ts');

  launchElectron();
  started = true;
  printHelp();

  const shutdown = () => {
    electronProcess?.kill();
    server.close();
    process.exit(0);
  };

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const cmd = line.trim().toLowerCase();
    if (cmd === '' || cmd === 'r' || cmd === 'rs') {
      console.log('\x1b[36m↻ restarting Electron…\x1b[0m');
      launchElectron();
    } else if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      shutdown();
    }
  });

  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
