import { build, createServer, type Plugin, type ViteDevServer } from 'vite';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { isBuildCurrent, RESTART_SENTINEL } from './devRestart';

const electronBin = require('electron') as string;

let electronProcess: ChildProcess | null = null;
let rendererUrl = '';
let started = false;
let restartRequested = false;
let restartDeadline = 0;

function launchElectron() {
  electronProcess?.kill();
  electronProcess = spawn(electronBin, ['out/main/entry.cjs'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ELECTRON_RENDERER_URL: rendererUrl },
  });
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

const notifyRestartNeeded = debounce(() => {
  if (restartRequested) return;
  console.log(
    '\n\x1b[33m⚠  src/main or src/preload changed — Electron is NOT restarted automatically.\x1b[0m',
  );
  console.log('   Press \x1b[1mEnter\x1b[0m (or type "rs") to restart Electron now.\n');
}, 300);

/** How long a sentinel request waits for the watch build before restarting anyway. */
const REBUILD_WAIT_MS = 15_000;

const restartWhenBuildSettles = debounce(() => {
  if (!restartRequested) return;
  const current = isBuildCurrent();
  if (!current && Date.now() < restartDeadline) {
    restartWhenBuildSettles();
    return;
  }
  restartRequested = false;
  if (!current) {
    console.log(
      '\n\x1b[33m⚠  restarting on bundles older than src — the watch build never landed.\x1b[0m',
    );
  }
  console.log('\x1b[36m↻ restarting Electron (restart sentinel)…\x1b[0m');
  launchElectron();
}, 300);

/** Restart once the on-disk bundles have caught up with src — see devRestart.ts. */
function requestRestart() {
  if (!started) return;
  if (!restartRequested) restartDeadline = Date.now() + REBUILD_WAIT_MS;
  restartRequested = true;
  restartWhenBuildSettles();
}

function watchRestartSentinel() {
  const sentinel = path.resolve(RESTART_SENTINEL);
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  // Polling watcher on purpose: fs.watch cannot watch a file that does not exist yet,
  // and its native single-file backend is unreliable on Windows.
  fs.watchFile(sentinel, { interval: 500 }, (curr, prev) => {
    if (curr.mtimeMs === 0 || curr.mtimeMs === prev.mtimeMs) return;
    requestRestart();
  });
}

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
      if (!started) return;
      // A landing bundle re-arms a pending request, so the restart waits for quiet.
      if (restartRequested) restartWhenBuildSettles();
      else notifyRestartNeeded();
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
      `  touch ${RESTART_SENTINEL} → restart (for agents/scripts)\n` +
      '\x1b[36m─────────────────────────────────────────────\x1b[0m\n',
  );
}

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
  const server: ViteDevServer = await createServer({ configFile: 'vite.renderer.config.mts' });
  await server.listen();
  server.printUrls();

  rendererUrl = server.resolvedUrls?.local[0] ?? 'http://localhost:5173';

  await startWatchBuild('vite.preload.config.mts');
  await startWatchBuild('vite.main.config.mts');

  launchElectron();
  started = true;
  watchRestartSentinel();
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
