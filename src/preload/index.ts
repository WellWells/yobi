// src/preload/index.ts — Context bridge (typed)
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';
import type {
  CaptureSettings,
  DuckaiModelInfo,
  FlowDefinition,
  FlowExecutionEvent,
  FlowExecutionLog,
  FlowExecutionResult,
  MarkdownCaptureRequest,
  MarkdownCaptureResult,
  OutputFile,
  PromptPreferences,
  PromptTriggerOptions,
  QueueState,
  SettingsSnapshot,
  TelegramRuntimeSnapshot,
  TelegramSettingsSnapshot,
  UpdateAvailablePayload,
  UiNotificationPayload,
} from '../shared/types';

export type ElectronAPI = {
  // Window controls
  showWorker: () => void;
  hideWorker: () => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;

  // Logging / status push from main
  onLog: (cb: (msg: string) => void) => () => void;
  onStatus: (cb: (status: string) => void) => () => void;
  onQueueUpdate: (cb: (state: QueueState) => void) => () => void;
  onFileListUpdate: (cb: (files: OutputFile[]) => void) => () => void;
  onUiNotification: (cb: (payload: UiNotificationPayload) => void) => () => void;
  onTelegramRuntime: (cb: (snapshot: TelegramRuntimeSnapshot) => void) => () => void;

  // File operations
  getFileList: () => Promise<OutputFile[]>;
  searchFileList: (query: string) => Promise<OutputFile[]>;
  getFileContent: (filePath: string) => Promise<string | null>;
  deleteFile: (filePath: string) => Promise<boolean>;
  deleteAllFiles: () => Promise<number>;
  updateFileTitle: (filePath: string, title: string) => Promise<{ ok: boolean; updatedPath: string }>;
  updateFileH1: (filePath: string, title: string) => Promise<boolean>;

  // Hotkey
  getHotkey: () => Promise<string>;
  updateHotkey: (hotkey: string) => Promise<boolean>;
  setHotkeyPaused: (paused: boolean) => Promise<boolean>;
  getAiUrl: () => Promise<string>;
  updateAiUrl: (url: string) => Promise<boolean>;

  // Language / i18n
  getLanguageList: () => Promise<string[]>;
  getLanguageContent: (lang: string) => Promise<Record<string, unknown> | null>;
  getCurrentLocale: () => Promise<{ locale: string; setByUser: boolean }>;
  setLocaleAuto: (lang: string) => Promise<boolean>;

  // License
  getLicense: () => Promise<string>;
  checkForUpdates: () => Promise<boolean>;
  onUpdateAvailable: (cb: (payload: UpdateAvailablePayload) => void) => () => void;
  onUpdateNotAvailable: (cb: () => void) => () => void;
  onUpdateError: (cb: () => void) => () => void;
  openExternal: (url: string) => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  getAppIconDataUrl: () => Promise<string>;

  // Custom Prompt
  getCustomPrompt: () => Promise<string>;
  updateCustomPrompt: (text: string) => Promise<boolean>;
  getSyncSystemLanguageToModel: () => Promise<boolean>;
  updateSyncSystemLanguageToModel: (enabled: boolean) => Promise<boolean>;
  getNotifyOnComplete: () => Promise<boolean>;
  updateNotifyOnComplete: (enabled: boolean) => Promise<boolean>;
  getPromptPreferences: () => Promise<PromptPreferences>;
  updatePromptPreferences: (prefs: PromptPreferences, builtPrompt: string) => Promise<boolean>;
  getResponseTimeout: () => Promise<number>;
  updateResponseTimeout: (ms: number) => Promise<boolean>;
  resetSettings: () => Promise<SettingsSnapshot | null>;

  // Trigger prompt from UI
  triggerPrompt: (prompt: string) => void;
  triggerPromptWithOptions: (options: PromptTriggerOptions) => Promise<string | null>;
  cancelQueueTask: (taskId: string) => Promise<boolean>;
  setCurrentLocale: (lang: string) => Promise<boolean>;

  // System
  copyTextToClipboard: (text: string) => Promise<boolean>;
  showInFolder: (filePath: string) => Promise<void>;
  openPath: (filePath: string) => Promise<boolean>;
  openConfigDir: () => Promise<boolean>;
  exportConfig: () => Promise<boolean>;
  importConfig: () => Promise<SettingsSnapshot | null>;
  captureMarkdownDocument: (request: MarkdownCaptureRequest) => Promise<MarkdownCaptureResult>;

  // Telegram
  getTelegramSettings: () => Promise<TelegramSettingsSnapshot>;
  updateTelegramEnabled: (enabled: boolean) => Promise<boolean>;
  updateTelegramBotToken: (token: string) => Promise<{ ok: boolean; message?: string }>;
  updateTelegramAllowGroupCommands: (enabled: boolean) => Promise<boolean>;
  updateTelegramDefaultReplyMode: (mode: 'markdown' | 'png' | 'webp' | 'pdf') => Promise<boolean>;
  updateTelegramAdminUsers: (userIds: number[]) => Promise<boolean>;
  generateTelegramPairingCode: () => Promise<{ code: string; expiresAt: string } | null>;
  revokeTelegramPairingCode: (code: string) => Promise<boolean>;
  unpairTelegramUser: (userId: number) => Promise<boolean>;

  // Tray / window behavior
  getCloseToTray: () => Promise<boolean>;
  updateCloseToTray: (enabled: boolean) => Promise<boolean>;
  getAutoShowTray: () => Promise<boolean>;
  updateAutoShowTray: (enabled: boolean) => Promise<boolean>;

  // Startup auto-launch
  getLaunchAtStartup: () => Promise<boolean>;
  updateLaunchAtStartup: (enabled: boolean) => Promise<boolean>;

  // Navigation push from main
  onNavigateSettings: (cb: () => void) => () => void;

  // Notify / launch-at-startup changed (pushed from main when toggled via tray menu)
  onNotifyOnCompleteChanged: (cb: (enabled: boolean) => void) => () => void;
  onLaunchAtStartupChanged: (cb: (enabled: boolean) => void) => () => void;

  // Close dialog (main pushes, renderer responds)
  onShowCloseDialog: (cb: () => void) => () => void;
  respondCloseDialog: (action: 'quit' | 'hide', remember: boolean) => void;

  // Close-to-tray state push (main → renderer, saved via close dialog)
  onCloseToTrayChanged: (cb: (enabled: boolean) => void) => () => void;

  // Theme persistence
  getTheme: () => Promise<string>;
  updateTheme: (theme: string) => Promise<boolean>;
  // UI layout preferences
  getLayoutMode: () => Promise<string>;
  updateLayoutMode: (mode: string) => Promise<boolean>;
  getMarkdownZoom: () => Promise<number>;
  updateMarkdownZoom: (zoom: number) => Promise<boolean>;
  // Capture / export settings
  getCaptureSettings: () => Promise<CaptureSettings>;
  updateCaptureSettings: (settings: CaptureSettings) => Promise<boolean>;

  // Duck AI
  fetchDuckaiModels: () => Promise<DuckaiModelInfo[]>;

  // AgentFlow (Flow Automation)
  getFlows: () => Promise<FlowDefinition[]>;
  saveFlow: (flow: FlowDefinition) => Promise<FlowDefinition | null>;
  deleteFlow: (flowId: string) => Promise<boolean>;
  duplicateFlow: (flowId: string) => Promise<FlowDefinition | null>;
  moveFlow: (flowId: string, direction: 'up' | 'down') => Promise<FlowDefinition[]>;
  executeFlow: (flowId: string) => Promise<FlowExecutionResult>;
  exportFlow: (flow: FlowDefinition) => Promise<boolean>;
  onFlowExecutionLog: (cb: (log: FlowExecutionLog) => void) => () => void;
  onFlowExecutionStarted: (cb: (event: FlowExecutionEvent) => void) => () => void;
  onFlowExecutionEnded: (cb: (event: FlowExecutionEvent) => void) => () => void;

  // RSS Checkpoint
  rssHasCheckpoint: (stepId: string) => Promise<boolean>;
  rssClearCheckpoint: (stepId: string) => Promise<boolean>;

  // Scraper Checkpoint
  scraperHasCheckpoint: (stepId: string) => Promise<boolean>;
  scraperClearCheckpoint: (stepId: string) => Promise<boolean>;
};

const api: ElectronAPI = {
  showWorker: () => ipcRenderer.send(IPC.SHOW_WORKER),
  hideWorker: () => ipcRenderer.send(IPC.HIDE_WORKER),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  onLog: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on(IPC.LOG, handler);
    return () => ipcRenderer.removeListener(IPC.LOG, handler);
  },
  onStatus: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, status: string) => cb(status);
    ipcRenderer.on(IPC.STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.STATUS, handler);
  },
  onQueueUpdate: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, state: QueueState) => cb(state);
    ipcRenderer.on(IPC.QUEUE_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC.QUEUE_UPDATE, handler);
  },
  onFileListUpdate: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, files: OutputFile[]) => cb(files);
    ipcRenderer.on(IPC.FILE_LIST, handler);
    return () => ipcRenderer.removeListener(IPC.FILE_LIST, handler);
  },
  onUiNotification: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, payload: UiNotificationPayload) => cb(payload);
    ipcRenderer.on(IPC.UI_NOTIFICATION, handler);
    return () => ipcRenderer.removeListener(IPC.UI_NOTIFICATION, handler);
  },
  onTelegramRuntime: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, snapshot: TelegramRuntimeSnapshot) => cb(snapshot);
    ipcRenderer.on(IPC.TELEGRAM_RUNTIME, handler);
    return () => ipcRenderer.removeListener(IPC.TELEGRAM_RUNTIME, handler);
  },

  getFileList: () => ipcRenderer.invoke(IPC.GET_FILE_LIST),
  searchFileList: (query) => ipcRenderer.invoke(IPC.SEARCH_FILE_LIST, query),
  getFileContent: (filePath) => ipcRenderer.invoke(IPC.GET_FILE_CONTENT, filePath),
  deleteFile: (filePath) => ipcRenderer.invoke(IPC.DELETE_FILE, filePath),
  deleteAllFiles: () => ipcRenderer.invoke(IPC.DELETE_ALL_FILES),
  updateFileTitle: (filePath, title) => ipcRenderer.invoke(IPC.UPDATE_FILE_TITLE, filePath, title),
  updateFileH1: (filePath, title) => ipcRenderer.invoke(IPC.UPDATE_FILE_H1, filePath, title),

  getHotkey: () => ipcRenderer.invoke(IPC.GET_HOTKEY),
  updateHotkey: (hotkey) => ipcRenderer.invoke(IPC.UPDATE_HOTKEY, hotkey),
  setHotkeyPaused: (paused) => ipcRenderer.invoke(IPC.SET_HOTKEY_PAUSED, paused),
  getAiUrl: () => ipcRenderer.invoke(IPC.GET_AI_URL),
  updateAiUrl: (url) => ipcRenderer.invoke(IPC.UPDATE_AI_URL, url),

  getLanguageList: () => ipcRenderer.invoke(IPC.GET_LANGUAGE_LIST),
  getLanguageContent: (lang) => ipcRenderer.invoke(IPC.GET_LANGUAGE_CONTENT, lang),
  getCurrentLocale: () => ipcRenderer.invoke(IPC.GET_CURRENT_LOCALE),
  setLocaleAuto: (lang) => ipcRenderer.invoke(IPC.SET_LOCALE_AUTO, lang),

  getLicense: () => ipcRenderer.invoke(IPC.GET_LICENSE),
  checkForUpdates: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
  onUpdateAvailable: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, payload: UpdateAvailablePayload) => cb(payload);
    ipcRenderer.on(IPC.UPDATE_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATE_AVAILABLE, handler);
  },
  onUpdateNotAvailable: (cb) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.UPDATE_NOT_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATE_NOT_AVAILABLE, handler);
  },
  onUpdateError: (cb) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.UPDATE_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATE_ERROR, handler);
  },
  openExternal: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL_URL, url),
  openExternalUrl: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL_URL, url),
  getAppVersion: () => ipcRenderer.invoke(IPC.GET_APP_VERSION),
  getAppIconDataUrl: () => ipcRenderer.invoke(IPC.GET_APP_ICON_DATA_URL),

  getCustomPrompt: () => ipcRenderer.invoke(IPC.GET_CUSTOM_PROMPT),
  updateCustomPrompt: (text) => ipcRenderer.invoke(IPC.UPDATE_CUSTOM_PROMPT, text),
  getSyncSystemLanguageToModel: () => ipcRenderer.invoke(IPC.GET_SYNC_SYSTEM_LANGUAGE_TO_MODEL),
  updateSyncSystemLanguageToModel: (enabled) => ipcRenderer.invoke(IPC.UPDATE_SYNC_SYSTEM_LANGUAGE_TO_MODEL, enabled),
  getNotifyOnComplete: () => ipcRenderer.invoke(IPC.GET_NOTIFY_ON_COMPLETE),
  updateNotifyOnComplete: (enabled) => ipcRenderer.invoke(IPC.UPDATE_NOTIFY_ON_COMPLETE, enabled),
  getPromptPreferences: () => ipcRenderer.invoke(IPC.GET_PROMPT_PREFERENCES),
  updatePromptPreferences: (prefs, builtPrompt) => ipcRenderer.invoke(IPC.UPDATE_PROMPT_PREFERENCES, prefs, builtPrompt),
  getResponseTimeout: () => ipcRenderer.invoke(IPC.GET_RESPONSE_TIMEOUT),
  updateResponseTimeout: (ms) => ipcRenderer.invoke(IPC.UPDATE_RESPONSE_TIMEOUT, ms),
  resetSettings: () => ipcRenderer.invoke(IPC.RESET_SETTINGS),

  triggerPrompt: (prompt) => ipcRenderer.send(IPC.TRIGGER_PROMPT, prompt),
  triggerPromptWithOptions: (options) => ipcRenderer.invoke(IPC.TRIGGER_PROMPT_WITH_OPTIONS, options),
  cancelQueueTask: (taskId) => ipcRenderer.invoke(IPC.CANCEL_QUEUE_TASK, taskId),
  setCurrentLocale: (lang) => ipcRenderer.invoke(IPC.SET_CURRENT_LOCALE, lang),

  copyTextToClipboard: (text) => ipcRenderer.invoke(IPC.COPY_TEXT_TO_CLIPBOARD, text),
  showInFolder: (filePath) => ipcRenderer.invoke(IPC.SHOW_IN_FOLDER, filePath),
  openPath: (filePath) => ipcRenderer.invoke(IPC.OPEN_PATH, filePath),
  openConfigDir: () => ipcRenderer.invoke(IPC.OPEN_CONFIG_DIR),
  exportConfig: () => ipcRenderer.invoke(IPC.EXPORT_CONFIG),
  importConfig: () => ipcRenderer.invoke(IPC.IMPORT_CONFIG),
  captureMarkdownDocument: (request) => ipcRenderer.invoke(IPC.CAPTURE_MARKDOWN_IMAGE, request),

  getTelegramSettings: () => ipcRenderer.invoke(IPC.GET_TELEGRAM_SETTINGS),
  updateTelegramEnabled: (enabled) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_ENABLED, enabled),
  updateTelegramBotToken: (token) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_BOT_TOKEN, token),
  updateTelegramAllowGroupCommands: (enabled) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_ALLOW_GROUP_COMMANDS, enabled),
  updateTelegramDefaultReplyMode: (mode) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_DEFAULT_REPLY_MODE, mode),
  updateTelegramAdminUsers: (userIds) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_ADMIN_USERS, userIds),
  generateTelegramPairingCode: () => ipcRenderer.invoke(IPC.GENERATE_TELEGRAM_PAIRING_CODE),
  revokeTelegramPairingCode: (code) => ipcRenderer.invoke(IPC.REVOKE_TELEGRAM_PAIRING_CODE, code),
  unpairTelegramUser: (userId) => ipcRenderer.invoke(IPC.UNPAIR_TELEGRAM_USER, userId),

  getCloseToTray: () => ipcRenderer.invoke(IPC.GET_CLOSE_TO_TRAY),
  updateCloseToTray: (enabled) => ipcRenderer.invoke(IPC.UPDATE_CLOSE_TO_TRAY, enabled),
  getAutoShowTray: () => ipcRenderer.invoke(IPC.GET_AUTO_SHOW_TRAY),
  updateAutoShowTray: (enabled) => ipcRenderer.invoke(IPC.UPDATE_AUTO_SHOW_TRAY, enabled),

  getLaunchAtStartup: () => ipcRenderer.invoke(IPC.GET_LAUNCH_AT_STARTUP),
  updateLaunchAtStartup: (enabled) => ipcRenderer.invoke(IPC.UPDATE_LAUNCH_AT_STARTUP, enabled),

  onNavigateSettings: (cb) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.NAVIGATE_SETTINGS, handler);
    return () => ipcRenderer.removeListener(IPC.NAVIGATE_SETTINGS, handler);
  },

  onShowCloseDialog: (cb) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.SHOW_CLOSE_DIALOG, handler);
    return () => ipcRenderer.removeListener(IPC.SHOW_CLOSE_DIALOG, handler);
  },
  respondCloseDialog: (action, remember) => {
    ipcRenderer.send(IPC.RESPOND_CLOSE_DIALOG, action, remember);
  },

  onNotifyOnCompleteChanged: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, enabled: boolean) => cb(enabled);
    ipcRenderer.on(IPC.NOTIFY_ON_COMPLETE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.NOTIFY_ON_COMPLETE_CHANGED, handler);
  },
  onLaunchAtStartupChanged: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, enabled: boolean) => cb(enabled);
    ipcRenderer.on(IPC.LAUNCH_AT_STARTUP_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.LAUNCH_AT_STARTUP_CHANGED, handler);
  },
  onCloseToTrayChanged: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, enabled: boolean) => cb(enabled);
    ipcRenderer.on(IPC.CLOSE_TO_TRAY_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.CLOSE_TO_TRAY_CHANGED, handler);
  },

  getTheme: () => ipcRenderer.invoke(IPC.GET_THEME),
  updateTheme: (theme) => ipcRenderer.invoke(IPC.UPDATE_THEME, theme),

  getLayoutMode: () => ipcRenderer.invoke(IPC.GET_LAYOUT_MODE),
  updateLayoutMode: (mode) => ipcRenderer.invoke(IPC.UPDATE_LAYOUT_MODE, mode),
  getMarkdownZoom: () => ipcRenderer.invoke(IPC.GET_MARKDOWN_ZOOM),
  updateMarkdownZoom: (zoom) => ipcRenderer.invoke(IPC.UPDATE_MARKDOWN_ZOOM, zoom),

  getCaptureSettings: () => ipcRenderer.invoke(IPC.GET_CAPTURE_SETTINGS),
  updateCaptureSettings: (settings) => ipcRenderer.invoke(IPC.UPDATE_CAPTURE_SETTINGS, settings),

  fetchDuckaiModels: () => ipcRenderer.invoke(IPC.DUCKAI_FETCH_MODELS),

  // AgentFlow (Flow Automation)
  getFlows: () => ipcRenderer.invoke(IPC.FLOW_GET_ALL),
  saveFlow: (flow) => ipcRenderer.invoke(IPC.FLOW_SAVE, flow),
  deleteFlow: (flowId) => ipcRenderer.invoke(IPC.FLOW_DELETE, flowId),
  duplicateFlow: (flowId) => ipcRenderer.invoke(IPC.FLOW_DUPLICATE, flowId),
  moveFlow: (flowId, direction) => ipcRenderer.invoke(IPC.FLOW_MOVE, flowId, direction),
  executeFlow: (flowId) => ipcRenderer.invoke(IPC.FLOW_EXECUTE, flowId),
  exportFlow: (flow) => ipcRenderer.invoke(IPC.FLOW_EXPORT, flow),
  onFlowExecutionLog: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, log: FlowExecutionLog) => cb(log);
    ipcRenderer.on(IPC.FLOW_EXECUTION_LOG, handler);
    return () => ipcRenderer.removeListener(IPC.FLOW_EXECUTION_LOG, handler);
  },
  onFlowExecutionStarted: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, event: FlowExecutionEvent) => cb(event);
    ipcRenderer.on(IPC.FLOW_EXECUTION_STARTED, handler);
    return () => ipcRenderer.removeListener(IPC.FLOW_EXECUTION_STARTED, handler);
  },
  onFlowExecutionEnded: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, event: FlowExecutionEvent) => cb(event);
    ipcRenderer.on(IPC.FLOW_EXECUTION_ENDED, handler);
    return () => ipcRenderer.removeListener(IPC.FLOW_EXECUTION_ENDED, handler);
  },

  // RSS Checkpoint
  rssHasCheckpoint: (stepId) => ipcRenderer.invoke(IPC.RSS_HAS_CHECKPOINT, stepId),
  rssClearCheckpoint: (stepId) => ipcRenderer.invoke(IPC.RSS_CLEAR_CHECKPOINT, stepId),

  // Scraper Checkpoint
  scraperHasCheckpoint: (stepId) => ipcRenderer.invoke(IPC.SCRAPER_HAS_CHECKPOINT, stepId),
  scraperClearCheckpoint: (stepId) => ipcRenderer.invoke(IPC.SCRAPER_CLEAR_CHECKPOINT, stepId),
};

contextBridge.exposeInMainWorld('electronAPI', api);
