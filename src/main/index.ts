{
  const _ew = process.emitWarning.bind(process);
  process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
    const opts = args[0];
    if (opts && typeof opts === 'object' && (opts as Record<string, unknown>).code === 'DEP0169') return;
    (_ew as (w: string | Error, ...a: unknown[]) => void)(warning, ...args);
  };
}

process.on('unhandledRejection', (reason: unknown) => {
  if (
    reason instanceof Error &&
    (reason.name === 'AbortError' || reason.message === 'The operation was aborted.')
  ) {
    console.warn('[process] unhandledRejection suppressed (AbortError):', reason.message);
    return;
  }
  console.error('[process] unhandledRejection:', reason);
});

process.on('uncaughtException', (err: Error) => {
  console.error('[process] uncaughtException:', err);
});

import { app, powerSaveBlocker, session } from 'electron';
import { unregisterAll } from './hotkey';
import { config, initSensitiveConfig } from './config';
import { QueueManager } from './queueManager';
import type { Task } from '../shared/types';
import { sendLog, setMainWindow } from './helpers';
import {
  createMainWindow,
  getMainWin,
  setAppQuitting,
} from './windows';
import { CLEAN_UA } from './userAgent';
import { registerWorkerClientHints } from './clientHints';
import { setupIpcHandlers } from './ipc';
import { classifyFailure, recordTaskOutcome } from './metrics';
import { notifyQueueLevelFailure, processTask } from './taskProcessor';
import { bindHotkey as bindHotkeyImpl } from './hotkeyBinding';
import type { FlowManager } from './flow';
import { checkForUpdates } from './updater';
import { destroyTray, isTrayCreated } from './tray';
import { applyPendingFactoryReset } from './factoryReset';
import { setupPlatformIcons, loadInitialLanguages, setupWindows } from './bootstrap/appSetup';
import { setupTrayAndCloseBehavior, buildTrayIpcCallbacks } from './bootstrap/traySetup';
import { initFlowManager, broadcastMergedQueueState } from './bootstrap/flowSetup';
import { createTelegramRuntime } from './bootstrap/telegramSetup';
import { createLineRuntime } from './bootstrap/lineSetup';

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}
app.userAgentFallback = CLEAN_UA;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!app.isReady()) return;

    let mainWin = getMainWin();

    if (!mainWin || mainWin.isDestroyed()) {
      createMainWindow();
      setMainWindow(getMainWin());
      mainWin = getMainWin();
    }

    if (!mainWin) return;
    if (mainWin.isMinimized()) mainWin.restore();
    if (!mainWin.isVisible()) mainWin.show();
    mainWin.focus();
  });
}

const TELEGRAM_SESSION_ID = `${app.getName().toLowerCase()}-desktop`;

let powerSaveBlockerId: number | null = null;

let flowManager: FlowManager | null = null;

const queue = new QueueManager(
  async (task: Task) => {
    await processTask(task, { telegramRuntime, lineRuntime });
  },
  (task, err) => {
    // Queue-level rejection (hard timeout) never reaches processTask's own error
    // handling. Record it, then tell whoever is waiting — notifyQueueLevelFailure
    // stays silent if processTask already answered them.
    recordTaskOutcome('chat', classifyFailure(err instanceof Error ? err.message : String(err)), task);
    void notifyQueueLevelFailure(task, err, { telegramRuntime, lineRuntime });
  },
);

const bindHotkey = (): void => bindHotkeyImpl({ queue });

queue.onUpdate(() => {
  broadcastMergedQueueState(queue, flowManager);
});

const telegramRuntime = createTelegramRuntime({
  queue,
  getFlowManager: () => flowManager,
});

const lineRuntime = createLineRuntime({
  queue,
  getFlowManager: () => flowManager,
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.wellstsai.yobi');
  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  // Apply a scheduled factory reset (from RESET_SETTINGS) here — before any
  // window, the task queue, the flow manager or the Telegram bot exist — so the
  // wipe runs in a pristine process with no in-flight work to resurrect deleted
  // files or re-persist provider cookies. Must precede initSensitiveConfig() and
  // setupWindows() below.
  await applyPendingFactoryReset();

  session.fromPartition('persist:gemini').setUserAgent(CLEAN_UA);
  session.fromPartition('persist:url-parser').setUserAgent(CLEAN_UA);
  session.fromPartition('persist:browser-flow').setUserAgent(CLEAN_UA);

  registerWorkerClientHints(session.fromPartition('persist:gemini'));

  initSensitiveConfig();

  setupPlatformIcons();
  await loadInitialLanguages();
  setupWindows();

  flowManager = initFlowManager({ queue, telegramRuntime, lineRuntime });

  if (process.platform === 'darwin') {
    getMainWin()?.focus();
  }

  setupTrayAndCloseBehavior();

  setupIpcHandlers({
    queue,
    telegramRuntime,
    lineRuntime,
    telegramSessionId: TELEGRAM_SESSION_ID,
    getMainWin,
    bindHotkey,
    checkForUpdates,
    flowManager: flowManager!,
    ...buildTrayIpcCallbacks(),
  });

  bindHotkey();
  void telegramRuntime.syncWithConfig();
  void lineRuntime.syncWithConfig();
  sendLog(`✅ Ready — copy text and press ${config.hotkey}`);
});

app.on('before-quit', () => {
  sendLog('🔄 App closing — shutting down services...');
  setAppQuitting(true);
  destroyTray();
  flowManager?.shutdown();
  void telegramRuntime.shutdown();
  void lineRuntime.shutdown();
});

app.on('quit', () => {
  sendLog('🛑 App quitting — cleaning up resources...');
  unregisterAll();
  if (powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
  sendLog('✅ Cleanup complete — app exit');
});

app.on('will-quit', () => {
  unregisterAll();
});

app.on('window-all-closed', () => {
  if (isTrayCreated()) return;
  if (process.platform !== 'darwin') {
    void app.quit();
  }
});

app.on('activate', () => {
  // Recreate the UI whenever the main window is gone — check ONLY the main
  // window, never the hidden provider worker. The worker lives for the whole app
  // lifetime (its close is intercepted into a hide), so gating on "all windows
  // closed" would leave macOS users unable to reopen the app from the Dock after
  // red-button-closing the main window.
  const mainWin = getMainWin();
  if (!mainWin || mainWin.isDestroyed()) {
    createMainWindow();
    setMainWindow(getMainWin());
  }
});
