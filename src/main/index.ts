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
import { reportStoreRecoveries } from './bootstrap/storeRecovery';
import { flushLogFileSync, initLogFile } from './logFile';
import {
  createMainWindow,
  getMainWin,
  setAppQuitting,
} from './windows';
import { CLEAN_UA, userAgentForUrl } from './userAgent';
import { registerWorkerClientHints } from './clientHints';
import { systemAcceptLanguages } from './chromeIdentity';
import { SITE_PARTITIONS } from './siteAccounts';
import { READER_PARTITIONS } from './sitePage';
import { handleTurnMediaScheme, registerTurnMediaScheme } from './turnMediaProtocol';
import { installRequestFilter } from './requestFilter';
import { setupIpcHandlers } from './ipc';
import { startModelCatalogRefresh } from './modelCatalogRefresh';
import { startDownloadsSweep } from './downloadsCache';
import { cleanupYtdlJobs, startYtdlUpdateSchedule, stopYtdlUpdateSchedule } from './youtubeDownload';
import { startPerplexityVisitorWipe } from './providers/perplexityVisitor';
import { startOutputFileWatch } from './outputWatcher';
import { classifyFailure, flushMetrics, recordTaskOutcome } from './metrics';
import { flushFlowMetrics } from './flowMetrics';
import { notifyQueueLevelFailure, processTask } from './taskProcessor';
import { bindHotkey as bindHotkeyImpl, bindQuickExportHotkey } from './hotkeyBinding';
import type { FlowManager } from './flow';
import { checkForUpdates } from './updater';
import { destroyTray, isTrayCreated } from './tray';
import { applyPendingFactoryReset } from './factoryReset';
import { setupPlatformIcons, loadInitialLanguages, setupWindows } from './bootstrap/appSetup';
import { setupTrayAndCloseBehavior, buildTrayIpcCallbacks } from './bootstrap/traySetup';
import { setupAppMenu } from './bootstrap/appMenuSetup';
import { initFlowManager, broadcastMergedQueueState } from './bootstrap/flowSetup';
import { createTelegramRuntime } from './bootstrap/telegramSetup';
import { handleDiscardedTask } from './taskReporting';
import { createLineRuntime } from './bootstrap/lineSetup';
import { initMcp } from './bootstrap/mcpSetup';
import { initSecretHealthBridge, probeStoredSecrets, reportSecretHealth } from './bootstrap/secretHealthSetup';

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['YOBI_CDP_PORT'] || '9222');
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

let powerSaveBlockerId: number | null = null;

let flowManager: FlowManager | null = null;
let stopOutputFileWatch: (() => void) | null = null;

const queue = new QueueManager(
  async (task: Task) => {
    await processTask(task, { telegramRuntime, lineRuntime });
  },
  (task, err) => {
    recordTaskOutcome('chat', classifyFailure(err instanceof Error ? err.message : String(err)), task);
    void notifyQueueLevelFailure(task, err, { telegramRuntime, lineRuntime });
  },
);

const bindHotkey = (): boolean => bindHotkeyImpl({ queue });

queue.onUpdate(() => {
  broadcastMergedQueueState(queue, flowManager);
});

queue.onDiscard(handleDiscardedTask);

const telegramRuntime = createTelegramRuntime({
  queue,
  getFlowManager: () => flowManager,
});

const lineRuntime = createLineRuntime({
  getFlowManager: () => flowManager,
});

// Has to be registered before the app is ready.
registerTurnMediaScheme();

app.whenReady().then(async () => {
  app.setAppUserModelId('com.wellstsai.yobi');
  handleTurnMediaScheme();
  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  initLogFile();
  sendLog(`🚀 Yobi ${app.getVersion()} starting (${process.platform}, electron ${process.versions.electron})`);

  await applyPendingFactoryReset();

  session.fromPartition('persist:gemini').setUserAgent(CLEAN_UA);
  session.fromPartition('persist:url-parser').setUserAgent(CLEAN_UA);
  session.fromPartition('persist:browser-flow').setUserAgent(CLEAN_UA);
  session.fromPartition('persist:youtube').setUserAgent(userAgentForUrl('https://www.youtube.com/'));
  session.fromPartition('persist:gmaps').setUserAgent(userAgentForUrl('https://www.google.com/maps'));
  // The sign-ins' partitions and the signed-out readers' (bilibili has one of each), each once.
  // The sign-in sessions also send Chrome's whole Accept-Language, as their windows report it.
  const siteLanguages = systemAcceptLanguages();
  const sitePartitions = [...new Set([...SITE_PARTITIONS, ...READER_PARTITIONS])];
  for (const partition of sitePartitions) session.fromPartition(partition).setUserAgent(CLEAN_UA, siteLanguages);

  // Page-fetching sessions only: the AI worker session keeps its provider pages untouched.
  installRequestFilter(session.fromPartition('persist:url-parser'));
  installRequestFilter(session.fromPartition('persist:browser-flow'));

  // Client hints on every page-loading session, not just the worker. They hook onBeforeSendHeaders
  // and installRequestFilter hooks onBeforeRequest, so neither displaces the other.
  registerWorkerClientHints(session.fromPartition('persist:gemini'));
  registerWorkerClientHints(session.fromPartition('persist:url-parser'));
  registerWorkerClientHints(session.fromPartition('persist:browser-flow'));
  registerWorkerClientHints(session.fromPartition('persist:youtube'));
  registerWorkerClientHints(session.fromPartition('persist:gmaps'));
  for (const partition of sitePartitions) registerWorkerClientHints(session.fromPartition(partition));

  initSecretHealthBridge();
  initSensitiveConfig();
  probeStoredSecrets();

  setupPlatformIcons();
  await loadInitialLanguages();
  setupWindows();

  // Drained only now: the config store is built at import time and the secret stores just
  // above, both before there is any window or language pack to report through.
  reportStoreRecoveries();

  flowManager = initFlowManager({ queue, telegramRuntime, lineRuntime });
  initMcp();

  // focus() orders a hidden macOS window front, which would undo a tray start.
  if (process.platform === 'darwin' && getMainWin()?.isVisible()) {
    getMainWin()?.focus();
  }

  setupTrayAndCloseBehavior();
  setupAppMenu();

  setupIpcHandlers({
    queue,
    telegramRuntime,
    lineRuntime,
    getMainWin,
    bindHotkey,
    bindQuickExportHotkey,
    checkForUpdates,
    flowManager: flowManager!,
    ...buildTrayIpcCallbacks(),
  });

  bindHotkey();
  bindQuickExportHotkey();
  void reportSecretHealth();
  void telegramRuntime.syncWithConfig();
  void lineRuntime.syncWithConfig();
  startModelCatalogRefresh();
  startYtdlUpdateSchedule();
  // Records of downloads already cleaned up, or scratch left by a run the app closed on.
  void cleanupYtdlJobs().catch(() => {});
  // Downloads/Yobi keeps each download as long as Settings › Downloader says (three days unless changed).
  startDownloadsSweep();
  startPerplexityVisitorWipe();
  stopOutputFileWatch = startOutputFileWatch();
  sendLog(config.hotkeyEnabled
    ? `✅ Ready — copy text and press ${config.hotkey}`
    : '✅ Ready — the ask hotkey is switched off');
});

app.on('before-quit', () => {
  sendLog('🔄 App closing — shutting down services...');
  setAppQuitting(true);
  flushMetrics();
  flushFlowMetrics();
  destroyTray();
  flowManager?.shutdown();
  stopYtdlUpdateSchedule();
  stopOutputFileWatch?.();
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
  flushLogFileSync();
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
  const mainWin = getMainWin();
  if (!mainWin || mainWin.isDestroyed()) {
    createMainWindow();
    setMainWindow(getMainWin());
  }
});
