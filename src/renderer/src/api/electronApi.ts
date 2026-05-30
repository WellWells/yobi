// src/renderer/src/api/electronApi.ts
// Centralized wrapper for all window.electronAPI IPC calls,
// so UI components do not depend directly on the underlying transport.
import type {
  CaptureSettings,
  DuckaiModelInfo,
  FlowDefinition,
  FlowExecutionEvent,
  FlowExecutionLog,
  FlowExecutionResult,
  MarkdownCaptureRequest,
  OutputFile,
  PromptPreferences,
  PromptTriggerOptions,
  QueueState,
  SettingsSnapshot,
  TelegramRuntimeSnapshot,
  TelegramSettingsSnapshot,
  UpdateAvailablePayload,
  UiNotificationPayload,
} from '../../../shared/types';

export const fileApi = {
  getList: (): Promise<OutputFile[]> => window.electronAPI.getFileList(),
  search: (query: string): Promise<OutputFile[]> => window.electronAPI.searchFileList(query),
  getContent: (filePath: string): Promise<string | null> => window.electronAPI.getFileContent(filePath),
  deleteFile: (filePath: string): Promise<boolean> => window.electronAPI.deleteFile(filePath),
  deleteAll: (): Promise<number> => window.electronAPI.deleteAllFiles(),
  updateTitle: (filePath: string, title: string) => window.electronAPI.updateFileTitle(filePath, title),
  updateH1: (filePath: string, title: string): Promise<boolean> => window.electronAPI.updateFileH1(filePath, title),
  showInFolder: (filePath: string): Promise<void> => window.electronAPI.showInFolder(filePath),
  openPath: (filePath: string): Promise<boolean> => window.electronAPI.openPath(filePath),
};

export const settingsApi = {
  getHotkey: (): Promise<string> => window.electronAPI.getHotkey(),
  updateHotkey: (hotkey: string): Promise<boolean> => window.electronAPI.updateHotkey(hotkey),
  setHotkeyPaused: (paused: boolean): Promise<boolean> => window.electronAPI.setHotkeyPaused(paused),
  getAiUrl: (): Promise<string> => window.electronAPI.getAiUrl(),
  updateAiUrl: (url: string): Promise<boolean> => window.electronAPI.updateAiUrl(url),
  getPromptPreferences: (): Promise<PromptPreferences> => window.electronAPI.getPromptPreferences(),
  updatePromptPreferences: (prefs: PromptPreferences, builtPrompt: string): Promise<boolean> =>
    window.electronAPI.updatePromptPreferences(prefs, builtPrompt),
  getSyncSystemLanguageToModel: (): Promise<boolean> => window.electronAPI.getSyncSystemLanguageToModel(),
  updateSyncSystemLanguageToModel: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateSyncSystemLanguageToModel(enabled),
  getNotifyOnComplete: (): Promise<boolean> => window.electronAPI.getNotifyOnComplete(),
  updateNotifyOnComplete: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateNotifyOnComplete(enabled),
  getCloseToTray: (): Promise<boolean> => window.electronAPI.getCloseToTray(),
  updateCloseToTray: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateCloseToTray(enabled),
  getLaunchAtStartup: (): Promise<boolean> => window.electronAPI.getLaunchAtStartup(),
  updateLaunchAtStartup: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateLaunchAtStartup(enabled),
  getResponseTimeout: (): Promise<number> => window.electronAPI.getResponseTimeout(),
  updateResponseTimeout: (ms: number): Promise<boolean> =>
    window.electronAPI.updateResponseTimeout(ms),
  resetSettings: () => window.electronAPI.resetSettings(),
  getTheme: (): Promise<string> => window.electronAPI.getTheme(),
  updateTheme: (theme: string): Promise<boolean> => window.electronAPI.updateTheme(theme),
  getLayoutMode: (): Promise<string> => window.electronAPI.getLayoutMode(),
  updateLayoutMode: (mode: string): Promise<boolean> => window.electronAPI.updateLayoutMode(mode),
  getMarkdownZoom: (): Promise<number> => window.electronAPI.getMarkdownZoom(),
  updateMarkdownZoom: (zoom: number): Promise<boolean> => window.electronAPI.updateMarkdownZoom(zoom),
  getCaptureSettings: (): Promise<CaptureSettings> => window.electronAPI.getCaptureSettings(),
  updateCaptureSettings: (settings: CaptureSettings): Promise<boolean> => window.electronAPI.updateCaptureSettings(settings),
  fetchDuckaiModels: (): Promise<DuckaiModelInfo[]> => window.electronAPI.fetchDuckaiModels(),
};

export const telegramApi = {
  getSettings: (): Promise<TelegramSettingsSnapshot> => window.electronAPI.getTelegramSettings(),
  updateEnabled: (enabled: boolean): Promise<boolean> => window.electronAPI.updateTelegramEnabled(enabled),
  updateToken: (token: string) => window.electronAPI.updateTelegramBotToken(token),
  updateAllowGroupCommands: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateTelegramAllowGroupCommands(enabled),
  updateDefaultReplyMode: (mode: 'markdown' | 'png' | 'webp' | 'pdf'): Promise<boolean> =>
    window.electronAPI.updateTelegramDefaultReplyMode(mode),
  updateAdminUsers: (userIds: number[]): Promise<boolean> =>
    window.electronAPI.updateTelegramAdminUsers(userIds),
  generatePairingCode: () => window.electronAPI.generateTelegramPairingCode(),
  revokePairingCode: (code: string): Promise<boolean> =>
    window.electronAPI.revokeTelegramPairingCode(code),
  unpairUser: (userId: number): Promise<boolean> => window.electronAPI.unpairTelegramUser(userId),
  onRuntime: (cb: (snapshot: TelegramRuntimeSnapshot) => void) =>
    window.electronAPI.onTelegramRuntime(cb),
};

export const promptApi = {
  trigger: (prompt: string): void => window.electronAPI.triggerPrompt(prompt),
  triggerWithOptions: (options: PromptTriggerOptions): Promise<string | null> =>
    window.electronAPI.triggerPromptWithOptions(options),
};

export const clipboardApi = {
  copyText: (text: string): Promise<boolean> => window.electronAPI.copyTextToClipboard(text),
  openExternalUrl: (url: string): Promise<boolean> => window.electronAPI.openExternalUrl(url),
};

export const updateApi = {
  checkForUpdates: (): Promise<boolean> => window.electronAPI.checkForUpdates(),
  onUpdateAvailable: (cb: (payload: UpdateAvailablePayload) => void) => window.electronAPI.onUpdateAvailable(cb),
  onUpdateNotAvailable: (cb: () => void) => window.electronAPI.onUpdateNotAvailable(cb),
  onUpdateError: (cb: () => void) => window.electronAPI.onUpdateError(cb),
  openExternal: (url: string): Promise<boolean> => window.electronAPI.openExternal(url),
};

export const systemApi = {
  captureMarkdownDocument: (request: MarkdownCaptureRequest) =>
    window.electronAPI.captureMarkdownDocument(request),
  showWorker: (): void => window.electronAPI.showWorker(),
  openConfigDir: (): Promise<boolean> => window.electronAPI.openConfigDir(),
  exportConfig: (): Promise<boolean> => window.electronAPI.exportConfig(),
  importConfig: (): Promise<SettingsSnapshot | null> => window.electronAPI.importConfig(),
  getAppVersion: (): Promise<string> => window.electronAPI.getAppVersion(),
  getAppIconDataUrl: (): Promise<string> => window.electronAPI.getAppIconDataUrl(),
  getLicense: (): Promise<string> => window.electronAPI.getLicense(),
};

export const windowApi = {
  minimize: (): void => window.electronAPI.minimizeWindow(),
  maximize: (): void => window.electronAPI.maximizeWindow(),
  close: (): void => window.electronAPI.closeWindow(),
  respondCloseDialog: (action: 'quit' | 'hide', remember: boolean): void =>
    window.electronAPI.respondCloseDialog(action, remember),
};

export const ipcEvents = {
  onLog: (cb: (msg: string) => void) => window.electronAPI.onLog(cb),
  onStatus: (cb: (status: string) => void) => window.electronAPI.onStatus(cb),
  onQueueUpdate: (cb: (state: QueueState) => void) => window.electronAPI.onQueueUpdate(cb),
  onFileListUpdate: (cb: (files: OutputFile[]) => void) => window.electronAPI.onFileListUpdate(cb),
  onUiNotification: (cb: (payload: UiNotificationPayload) => void) =>
    window.electronAPI.onUiNotification(cb),
  onNavigateSettings: (cb: () => void) => window.electronAPI.onNavigateSettings(cb),
  onShowCloseDialog: (cb: () => void) => window.electronAPI.onShowCloseDialog(cb),
  onNotifyOnCompleteChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onNotifyOnCompleteChanged(cb),
  onLaunchAtStartupChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onLaunchAtStartupChanged(cb),
  onCloseToTrayChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onCloseToTrayChanged(cb),
  onFlowExecutionLog: (cb: (log: FlowExecutionLog) => void) =>
    window.electronAPI.onFlowExecutionLog(cb),
  onFlowExecutionStarted: (cb: (event: FlowExecutionEvent) => void) =>
    window.electronAPI.onFlowExecutionStarted(cb),
  onFlowExecutionEnded: (cb: (event: FlowExecutionEvent) => void) =>
    window.electronAPI.onFlowExecutionEnded(cb),
};

export const flowApi = {
  getAll: (): Promise<FlowDefinition[]> => window.electronAPI.getFlows(),
  save: (flow: FlowDefinition): Promise<FlowDefinition | null> => window.electronAPI.saveFlow(flow),
  deleteFlow: (flowId: string): Promise<boolean> => window.electronAPI.deleteFlow(flowId),
  duplicateFlow: (flowId: string): Promise<FlowDefinition | null> => window.electronAPI.duplicateFlow(flowId),
  moveFlow: (flowId: string, direction: 'up' | 'down'): Promise<FlowDefinition[]> =>
    window.electronAPI.moveFlow(flowId, direction),
  execute: (flowId: string): Promise<FlowExecutionResult> => window.electronAPI.executeFlow(flowId),
  exportFlow: (flow: FlowDefinition): Promise<boolean> => window.electronAPI.exportFlow(flow),
};

export const rssApi = {
  hasCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.rssHasCheckpoint(stepId),
  clearCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.rssClearCheckpoint(stepId),
};

export const scraperApi = {
  hasCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.scraperHasCheckpoint(stepId),
  clearCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.scraperClearCheckpoint(stepId),
};

