import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/types';
import type {
  AccountStatus, AuthProvider, BackupCategoryId, BackupCategoryInfo, BackupExportResult,
  BackupImportResult, BackupInspectResult, BotLlmDirectConfig, ByokConnectionProbe, ByokGroupSaveRequest, ByokInstanceSaveRequest, ByokModelsResult,
  ByokSettingsSnapshot, ByokTestResult, CaptureSettings, ChatCommandResult, DuckaiModelInfo,
  FeedCandidate, FlowDefinition, FlowExecutionEvent, FlowExecutionLog, FlowExecutionResult, HiddenSources,
  FlowGenerationResult, MarkdownCaptureRequest, MarkdownCaptureResult, MetricsSnapshot, NotifyEventPrefs, OutputFile, PromptPreferences,
  PromptTriggerOptions, Provider, QueueState, EmailSettingsSnapshot, SmtpCredentials,
  SelectPathRequest, SelectPathResult, SettingsSnapshot, TempChatResult, BotProviderCommand, TelegramRuntimeSnapshot,
  TelegramSettingsSnapshot, LineSettingsSnapshot, LineRuntimeSnapshot, LineCredentialsUpdate,
  UpdateAvailablePayload, UpdateSource, UiNotificationPayload,
} from '../shared/types';

export type ElectronAPI = {
  showWorker: () => void;
  hideWorker: () => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;

  onLog: (cb: (msg: string) => void) => () => void;
  onStatus: (cb: (status: string) => void) => () => void;
  onQueueUpdate: (cb: (state: QueueState) => void) => () => void;
  onFileListUpdate: (cb: (files: OutputFile[]) => void) => () => void;
  onUiNotification: (cb: (payload: UiNotificationPayload) => void) => () => void;
  onTelegramRuntime: (cb: (snapshot: TelegramRuntimeSnapshot) => void) => () => void;
  onLineRuntime: (cb: (snapshot: LineRuntimeSnapshot) => void) => () => void;

  getAccountStatuses: () => Promise<AccountStatus[]>;
  openAccountLogin: (provider: AuthProvider) => Promise<boolean>;
  logoutAccount: (provider: AuthProvider) => Promise<boolean>;
  clearProviderData: (provider: Provider) => Promise<boolean>;
  onAccountStatusChanged: (cb: (status: AccountStatus) => void) => () => void;

  getFileList: () => Promise<OutputFile[]>;
  searchFileList: (query: string) => Promise<OutputFile[]>;
  getFileContent: (filePath: string) => Promise<string | null>;
  deleteFile: (filePath: string) => Promise<boolean>;
  deleteFiles: (filePaths: string[]) => Promise<number>;
  deleteAllFiles: () => Promise<number>;
  updateFileTitle: (filePath: string, title: string) => Promise<{ ok: boolean; updatedPath: string }>;
  updateFileH1: (filePath: string, title: string) => Promise<boolean>;

  getHotkey: () => Promise<string>;
  updateHotkey: (hotkey: string) => Promise<boolean>;
  setHotkeyPaused: (paused: boolean) => Promise<boolean>;
  getAiUrl: () => Promise<string>;
  updateAiUrl: (url: string) => Promise<boolean>;
  getHiddenSources: () => Promise<HiddenSources>;
  updateHiddenSources: (next: HiddenSources) => Promise<{ ok: boolean }>;

  getLanguageList: () => Promise<string[]>;
  getLanguageContent: (lang: string) => Promise<Record<string, unknown> | null>;
  getCurrentLocale: () => Promise<{ locale: string; setByUser: boolean }>;
  setLocaleAuto: (lang: string) => Promise<boolean>;

  checkForUpdates: () => Promise<boolean>;
  getUpdateSource: () => Promise<UpdateSource>;
  onUpdateAvailable: (cb: (payload: UpdateAvailablePayload) => void) => () => void;
  onUpdateNotAvailable: (cb: () => void) => () => void;
  onUpdateError: (cb: () => void) => () => void;
  openExternalUrl: (url: string) => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  getAppIconDataUrl: () => Promise<string>;

  getSyncSystemLanguageToModel: () => Promise<boolean>;
  updateSyncSystemLanguageToModel: (enabled: boolean) => Promise<boolean>;
  getNotifyOnComplete: () => Promise<boolean>;
  updateNotifyOnComplete: (enabled: boolean) => Promise<boolean>;
  getNotifyEvents: () => Promise<NotifyEventPrefs>;
  updateNotifyEvents: (prefs: NotifyEventPrefs) => Promise<boolean>;
  getPromptPreferences: () => Promise<PromptPreferences>;
  updatePromptPreferences: (prefs: PromptPreferences, builtPrompt: string) => Promise<boolean>;
  getYoutubePrompt: () => Promise<string>;
  updateYoutubePrompt: (prompt: string) => Promise<boolean>;
  getResponseTimeout: () => Promise<number>;
  updateResponseTimeout: (ms: number) => Promise<boolean>;
  resetSettings: () => Promise<SettingsSnapshot | null>;

  triggerPrompt: (prompt: string) => void;
  triggerPromptWithOptions: (options: PromptTriggerOptions) => Promise<string | null>;
  cancelQueueTask: (taskId: string) => Promise<boolean>;
  forceSkipActiveTask: () => Promise<boolean>;
  setCurrentLocale: (lang: string) => Promise<boolean>;

  copyTextToClipboard: (text: string) => Promise<boolean>;
  getPathForFile: (file: File) => string;
  showInFolder: (filePath: string) => Promise<void>;
  openPath: (filePath: string) => Promise<boolean>;
  openConfigDir: () => Promise<boolean>;
  openThirdPartyLicenses: () => Promise<boolean>;
  backupGetCategories: () => Promise<BackupCategoryInfo[]>;
  backupExport: (categories: BackupCategoryId[], namePrefix?: string) => Promise<BackupExportResult>;
  backupInspect: (zipPath: string) => Promise<BackupInspectResult>;
  backupImport: (zipPath: string, categories: BackupCategoryId[]) => Promise<BackupImportResult>;
  selectPath: (request?: SelectPathRequest) => Promise<SelectPathResult | null>;
  captureMarkdownDocument: (request: MarkdownCaptureRequest) => Promise<MarkdownCaptureResult>;

  getTelegramSettings: () => Promise<TelegramSettingsSnapshot>;
  updateTelegramEnabled: (enabled: boolean) => Promise<boolean>;
  updateTelegramBotToken: (token: string) => Promise<{ ok: boolean; message?: string }>;
  updateTelegramAllowGroupCommands: (enabled: boolean) => Promise<boolean>;
  updateTelegramDefaultReplyMode: (mode: 'markdown' | 'png' | 'webp' | 'pdf') => Promise<boolean>;
  updateTelegramCompactReply: (enabled: boolean) => Promise<boolean>;
  updateTelegramAdminUsers: (userIds: number[]) => Promise<boolean>;
  getBotProviderCommands: () => Promise<Record<Provider, BotProviderCommand>>;
  updateBotProviderCommands: (commands: Record<Provider, BotProviderCommand>) => Promise<boolean>;
  updateTelegramLlmDirect: (config: BotLlmDirectConfig) => Promise<boolean>;
  generateTelegramPairingCode: () => Promise<{ code: string; expiresAt: string } | null>;
  revokeTelegramPairingCode: (code: string) => Promise<boolean>;
  unpairTelegramUser: (userId: number) => Promise<boolean>;

  getLineSettings: () => Promise<LineSettingsSnapshot>;
  updateLineEnabled: (enabled: boolean) => Promise<{ ok: boolean; message?: string }>;
  updateLineCredentials: (creds: LineCredentialsUpdate) => Promise<{ ok: boolean; message?: string }>;
  updateLinePort: (port: number) => Promise<{ ok: boolean; message?: string }>;
  updateLineLlmDirect: (config: BotLlmDirectConfig) => Promise<{ ok: boolean; snapshot: LineSettingsSnapshot }>;
  generateLinePairingCode: () => Promise<{ ok: boolean; snapshot: LineSettingsSnapshot }>;
  revokeLinePairingCode: (code: string) => Promise<{ ok: boolean; snapshot: LineSettingsSnapshot }>;
  unpairLineUser: (userId: string) => Promise<{ ok: boolean; snapshot: LineSettingsSnapshot }>;
  refreshLineAccount: () => Promise<{ ok: boolean; message?: string }>;

  getEmailSettings: () => Promise<EmailSettingsSnapshot>;
  updateEmailEnabled: (enabled: boolean) => Promise<{ ok: boolean }>;
  updateEmailCredentials: (creds: SmtpCredentials) => Promise<{ ok: boolean; message?: string }>;

  getByokSettings: () => Promise<ByokSettingsSnapshot>;
  saveByokInstance: (req: ByokInstanceSaveRequest) => Promise<{ ok: boolean; snapshot: ByokSettingsSnapshot }>;
  deleteByokInstance: (id: string) => Promise<{ ok: boolean; snapshot: ByokSettingsSnapshot }>;
  listByokModels: (req: ByokConnectionProbe) => Promise<ByokModelsResult>;
  testByokInstance: (req: ByokConnectionProbe) => Promise<ByokTestResult>;
  saveByokGroup: (req: ByokGroupSaveRequest) => Promise<{ ok: boolean; snapshot: ByokSettingsSnapshot }>;
  deleteByokGroup: (id: string) => Promise<{ ok: boolean; snapshot: ByokSettingsSnapshot }>;

  getTempChatMode: () => Promise<boolean>;
  setTempChatMode: (enabled: boolean) => Promise<boolean>;
  onTempChatModeChanged: (cb: (enabled: boolean) => void) => () => void;
  onTempChatResult: (cb: (payload: TempChatResult) => void) => () => void;

  getMetrics: () => Promise<MetricsSnapshot>;
  resetMetrics: () => Promise<MetricsSnapshot>;
  getMetricsEnabled: () => Promise<boolean>;
  updateMetricsEnabled: (enabled: boolean) => Promise<boolean>;
  onMetricsChanged: (cb: (snapshot: MetricsSnapshot) => void) => () => void;

  getCloseToTray: () => Promise<boolean>;
  updateCloseToTray: (enabled: boolean) => Promise<boolean>;

  getLaunchAtStartup: () => Promise<boolean>;
  updateLaunchAtStartup: (enabled: boolean) => Promise<boolean>;

  onNavigateSettings: (cb: () => void) => () => void;

  onNotifyOnCompleteChanged: (cb: (enabled: boolean) => void) => () => void;
  onLaunchAtStartupChanged: (cb: (enabled: boolean) => void) => () => void;

  onShowCloseDialog: (cb: () => void) => () => void;
  respondCloseDialog: (action: 'quit' | 'hide', remember: boolean) => void;

  onCloseToTrayChanged: (cb: (enabled: boolean) => void) => () => void;

  getTheme: () => Promise<string>;
  updateTheme: (theme: string) => Promise<boolean>;
  getLayoutMode: () => Promise<string>;
  updateLayoutMode: (mode: string) => Promise<boolean>;
  getMarkdownZoom: () => Promise<number>;
  updateMarkdownZoom: (zoom: number) => Promise<boolean>;
  getCaptureSettings: () => Promise<CaptureSettings>;
  updateCaptureSettings: (settings: CaptureSettings) => Promise<boolean>;

  fetchDuckaiModels: () => Promise<DuckaiModelInfo[]>;

  getFlows: () => Promise<FlowDefinition[]>;
  saveFlow: (flow: FlowDefinition) => Promise<FlowDefinition | null>;
  deleteFlow: (flowId: string) => Promise<boolean>;
  deleteFlows: (flowIds: string[]) => Promise<boolean>;
  setFlowsEnabled: (flowIds: string[], enabled: boolean) => Promise<FlowDefinition[]>;
  duplicateFlow: (flowId: string) => Promise<FlowDefinition | null>;
  moveFlow: (flowId: string, direction: 'up' | 'down') => Promise<FlowDefinition[]>;
  reorderFlows: (orderedIds: string[]) => Promise<FlowDefinition[]>;
  executeFlow: (flowId: string) => Promise<FlowExecutionResult>;
  runChatCommand: (flowId: string, command: string, input: string) => Promise<ChatCommandResult>;
  abortFlow: (flowId: string) => Promise<boolean>;
  generateFlow: (description: string) => Promise<FlowGenerationResult>;
  exportFlow: (flow: FlowDefinition) => Promise<boolean>;
  exportFlowResult: (content: string, defaultFileName: string) => Promise<boolean>;
  onFlowExecutionLog: (cb: (log: FlowExecutionLog) => void) => () => void;
  onFlowExecutionStarted: (cb: (event: FlowExecutionEvent) => void) => () => void;
  onFlowExecutionEnded: (cb: (event: FlowExecutionEvent) => void) => () => void;

  rssHasCheckpoint: (stepId: string) => Promise<boolean>;
  rssClearCheckpoint: (stepId: string) => Promise<boolean>;
  rssDiscoverFeed: (siteUrl: string) => Promise<FeedCandidate[]>;

  scraperHasCheckpoint: (stepId: string) => Promise<boolean>;
  scraperClearCheckpoint: (stepId: string) => Promise<boolean>;

  ytSubsHasCheckpoint: (stepId: string) => Promise<boolean>;
  ytSubsClearCheckpoint: (stepId: string) => Promise<boolean>;
};

const api: ElectronAPI = {
  showWorker: () => ipcRenderer.send(IPC.SHOW_WORKER),
  hideWorker: () => ipcRenderer.send(IPC.HIDE_WORKER),
  minimizeWindow: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IPC.WINDOW_CLOSE),

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
  onLineRuntime: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, snapshot: LineRuntimeSnapshot) => cb(snapshot);
    ipcRenderer.on(IPC.LINE_RUNTIME, handler);
    return () => ipcRenderer.removeListener(IPC.LINE_RUNTIME, handler);
  },
  getAccountStatuses: () => ipcRenderer.invoke(IPC.GET_ACCOUNT_STATUSES),
  openAccountLogin: (provider) => ipcRenderer.invoke(IPC.OPEN_ACCOUNT_LOGIN, provider),
  logoutAccount: (provider) => ipcRenderer.invoke(IPC.ACCOUNT_LOGOUT, provider),
  clearProviderData: (provider) => ipcRenderer.invoke(IPC.PROVIDER_CLEAR_DATA, provider),
  onAccountStatusChanged: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, status: AccountStatus) => cb(status);
    ipcRenderer.on(IPC.ACCOUNT_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.ACCOUNT_STATUS_CHANGED, handler);
  },

  getFileList: () => ipcRenderer.invoke(IPC.GET_FILE_LIST),
  searchFileList: (query) => ipcRenderer.invoke(IPC.SEARCH_FILE_LIST, query),
  getFileContent: (filePath) => ipcRenderer.invoke(IPC.GET_FILE_CONTENT, filePath),
  deleteFile: (filePath) => ipcRenderer.invoke(IPC.DELETE_FILE, filePath),
  deleteFiles: (filePaths) => ipcRenderer.invoke(IPC.DELETE_FILES, filePaths),
  deleteAllFiles: () => ipcRenderer.invoke(IPC.DELETE_ALL_FILES),
  updateFileTitle: (filePath, title) => ipcRenderer.invoke(IPC.UPDATE_FILE_TITLE, filePath, title),
  updateFileH1: (filePath, title) => ipcRenderer.invoke(IPC.UPDATE_FILE_H1, filePath, title),

  getHotkey: () => ipcRenderer.invoke(IPC.GET_HOTKEY),
  updateHotkey: (hotkey) => ipcRenderer.invoke(IPC.UPDATE_HOTKEY, hotkey),
  setHotkeyPaused: (paused) => ipcRenderer.invoke(IPC.SET_HOTKEY_PAUSED, paused),
  getAiUrl: () => ipcRenderer.invoke(IPC.GET_AI_URL),
  updateAiUrl: (url) => ipcRenderer.invoke(IPC.UPDATE_AI_URL, url),
  getHiddenSources: () => ipcRenderer.invoke(IPC.GET_HIDDEN_SOURCES),
  updateHiddenSources: (next) => ipcRenderer.invoke(IPC.UPDATE_HIDDEN_SOURCES, next),

  getLanguageList: () => ipcRenderer.invoke(IPC.GET_LANGUAGE_LIST),
  getLanguageContent: (lang) => ipcRenderer.invoke(IPC.GET_LANGUAGE_CONTENT, lang),
  getCurrentLocale: () => ipcRenderer.invoke(IPC.GET_CURRENT_LOCALE),
  setLocaleAuto: (lang) => ipcRenderer.invoke(IPC.SET_LOCALE_AUTO, lang),

  checkForUpdates: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
  getUpdateSource: () => ipcRenderer.invoke(IPC.GET_UPDATE_SOURCE),
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
  openExternalUrl: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL_URL, url),
  getAppVersion: () => ipcRenderer.invoke(IPC.GET_APP_VERSION),
  getAppIconDataUrl: () => ipcRenderer.invoke(IPC.GET_APP_ICON_DATA_URL),

  getSyncSystemLanguageToModel: () => ipcRenderer.invoke(IPC.GET_SYNC_SYSTEM_LANGUAGE_TO_MODEL),
  updateSyncSystemLanguageToModel: (enabled) => ipcRenderer.invoke(IPC.UPDATE_SYNC_SYSTEM_LANGUAGE_TO_MODEL, enabled),
  getNotifyOnComplete: () => ipcRenderer.invoke(IPC.GET_NOTIFY_ON_COMPLETE),
  updateNotifyOnComplete: (enabled) => ipcRenderer.invoke(IPC.UPDATE_NOTIFY_ON_COMPLETE, enabled),
  getNotifyEvents: () => ipcRenderer.invoke(IPC.GET_NOTIFY_EVENTS),
  updateNotifyEvents: (prefs) => ipcRenderer.invoke(IPC.UPDATE_NOTIFY_EVENTS, prefs),
  getPromptPreferences: () => ipcRenderer.invoke(IPC.GET_PROMPT_PREFERENCES),
  updatePromptPreferences: (prefs, builtPrompt) => ipcRenderer.invoke(IPC.UPDATE_PROMPT_PREFERENCES, prefs, builtPrompt),
  getYoutubePrompt: () => ipcRenderer.invoke(IPC.GET_YOUTUBE_PROMPT),
  updateYoutubePrompt: (prompt) => ipcRenderer.invoke(IPC.UPDATE_YOUTUBE_PROMPT, prompt),
  getResponseTimeout: () => ipcRenderer.invoke(IPC.GET_RESPONSE_TIMEOUT),
  updateResponseTimeout: (ms) => ipcRenderer.invoke(IPC.UPDATE_RESPONSE_TIMEOUT, ms),
  resetSettings: () => ipcRenderer.invoke(IPC.RESET_SETTINGS),

  triggerPrompt: (prompt) => ipcRenderer.send(IPC.TRIGGER_PROMPT, prompt),
  triggerPromptWithOptions: (options) => ipcRenderer.invoke(IPC.TRIGGER_PROMPT_WITH_OPTIONS, options),
  cancelQueueTask: (taskId) => ipcRenderer.invoke(IPC.CANCEL_QUEUE_TASK, taskId),
  forceSkipActiveTask: () => ipcRenderer.invoke(IPC.FORCE_SKIP_ACTIVE_TASK),
  setCurrentLocale: (lang) => ipcRenderer.invoke(IPC.SET_CURRENT_LOCALE, lang),

  copyTextToClipboard: (text) => ipcRenderer.invoke(IPC.COPY_TEXT_TO_CLIPBOARD, text),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  showInFolder: (filePath) => ipcRenderer.invoke(IPC.SHOW_IN_FOLDER, filePath),
  openPath: (filePath) => ipcRenderer.invoke(IPC.OPEN_PATH, filePath),
  openConfigDir: () => ipcRenderer.invoke(IPC.OPEN_CONFIG_DIR),
  openThirdPartyLicenses: () => ipcRenderer.invoke(IPC.OPEN_THIRD_PARTY_LICENSES),
  backupGetCategories: () => ipcRenderer.invoke(IPC.BACKUP_CATEGORIES),
  backupExport: (categories, namePrefix) => ipcRenderer.invoke(IPC.BACKUP_EXPORT, categories, namePrefix),
  backupInspect: (zipPath) => ipcRenderer.invoke(IPC.BACKUP_INSPECT, zipPath),
  backupImport: (zipPath, categories) => ipcRenderer.invoke(IPC.BACKUP_IMPORT, zipPath, categories),
  selectPath: (request) => ipcRenderer.invoke(IPC.SELECT_PATH, request),
  captureMarkdownDocument: (request) => ipcRenderer.invoke(IPC.CAPTURE_MARKDOWN_IMAGE, request),

  getTelegramSettings: () => ipcRenderer.invoke(IPC.GET_TELEGRAM_SETTINGS),
  updateTelegramEnabled: (enabled) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_ENABLED, enabled),
  updateTelegramBotToken: (token) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_BOT_TOKEN, token),
  updateTelegramAllowGroupCommands: (enabled) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_ALLOW_GROUP_COMMANDS, enabled),
  updateTelegramDefaultReplyMode: (mode) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_DEFAULT_REPLY_MODE, mode),
  updateTelegramCompactReply: (enabled) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_COMPACT_REPLY, enabled),
  updateTelegramAdminUsers: (userIds) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_ADMIN_USERS, userIds),
  getBotProviderCommands: () => ipcRenderer.invoke(IPC.GET_BOT_PROVIDER_COMMANDS),
  updateBotProviderCommands: (commands) => ipcRenderer.invoke(IPC.UPDATE_BOT_PROVIDER_COMMANDS, commands),
  updateTelegramLlmDirect: (config) => ipcRenderer.invoke(IPC.UPDATE_TELEGRAM_LLM_DIRECT, config),
  generateTelegramPairingCode: () => ipcRenderer.invoke(IPC.GENERATE_TELEGRAM_PAIRING_CODE),
  revokeTelegramPairingCode: (code) => ipcRenderer.invoke(IPC.REVOKE_TELEGRAM_PAIRING_CODE, code),
  unpairTelegramUser: (userId) => ipcRenderer.invoke(IPC.UNPAIR_TELEGRAM_USER, userId),

  getLineSettings: () => ipcRenderer.invoke(IPC.GET_LINE_SETTINGS),
  updateLineEnabled: (enabled) => ipcRenderer.invoke(IPC.UPDATE_LINE_ENABLED, enabled),
  updateLineCredentials: (creds) => ipcRenderer.invoke(IPC.UPDATE_LINE_CREDENTIALS, creds),
  updateLinePort: (port) => ipcRenderer.invoke(IPC.UPDATE_LINE_PORT, port),
  updateLineLlmDirect: (config) => ipcRenderer.invoke(IPC.UPDATE_LINE_LLM_DIRECT, config),
  generateLinePairingCode: () => ipcRenderer.invoke(IPC.GENERATE_LINE_PAIRING_CODE),
  revokeLinePairingCode: (code) => ipcRenderer.invoke(IPC.REVOKE_LINE_PAIRING_CODE, code),
  unpairLineUser: (userId) => ipcRenderer.invoke(IPC.UNPAIR_LINE_USER, userId),
  refreshLineAccount: () => ipcRenderer.invoke(IPC.REFRESH_LINE_ACCOUNT),

  getEmailSettings: () => ipcRenderer.invoke(IPC.GET_EMAIL_SETTINGS),
  updateEmailEnabled: (enabled) => ipcRenderer.invoke(IPC.UPDATE_EMAIL_ENABLED, enabled),
  updateEmailCredentials: (creds) => ipcRenderer.invoke(IPC.UPDATE_EMAIL_CREDENTIALS, creds),

  getByokSettings: () => ipcRenderer.invoke(IPC.BYOK_GET_SETTINGS),
  saveByokInstance: (req) => ipcRenderer.invoke(IPC.BYOK_SAVE_INSTANCE, req),
  deleteByokInstance: (id) => ipcRenderer.invoke(IPC.BYOK_DELETE_INSTANCE, id),
  listByokModels: (req) => ipcRenderer.invoke(IPC.BYOK_LIST_MODELS, req),
  testByokInstance: (req) => ipcRenderer.invoke(IPC.BYOK_TEST_INSTANCE, req),
  saveByokGroup: (req) => ipcRenderer.invoke(IPC.BYOK_SAVE_GROUP, req),
  deleteByokGroup: (id) => ipcRenderer.invoke(IPC.BYOK_DELETE_GROUP, id),

  getTempChatMode: () => ipcRenderer.invoke(IPC.TEMP_CHAT_GET_MODE),
  setTempChatMode: (enabled) => ipcRenderer.invoke(IPC.TEMP_CHAT_SET_MODE, enabled),
  onTempChatModeChanged: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, enabled: boolean) => cb(enabled);
    ipcRenderer.on(IPC.TEMP_CHAT_MODE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.TEMP_CHAT_MODE_CHANGED, handler);
  },
  onTempChatResult: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, payload: TempChatResult) => cb(payload);
    ipcRenderer.on(IPC.TEMP_CHAT_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC.TEMP_CHAT_RESULT, handler);
  },

  getMetrics: () => ipcRenderer.invoke(IPC.METRICS_GET),
  resetMetrics: () => ipcRenderer.invoke(IPC.METRICS_RESET),
  getMetricsEnabled: () => ipcRenderer.invoke(IPC.GET_METRICS_ENABLED),
  updateMetricsEnabled: (enabled) => ipcRenderer.invoke(IPC.UPDATE_METRICS_ENABLED, enabled),
  onMetricsChanged: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, snapshot: MetricsSnapshot) => cb(snapshot);
    ipcRenderer.on(IPC.METRICS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.METRICS_CHANGED, handler);
  },

  getCloseToTray: () => ipcRenderer.invoke(IPC.GET_CLOSE_TO_TRAY),
  updateCloseToTray: (enabled) => ipcRenderer.invoke(IPC.UPDATE_CLOSE_TO_TRAY, enabled),

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

  getFlows: () => ipcRenderer.invoke(IPC.FLOW_GET_ALL),
  saveFlow: (flow) => ipcRenderer.invoke(IPC.FLOW_SAVE, flow),
  deleteFlow: (flowId) => ipcRenderer.invoke(IPC.FLOW_DELETE, flowId),
  deleteFlows: (flowIds) => ipcRenderer.invoke(IPC.FLOW_DELETE_MANY, flowIds),
  setFlowsEnabled: (flowIds, enabled) => ipcRenderer.invoke(IPC.FLOW_SET_ENABLED_MANY, flowIds, enabled),
  duplicateFlow: (flowId) => ipcRenderer.invoke(IPC.FLOW_DUPLICATE, flowId),
  moveFlow: (flowId, direction) => ipcRenderer.invoke(IPC.FLOW_MOVE, flowId, direction),
  reorderFlows: (orderedIds) => ipcRenderer.invoke(IPC.FLOW_REORDER, orderedIds),
  executeFlow: (flowId) => ipcRenderer.invoke(IPC.FLOW_EXECUTE, flowId),
  runChatCommand: (flowId, command, input) => ipcRenderer.invoke(IPC.FLOW_RUN_CHAT_COMMAND, flowId, command, input),
  abortFlow: (flowId) => ipcRenderer.invoke(IPC.FLOW_ABORT, flowId),
  generateFlow: (description) => ipcRenderer.invoke(IPC.FLOW_GENERATE, description),
  exportFlow: (flow) => ipcRenderer.invoke(IPC.FLOW_EXPORT, flow),
  exportFlowResult: (content, defaultFileName) => ipcRenderer.invoke(IPC.FLOW_EXPORT_RESULT, { content, defaultFileName }),
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

  rssHasCheckpoint: (stepId) => ipcRenderer.invoke(IPC.RSS_HAS_CHECKPOINT, stepId),
  rssClearCheckpoint: (stepId) => ipcRenderer.invoke(IPC.RSS_CLEAR_CHECKPOINT, stepId),
  rssDiscoverFeed: (siteUrl) => ipcRenderer.invoke(IPC.RSS_DISCOVER_FEED, siteUrl),

  scraperHasCheckpoint: (stepId) => ipcRenderer.invoke(IPC.SCRAPER_HAS_CHECKPOINT, stepId),
  scraperClearCheckpoint: (stepId) => ipcRenderer.invoke(IPC.SCRAPER_CLEAR_CHECKPOINT, stepId),

  ytSubsHasCheckpoint: (stepId) => ipcRenderer.invoke(IPC.YT_SUBS_HAS_CHECKPOINT, stepId),
  ytSubsClearCheckpoint: (stepId) => ipcRenderer.invoke(IPC.YT_SUBS_CLEAR_CHECKPOINT, stepId),
};

contextBridge.exposeInMainWorld('electronAPI', api);
