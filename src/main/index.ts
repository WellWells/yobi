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
import { installPageRequestFilters } from './requestFilter';
import { refusePageReaderDownloads } from './downloadGuard';
import { setupIpcHandlers } from './ipc';
import { startModelCatalogRefresh } from './modelCatalogRefresh';
import { startDownloadsSweep } from './downloadsCache';
import { startTrashSweep } from './conversationTrash';
import { broadcastTrashChanged } from './ipc/conversationTrash';
import { fileBotConversationsOnce } from './conversationFolderMigration';
import { cleanupYtdlJobs, startYtdlUpdateSchedule, stopYtdlUpdateSchedule } from './youtubeDownload';
import { startPerplexityVisitorWipe } from './providers/perplexityVisitor';
import { refreshGeminiSignIn, setGeminiCookieReader } from './providers/geminiSignInState';
import { getAccountStatus } from './providers/authStatus';
import { startOutputFileWatch } from './outputWatcher';
import { classifyFailure, flushMetrics, recordTaskOutcome } from './metrics';
import { flushFlowMetrics } from './flowMetrics';
import { notifyQueueLevelFailure, processTask } from './taskProcessor';
import { bindHotkey as bindHotkeyImpl, bindQuickExportHotkey, bindRegionHotkey, bindRegionHotkeyAtLaunch } from './hotkeyBinding';
import { loadFlowsFromDisk } from './flow/flowPersistence';
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
import { createSocketBotRuntimes } from './bootstrap/socketBotSetup';
import { initMcp } from './bootstrap/mcpSetup';
import { initSecretHealthBridge, probeStoredSecrets, reportSecretHealth } from './bootstrap/secretHealthSetup';

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

/*
 * Fixed at 9333, away from Chrome's default 9222, so attaching to "the dev app" can never land on a
 * browser instead. YOBI_CDP_PORT is only for throwaway instances (screenshots, demos) that must run
 * next to `npm run dev`.
 */
const DEV_CDP_PORT = '9333';

if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['YOBI_CDP_PORT'] || DEV_CDP_PORT);
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

const socketBots = createSocketBotRuntimes({
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
  // A cookie-store read, not a page load: a send that comes first is sized signed out.
  setGeminiCookieReader(() => getAccountStatus('gemini'));
  void refreshGeminiSignIn();
  session.fromPartition('persist:url-parser').setUserAgent(CLEAN_UA);
  session.fromPartition('persist:browser-flow').setUserAgent(CLEAN_UA);
  session.fromPartition('persist:youtube').setUserAgent(userAgentForUrl('https://www.youtube.com/'));
  session.fromPartition('persist:gmaps').setUserAgent(userAgentForUrl('https://www.google.com/maps'));
  // The sign-ins' partitions and the signed-out readers' (bilibili has one of each), each once.
  // The sign-in sessions also send Chrome's whole Accept-Language, as their windows report it.
  const siteLanguages = systemAcceptLanguages();
  const sitePartitions = [...new Set([...SITE_PARTITIONS, ...READER_PARTITIONS])];
  for (const partition of sitePartitions) session.fromPartition(partition).setUserAgent(CLEAN_UA, siteLanguages);

  installPageRequestFilters((partition) => session.fromPartition(partition));

  // Client hints on every page-loading session, not just the worker. They hook onBeforeSendHeaders
  // and the request filter hooks onBeforeRequest, so neither displaces the other.
  registerWorkerClientHints(session.fromPartition('persist:gemini'));
  registerWorkerClientHints(session.fromPartition('persist:url-parser'));
  registerWorkerClientHints(session.fromPartition('persist:browser-flow'));
  registerWorkerClientHints(session.fromPartition('persist:youtube'));
  registerWorkerClientHints(session.fromPartition('persist:gmaps'));
  for (const partition of sitePartitions) registerWorkerClientHints(session.fromPartition(partition));

  refusePageReaderDownloads((partition) => session.fromPartition(partition), sendLog);

  initSecretHealthBridge();
  initSensitiveConfig();
  probeStoredSecrets();

  setupPlatformIcons();
  await loadInitialLanguages();
  setupWindows();

  // Drained only now: the config store is built at import time and the secret stores just
  // above, both before there is any window or language pack to report through.
  reportStoreRecoveries();

  flowManager = initFlowManager({ queue, telegramRuntime, lineRuntime, socketBots });
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
    socketBots,
    getMainWin,
    bindHotkey,
    bindQuickExportHotkey,
    bindRegionHotkey,
    checkForUpdates,
    flowManager: flowManager!,
    ...buildTrayIpcCallbacks(),
  });

  bindHotkey();
  bindQuickExportHotkey();
  void bindRegionHotkeyAtLaunch(loadFlowsFromDisk);
  void reportSecretHealth();
  void telegramRuntime.syncWithConfig();
  void lineRuntime.syncWithConfig();
  for (const runtime of Object.values(socketBots)) void runtime.syncWithConfig();
  startModelCatalogRefresh();
  startYtdlUpdateSchedule();
  // Records of downloads already cleaned up, or scratch left by a run the app closed on.
  void cleanupYtdlJobs().catch(() => {});
  // Downloads/Yobi keeps each download as long as Settings › Downloader says (three days unless changed).
  startDownloadsSweep();
  // Recently Deleted keeps a conversation for TRASH_RETENTION_DAYS, then deletes it for good.
  startTrashSweep(() => { void broadcastTrashChanged(); });
  // Bot conversations from before folders existed go into Telegram/ and LINE/, once.
  void fileBotConversationsOnce().catch((err: unknown) => {
    sendLog(`⚠️ Could not file the bot conversations into folders: ${err instanceof Error ? err.message : String(err)}`);
  });
  startPerplexityVisitorWipe();
  stopOutputFileWatch = startOutputFileWatch();
  sendLog(config.hotkey
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
  for (const runtime of Object.values(socketBots)) void runtime.shutdown();
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
