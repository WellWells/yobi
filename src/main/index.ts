// src/main/index.ts — Electron main process entry point
//
// This file orchestrates app lifecycle, queue setup, and module wiring.
// Business logic lives in dedicated modules under src/main/.

// Suppress url.parse() deprecation (DEP0169) emitted by third-party packages
{
  const _ew = process.emitWarning.bind(process);
  process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
    const opts = args[0];
    if (opts && typeof opts === 'object' && (opts as Record<string, unknown>).code === 'DEP0169') return;
    (_ew as (w: string | Error, ...a: unknown[]) => void)(warning, ...args);
  };
}

import { app, session, powerSaveBlocker, nativeImage } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  runAutomation,
  getProviderLabel,
  preparePromptForProvider,
  isLoginRequiredError,
  getProviderLoginUrl,
} from './providers';
import { saveOutput } from './output';
import { registerHotkey, unregisterAll } from './hotkey';
import { config, saveConfig, initSensitiveConfig } from './config';
import { QueueManager } from './queueManager';
import { TelegramRuntime, normalizePairingState } from './telegram';
import { IPC } from '../shared/types';
import type { Task, QueueState } from '../shared/types';

// Module imports
import {
  sendLog,
  sendToRenderer,
  sendWebNotification,
  setMainWindow,
  setNotifyEnabled,
  applyLaunchAtStartup,
  createTaskId,
  clearPerplexitySiteDataIfNeeded,
  getAssetPath,
} from './helpers';
import { captureSelectedText, backupClipboard, restoreClipboard, checkMacosAccessibility, promptMacosAccessibility } from './clipboard';
import { listOutputFiles, getOutputDir, buildSafeFileNameFromTitle, buildSnapshotFileName, getUniquePath } from './files';
import { isSingleUrl, fetchAndParse, buildUrlAnalysisPrompt, resolveUrlPrompt } from './urlParser';
import {
  loadLanguageData,
  getLangCache,
  setLangCache,
  setEnCache,
  buildTaskInstruction,
  buildCombinedPromptFromPrefs,
  localizeUserFacingError,
  stripSystemInstruction,
  t,
} from './i18n';
import {
  createMainWindow,
  createWorkerWindow,
  getMainWin,
  getWorkerWin,
  setAppQuitting,
  setMainWindowCloseHandler,
  showLoginWindowIfNeeded,
  closeAllWindows,
  isAllWindowsClosed,
  CLEAN_UA,
} from './windows';
import { captureMarkdownDocument, buildCaptureSummary } from './capture';
import {
  isTelegramAdminUser,
  buildTelegramStatusText,
  getTelegramRuntimeSnapshot,
  setTelegramRuntimeSnapshot,
  exportTelegramResultDocument,
} from './telegramBridge';
import { setupIpcHandlers } from './ipcHandlers';
import { FlowManager } from './flowManager';
import { checkForUpdates, initializeUpdater } from './updater';
import {
  createTray,
  destroyTray,
  isTrayCreated,
  updateTrayMenu,
} from './tray';

// ── Chromium flags — must be called before app.on('ready') ──────────────────
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Prevent multiple app instances on Windows/Linux (optional, but recommended)
// Prevent multiple app instances on Windows/Linux (optional, but recommended)
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

// Track powerSaveBlocker ID for cleanup
let powerSaveBlockerId: number | null = null;

// ── AgentFlow (Flow Automation) ──────────────────────────────────────────────
let flowManager: FlowManager | null = null;

// ── Queue Manager ─────────────────────────────────────────────────────────────
const queue = new QueueManager(async (task: Task) => {
  await processTask(task);
});

queue.onUpdate((state) => {
  const flowItems = flowManager?.getPendingQueueItems() ?? [];
  if (flowItems.length === 0) {
    sendToRenderer(IPC.QUEUE_UPDATE, state);
    sendToRenderer(IPC.STATUS, state.status);
    return;
  }
  const allItems = [...state.items, ...flowItems];
  const anyRunning = allItems.some((i) => i.status === 'running');
  const merged: QueueState = {
    total: allItems.length,
    current: anyRunning ? 1 : 0,
    status: anyRunning ? 'processing' : 'idle',
    items: allItems,
  };
  sendToRenderer(IPC.QUEUE_UPDATE, merged);
  sendToRenderer(IPC.STATUS, merged.status);
});

// ── Telegram Runtime ──────────────────────────────────────────────────────────
  const telegramRuntime = new TelegramRuntime({
  getEnabled: () => config.telegram.enabled,
  getToken: () => config.telegram.botToken,
  getAllowGroupCommands: () => config.telegram.allowGroupCommands,
  getDefaultReplyMode: () => config.telegram.defaultReplyMode,
  getPairing: () => config.telegram.pairing,
  savePairing: (next) => {
    config.telegram.pairing = normalizePairingState(next);
    saveConfig({ telegram: config.telegram });
    // Notify renderer to refresh Telegram pairing/admin snapshot immediately.
    sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
  },
  isAdminUser: (userId) => isTelegramAdminUser(userId),
  onTaskRequest: async (request) => {
    const id = createTaskId();
    queue.enqueue({
      id,
      prompt: request.prompt,
      targetUrl: request.targetUrl,
      source: 'telegram',
      replyTarget: request.replyTarget,
    });
    sendLog(`[${id}] Telegram /${request.command} queued`);
    return { taskId: id };
  },
  onStatusRequest: () => buildTelegramStatusText(queue),
  onUpdateDefaultReplyMode: (mode) => {
    if (mode !== 'markdown' && mode !== 'png' && mode !== 'webp' && mode !== 'pdf') return false;
    config.telegram.defaultReplyMode = mode;
    saveConfig({ telegram: config.telegram });
    return true;
  },
  onExportRequest: (request) => exportTelegramResultDocument(request),
  onLog: (message) => sendLog(message),
  onRuntime: (snapshot) => {
    setTelegramRuntimeSnapshot(snapshot);
    sendToRenderer(IPC.TELEGRAM_RUNTIME, snapshot);
  },
  getStrings: () => getLangCache(),
  getFlowCommands: () => flowManager?.getBotCommands() ?? [],
    onFlowCommand: async (flowId, inputVariable, input, userId, chatId) => {
      const extraContext: Record<string, string> = {
        [inputVariable]: input,
        'bot.triggerChatId': String(chatId),
        'bot.triggerUserId': String(userId),
      };
      if (!flowManager) {
        return {
          taskId: createTaskId(),
          result: Promise.resolve({
            flowId,
            success: false,
            outputs: {},
            error: 'FlowManager not available',
            completedSteps: 0,
            totalSteps: 0,
            completedAt: new Date().toISOString(),
          }),
        };
      }
      const execution = flowManager.queueExecutionWithId(flowId, extraContext, 'bot');
      sendLog(`[AgentFlow] Bot command triggered flow ${flowId} for user ${userId} with input: ${input}`);
      return execution;
    },
  });

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.on('ready', () => {
  const workerSession = session.fromPartition('persist:gemini');
  workerSession.setUserAgent(CLEAN_UA);
  app.userAgentFallback = CLEAN_UA;

  workerSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    headers['User-Agent'] = CLEAN_UA;
    for (const key of [
      'sec-ch-ua', 'Sec-CH-UA',
      'sec-ch-ua-mobile', 'Sec-CH-UA-Mobile',
      'sec-ch-ua-platform', 'Sec-CH-UA-Platform',
      'sec-ch-ua-platform-version', 'sec-ch-ua-full-version-list',
    ]) {
      delete headers[key];
    }
    callback({ requestHeaders: headers });
  });
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.wellstsai.dac');
  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  // Decrypt sensitive config fields (requires app.ready for safeStorage)
  initSensitiveConfig();

  // ── Platform icon setup ─────────────────────────────────────────────────────
  if (process.platform === 'darwin') {
    // macOS Dock icon — must be set after app is ready.
    const dockIcon = nativeImage.createFromPath(getAssetPath('icon-mac.png'));
    app.dock?.setIcon(dockIcon);
    // macOS native About panel (Help → About… or Cmd+I).
    app.setAboutPanelOptions({
      applicationName: 'Desktop Agent Center',
      iconPath: getAssetPath('icon-mac.png'),
    });
  }

  const initialLang = await loadLanguageData(config.locale);
  if (initialLang) setLangCache(initialLang);
  // Always cache en-US as fallback for keys missing from the active locale.
  const enLang = await loadLanguageData('en-US');
  if (enLang) setEnCache(enLang);

  createMainWindow();
  setMainWindow(getMainWin());
  setNotifyEnabled(config.notifyOnComplete);
  initializeUpdater({ sendLog, sendToRenderer });

  createWorkerWindow(config.targetUrl);

  // ── AgentFlow (Flow Automation) ────────────────────────────────────────
  flowManager = new FlowManager({
    getWorkerWin,
    getTargetUrl: () => config.targetUrl,
    getResponseTimeoutMs: () => config.responseTimeout,
    sendTelegramMessage: async (chatId, text) => {
      await telegramRuntime.sendProactive(chatId, text);
    },
    sendTelegramFile: async (chatId, filePath, sendAs, caption) => {
      await telegramRuntime.sendProactiveFile(chatId, filePath, sendAs, caption);
    },
    captureMarkdown: async (payload, format, background, options) => {
      const resultDoc = await captureMarkdownDocument({
        payload,
        options: {
          mode: 'save',
          format,
          fileName: options?.fileName ?? '',
          showPrompt: options?.showPrompt ?? false,
          showContent: options?.showContent ?? true,
          showProvider: options?.showProvider ?? false,
          showTimestamp: options?.showTimestamp ?? false,
          width: 1_200,
          background,
        },
      });
      const outputDir = await getOutputDir();
      const requestedFileName = (options?.fileName ?? '').trim();
      const fileStem = requestedFileName ? buildSafeFileNameFromTitle(requestedFileName) : buildSnapshotFileName();
      const filePath = await getUniquePath(
        path.join(outputDir, `${fileStem}.${resultDoc.ext}`),
        '',
      );
      await fs.writeFile(filePath, resultDoc.buffer);
      return filePath;
    },
    getPairedUsers: () => config.telegram.pairing.pairedUsers,
    onSaveHistory: async ({ prompt, response, providerLabel }) => {
      const outputDir = await getOutputDir();
      const langData = await loadLanguageData(config.locale);
      const providerHeaderLabel = langData?.['md.provider'] ?? 'Provider';
      const promptLabel = langData?.['md.prompt'] ?? 'Prompt';
      const responseLabel = langData?.['md.response'] ?? 'Response';
      const timestampLabel = langData?.['md.timestamp'] ?? 'Time';
      const fallbackTitle = prompt.trim().replace(/\s+/g, ' ').slice(0, 70);
      await saveOutput({
        prompt,
        response,
        outputDir,
        title: fallbackTitle || 'AgentFlow',
        provider: providerLabel,
        promptLabel,
        responseLabel,
        timestampLabel,
        providerLabel: providerHeaderLabel,
      });
      const files = await listOutputFiles();
      sendToRenderer(IPC.FILE_LIST, files);
    },
  });

  // Wire the FlowManager queue into the TitleBar queue display
  flowManager.setQueueChangeCallback(() => {
    const promptState = queue.getState();
    const flowItems = flowManager!.getPendingQueueItems();
    const allItems = [...promptState.items, ...flowItems];
    const anyRunning = allItems.some((i) => i.status === 'running');
    const merged: QueueState = {
      total: allItems.length,
      current: anyRunning ? 1 : 0,
      status: anyRunning ? 'processing' : 'idle',
      items: allItems,
    };
    sendToRenderer(IPC.QUEUE_UPDATE, merged);
    sendToRenderer(IPC.STATUS, merged.status);
  });

  // Re-sync Telegram bot commands whenever a bot-trigger flow is saved or deleted
  flowManager.setOnBotCommandsChanged(() => {
    void telegramRuntime.refreshBotCommands();
  });

  void flowManager.init().then(() => {
    // After flows are loaded, restart bot if there are active bot-trigger commands to register
    if ((flowManager?.getBotCommands().length ?? 0) > 0) {
      void telegramRuntime.refreshBotCommands();
    }
  });

  if (process.platform === 'darwin') {
    getMainWin()?.focus();
  }

  // ── Tray setup ───────────────────────────────────────────────────────────
  function getTrayDeps() {
    return {
      getMainWin,
      getNotifyEnabled: () => config.notifyOnComplete,
      setNotifyEnabled: (v: boolean) => {
        config.notifyOnComplete = v;
        saveConfig({ notifyOnComplete: v });
        setNotifyEnabled(v); sendToRenderer(IPC.NOTIFY_ON_COMPLETE_CHANGED, v);
      },
      getLaunchAtStartup: () => config.launchAtStartup,
      setLaunchAtStartup: (v: boolean) => {
        config.launchAtStartup = v;
        saveConfig({ launchAtStartup: v });
        applyLaunchAtStartup(v, config.closeToTray);
        sendToRenderer(IPC.LAUNCH_AT_STARTUP_CHANGED, v);
      },
      onQuit: () => {
        setAppQuitting(true);
        app.quit();
      },
      onNavigateSettings: () => {
        sendToRenderer(IPC.NAVIGATE_SETTINGS);
      },
    };
  }

  if (config.autoShowTray || config.closeToTray) {
    createTray(getTrayDeps());
  }

  // Sync auto-launch state (with hidden mode) with OS on startup
  applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);

  // If launched with --hidden flag and closeToTray is on → start hidden in tray
  const isStartupHidden = process.argv.includes('--hidden');
  if (isStartupHidden && config.closeToTray) {
    const win = getMainWin();
    win?.hide();
    if (!isTrayCreated()) createTray(getTrayDeps());
  }

  // ── Main window close handler (first-time dialog + tray hide) ───────────
  setMainWindowCloseHandler((event) => {
    // If tray is active and user chose to hide to tray: just hide
    if (config.closeToTray) {
      event.preventDefault();
      if (!isTrayCreated()) {
        createTray(getTrayDeps());
      }
      const win = getMainWin();
      win?.hide();
      return;
    }

    // First-time: show choice via renderer UI dialog (only on non-macOS)
    if (!config.closeActionDecided && process.platform !== 'darwin') {
      event.preventDefault();
      sendToRenderer(IPC.SHOW_CLOSE_DIALOG);
      return;
    }

    // Default: macOS keeps alive; others quit
    if (process.platform !== 'darwin') {
      event.preventDefault();
      setAppQuitting(true);
      app.quit();
    }
  });

  setupIpcHandlers({
    queue,
    telegramRuntime,
    telegramSessionId: TELEGRAM_SESSION_ID,
    getMainWin,
    bindHotkey,
    checkForUpdates,
    flowManager: flowManager!,
    onTraySettingsChanged: () => {
      // Create or destroy tray based on updated settings
      if (config.autoShowTray || config.closeToTray) {
        if (!isTrayCreated()) createTray(getTrayDeps());
        else updateTrayMenu(getTrayDeps());
      } else if (!config.closeToTray && !config.autoShowTray) {
        destroyTray();
      }
    },
    onTrayMenuRebuild: () => {
      if (isTrayCreated()) updateTrayMenu(getTrayDeps());
    },
    onHideToTray: () => {
      if (!isTrayCreated()) createTray(getTrayDeps());
      const win = getMainWin();
      win?.hide();
    },
    onQuitApp: () => {
      setAppQuitting(true);
      app.quit();
    },
  });

  bindHotkey();
  void telegramRuntime.syncWithConfig();
  sendLog(`✅ Ready — copy text and press ${config.hotkey}`);
});

app.on('before-quit', () => {
  sendLog('🔄 App closing — shutting down services...');
  setAppQuitting(true);
  destroyTray();
  flowManager?.shutdown();
  void telegramRuntime.shutdown();
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
  // If tray is active, the app stays alive (window hidden to tray).
  // Otherwise, follow platform conventions: macOS keeps alive; others quit.
  if (isTrayCreated()) return;
  if (process.platform !== 'darwin') {
    void app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create a window when the dock icon is clicked
  // and there are no other windows open.
  if (isAllWindowsClosed()) {
    createMainWindow();
    setMainWindow(getMainWin());
  }
});

// ── Hotkey binding ────────────────────────────────────────────────────────────
let _accessibilityPrompted = false;

function bindHotkey(): void {
  const ok = registerHotkey(config.hotkey, async () => {
    // macOS: Accessibility permission is required for keystroke simulation via osascript.
    // Without it, the simulated Cmd+C silently fails, leaving the clipboard empty.
    if (process.platform === 'darwin' && !checkMacosAccessibility()) {
      const langData = getLangCache();
      const errorMsg = langData['hotkey.error.accessibility'] ??
        'Accessibility permission required. Go to System Preferences → Privacy & Security → Accessibility and enable this app.';
      sendLog(`❌ ${errorMsg}`);
      sendWebNotification('Desktop Agent Center', errorMsg, 'warning');
      if (!_accessibilityPrompted) {
        _accessibilityPrompted = true;
        promptMacosAccessibility();
      }
      return;
    }

    const rawText = await captureSelectedText();
    if (!rawText) {
      sendLog('⚠️  Clipboard is empty — nothing to send');
      return;
    }

    const langData = getLangCache();
    const prompt = await resolveUrlPrompt(rawText, {
      langData,
      onLog: sendLog,
      onNotify: (title, body) => sendWebNotification(title, body, 'info'),
    });

    const id = createTaskId();
    queue.enqueue({
      id,
      prompt,
      targetUrl: config.targetUrl,
      source: 'hotkey',
    });
    sendLog(`[${id}] 🔥 Queued for ${getProviderLabel(config.targetUrl)} (queue size: ${queue.size + 1})`);

    const notifyTitle = langData['notify.queued.title'] ?? 'Desktop Agent Center';
    const notifyBodyTemplate = langData['notify.queued.body'] ?? 'Queued: "{{prompt}}"';
    const compactPrompt = prompt.replace(/\s+/g, ' ').trim().slice(0, 36);
    const displayPrompt = compactPrompt.length < prompt.replace(/\s+/g, ' ').trim().length
      ? `${compactPrompt}…`
      : compactPrompt;
    sendWebNotification(notifyTitle, notifyBodyTemplate.replace('{{prompt}}', displayPrompt), 'info');
  });

  if (ok) {
    sendLog(`⌨️  Hotkey registered: ${config.hotkey}`);
  } else {
    sendLog(`❌ Failed to register hotkey ${config.hotkey}`);
  }
}

// ── Task processor ────────────────────────────────────────────────────────────
async function processTask(task: Task): Promise<void> {
  const { id, prompt } = task;
  const promptForOutput = stripSystemInstruction(prompt);
  const targetUrl = task.targetUrl ?? config.targetUrl;
  const preview = prompt.length > 100 ? `${prompt.slice(0, 100)}…` : prompt;
  const providerLabel = getProviderLabel(targetUrl);

  sendLog(`[${id}] 📤 "${preview}"`);

  // Backup clipboard before provider automation (copy-button clicks write to system clipboard)
  const clipboardSnapshot = backupClipboard();

  try {
    const workerWin = getWorkerWin();
    if (!workerWin || workerWin.isDestroyed()) {
      sendLog(`[${id}] 🔄 Relaunching worker window...`);
      createWorkerWindow(config.targetUrl);
      await new Promise((r) => setTimeout(r, 3_000));
    }

    const activeWorker = getWorkerWin();
    if (!activeWorker || activeWorker.isDestroyed()) {
      throw new Error('Worker window unavailable after relaunch attempt');
    }

    const t0 = Date.now();
    sendLog(`[${id}] ⏳ Sending to ${providerLabel}...`);

    const dynamicInstruction = buildCombinedPromptFromPrefs(config.promptPreferences, getLangCache());
    const instruction = buildTaskInstruction(dynamicInstruction, config.syncSystemLanguageToModel, config.locale);
    const fullPrompt = instruction ? `${instruction}\n\n${prompt}` : prompt;
    const preparedPrompt = preparePromptForProvider(fullPrompt, targetUrl);
    if (preparedPrompt.removedBlankLines) {
      sendLog(`[${id}] ✂️ Removed blank lines before sending to ${providerLabel}`);
    }
    if (preparedPrompt.truncated) {
      sendLog(`[${id}] ✂️ Prompt truncated to ${preparedPrompt.maxChars} chars for ${providerLabel}`);
    }

    const { response, title } = await runAutomation(
      activeWorker,
      preparedPrompt.prompt,
      config.responseTimeout,
      targetUrl,
    );

    const elapsed = ((Date.now() - t0) / 1_000).toFixed(1);
    sendLog(`[${id}] ✅ Response received in ${elapsed}s`);

    const outputDir = await getOutputDir();
    const langData = await loadLanguageData(config.locale);
    const providerHeaderLabel = langData?.['md.provider'] ?? 'Provider';
    const promptLabel = langData?.['md.prompt'] ?? 'Prompt';
    const responseLabel = langData?.['md.response'] ?? 'Response';
    const timestampLabel = langData?.['md.timestamp'] ?? 'Time';

    const geminiTitle = stripSystemInstruction(title?.trim() ?? '').replace(/\s+/g, ' ').trim();
    const fallbackTitle = promptForOutput.trim().replace(/\s+/g, ' ').slice(0, 70);
    const finalTitle = geminiTitle || fallbackTitle || 'Untitled';

    const filePath = await saveOutput({
      prompt: promptForOutput,
      response,
      outputDir,
      title: finalTitle,
      provider: providerLabel,
      providerLabel: providerHeaderLabel,
      promptLabel,
      responseLabel,
      timestampLabel,
    });
    const savedFileName = path.basename(filePath);
    sendLog(`[${id}] 💾 Saved: ${savedFileName}`);

    sendToRenderer(IPC.FILE_LIST, await listOutputFiles());

    const notifyTitle = langData?.['notify.completed.title'] ?? 'Desktop Agent Center';
    const notifyBodyTemplate = langData?.['notify.completed.body'] ?? '"{{prompt}}" saved as {{file}}';
    const compactPrompt = promptForOutput.replace(/\s+/g, ' ').trim().slice(0, 36);
    const displayPrompt = compactPrompt.length < promptForOutput.replace(/\s+/g, ' ').trim().length
      ? `${compactPrompt}…`
      : compactPrompt;
    sendWebNotification(
      notifyTitle,
      notifyBodyTemplate.replace('{{prompt}}', displayPrompt).replace('{{file}}', savedFileName),
    );

    if (task.replyTarget) {
      await telegramRuntime.sendTaskSuccess(task.replyTarget, {
        providerLabel,
        savedFileName,
        response,
        prompt: promptForOutput,
        title: finalTitle,
        elapsedSeconds: elapsed,
      });
    }
  } catch (err: unknown) {
    const strings = getLangCache();
    if (isLoginRequiredError(targetUrl, err)) {
      const loginUrl = getProviderLoginUrl(targetUrl);
      if (loginUrl) await showLoginWindowIfNeeded(providerLabel, loginUrl, config.targetUrl);
      sendLog(`[${id}] ⚠️ Login required before sending prompt`);
      if (task.replyTarget) {
        await telegramRuntime.sendTaskError(task.replyTarget, {
          providerLabel,
          message: t(strings, 'telegram.error.loginRequired'),
        });
      }
      return;
    }
    const rawMessage = (err as Error).message;
    sendLog(`[${id}] ❌ ${rawMessage}`);
    if (task.replyTarget) {
      await telegramRuntime.sendTaskError(task.replyTarget, {
        providerLabel,
        message: localizeUserFacingError(rawMessage, strings),
      });
    }
  } finally {
    // Restore clipboard to its original state before provider automation
    restoreClipboard(clipboardSnapshot);
    await clearPerplexitySiteDataIfNeeded(targetUrl);
  }
}
