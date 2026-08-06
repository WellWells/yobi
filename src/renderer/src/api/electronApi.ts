import type {
  AccountStatus,
  AgentConfirmChoice,
  AgentConfirmPayload,
  AuthProvider,
  BackupCategoryId,
  BackupCategoryInfo,
  BackupExportResult,
  BackupImportResult,
  BackupInspectResult,
  BotBuiltinCommands,
  BotByokCommandInfo,
  BotLlmDirectConfig,
  ByokConnectionProbe,
  ByokGroupSaveRequest,
  ByokInstanceSaveRequest,
  ByokModelsResult,
  ByokSettingsSnapshot,
  McpServerView,
  McpServerSaveRequest,
  McpServerActionResult,
  ByokTestResult,
  CaptureSettings,
  QuickExportSettings,
  ChatCommandResult,
  DuckaiModelInfo,
  FeedCandidate,
  ScraperPickRequest,
  ScraperPickResult,
  FlowDefinition,
  FlowExecutionEvent,
  FlowExecutionLog,
  FlowExecutionResult,
  FlowGenerationResult,
  HiddenSources,
  MarkdownCaptureRequest,
  ShareLinkRequest,
  ShareLinkResult,
  ShareSettings,
  MetricsSnapshot,
  NotifyEventPrefs,
  OutputFile,
  StartedConversation,
  PromptPreferences,
  ChatTurnEvent,
  PromptTriggerOptions,
  Provider,
  QueueState,
  AgentCommandResult,
  AgentRunSummary,
  AgentTracePayload,
  SearchCommandResult,
  SearchMode,
  SelectPathRequest,
  SelectPathResult,
  TempChatResult,
  BotProviderCommand,
  TelegramRuntimeSnapshot,
  TelegramSettingsSnapshot,
  LineSettingsSnapshot,
  LineRuntimeSnapshot,
  LineCredentialsUpdate,
  EmailSettingsSnapshot,
  DataKeyStatus,
  SmtpCredentials,
  UpdateAvailablePayload,
  UpdateSource,
  UiNotificationPayload,
  HotkeyBindResult,
} from '../../../shared/types';
import type { ConversationTokenStats } from '../../../shared/tokenEstimate';

export const fileApi = {
  getList: (): Promise<OutputFile[]> => window.electronAPI.getFileList(),
  search: (query: string): Promise<OutputFile[]> => window.electronAPI.searchFileList(query),
  getContent: (filePath: string): Promise<string | null> => window.electronAPI.getFileContent(filePath),
  deleteFile: (filePath: string): Promise<boolean> => window.electronAPI.deleteFile(filePath),
  deleteFiles: (filePaths: string[]): Promise<number> => window.electronAPI.deleteFiles(filePaths),
  deleteAll: (): Promise<number> => window.electronAPI.deleteAllFiles(),
  updateTitle: (filePath: string, title: string) => window.electronAPI.updateFileTitle(filePath, title),
  updateH1: (filePath: string, title: string): Promise<boolean> => window.electronAPI.updateFileH1(filePath, title),
  startConversation: (prompt: string): Promise<StartedConversation | null> =>
    window.electronAPI.startConversation(prompt),
  showInFolder: (filePath: string): Promise<void> => window.electronAPI.showInFolder(filePath),
  openPath: (filePath: string): Promise<boolean> => window.electronAPI.openPath(filePath),
};

export const settingsApi = {
  openLanguagesFolder: (): Promise<boolean> => window.electronAPI.openLanguagesFolder(),
  getHotkey: (): Promise<string> => window.electronAPI.getHotkey(),
  updateHotkey: (hotkey: string): Promise<HotkeyBindResult> => window.electronAPI.updateHotkey(hotkey),
  setHotkeyPaused: (paused: boolean): Promise<boolean> => window.electronAPI.setHotkeyPaused(paused),
  getHotkeyEnabled: (): Promise<boolean> => window.electronAPI.getHotkeyEnabled(),
  setHotkeyEnabled: (enabled: boolean): Promise<HotkeyBindResult> => window.electronAPI.setHotkeyEnabled(enabled),
  getAiUrl: (): Promise<string> => window.electronAPI.getAiUrl(),
  updateAiUrl: (url: string): Promise<boolean> => window.electronAPI.updateAiUrl(url),
  getHiddenSources: (): Promise<HiddenSources> => window.electronAPI.getHiddenSources(),
  updateHiddenSources: (next: HiddenSources): Promise<{ ok: boolean }> =>
    window.electronAPI.updateHiddenSources(next),
  getPromptPreferences: (): Promise<PromptPreferences> => window.electronAPI.getPromptPreferences(),
  updatePromptPreferences: (prefs: PromptPreferences, builtPrompt: string): Promise<boolean> =>
    window.electronAPI.updatePromptPreferences(prefs, builtPrompt),
  getYoutubePrompt: (): Promise<string> => window.electronAPI.getYoutubePrompt(),
  updateYoutubePrompt: (prompt: string): Promise<boolean> => window.electronAPI.updateYoutubePrompt(prompt),
  getSyncSystemLanguageToModel: (): Promise<boolean> => window.electronAPI.getSyncSystemLanguageToModel(),
  updateSyncSystemLanguageToModel: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateSyncSystemLanguageToModel(enabled),
  getNotifyOnComplete: (): Promise<boolean> => window.electronAPI.getNotifyOnComplete(),
  updateNotifyOnComplete: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateNotifyOnComplete(enabled),
  getNotifyEvents: (): Promise<NotifyEventPrefs> => window.electronAPI.getNotifyEvents(),
  updateNotifyEvents: (prefs: NotifyEventPrefs): Promise<boolean> =>
    window.electronAPI.updateNotifyEvents(prefs),
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
  getShowTokenUsage: (): Promise<boolean> => window.electronAPI.getShowTokenUsage(),
  updateShowTokenUsage: (show: boolean): Promise<boolean> => window.electronAPI.updateShowTokenUsage(show),
  getMarkdownZoom: (): Promise<number> => window.electronAPI.getMarkdownZoom(),
  updateMarkdownZoom: (zoom: number): Promise<boolean> => window.electronAPI.updateMarkdownZoom(zoom),
  getCaptureSettings: (): Promise<CaptureSettings> => window.electronAPI.getCaptureSettings(),
  updateCaptureSettings: (settings: CaptureSettings): Promise<boolean> => window.electronAPI.updateCaptureSettings(settings),
  getQuickExport: (): Promise<QuickExportSettings> => window.electronAPI.getQuickExport(),
  updateQuickExport: (settings: QuickExportSettings): Promise<HotkeyBindResult> => window.electronAPI.updateQuickExport(settings),
  fetchDuckaiModels: (): Promise<DuckaiModelInfo[]> => window.electronAPI.fetchDuckaiModels(),
};

export const tempChatApi = {
  getMode: (): Promise<boolean> => window.electronAPI.getTempChatMode(),
  setMode: (enabled: boolean): Promise<boolean> => window.electronAPI.setTempChatMode(enabled),
};

export const metricsApi = {
  get: (): Promise<MetricsSnapshot> => window.electronAPI.getMetrics(),
  getConversationTokens: (): Promise<ConversationTokenStats> => window.electronAPI.getConversationTokenStats(),
  reset: (): Promise<MetricsSnapshot> => window.electronAPI.resetMetrics(),
  getEnabled: (): Promise<boolean> => window.electronAPI.getMetricsEnabled(),
  updateEnabled: (enabled: boolean): Promise<boolean> => window.electronAPI.updateMetricsEnabled(enabled),
};

export const telegramApi = {
  getSettings: (): Promise<TelegramSettingsSnapshot> => window.electronAPI.getTelegramSettings(),
  updateEnabled: (enabled: boolean): Promise<boolean> => window.electronAPI.updateTelegramEnabled(enabled),
  updateToken: (token: string) => window.electronAPI.updateTelegramBotToken(token),
  updateAllowGroupCommands: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateTelegramAllowGroupCommands(enabled),
  updateDefaultReplyMode: (mode: 'markdown' | 'png' | 'webp' | 'pdf'): Promise<boolean> =>
    window.electronAPI.updateTelegramDefaultReplyMode(mode),
  updateCompactReply: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateTelegramCompactReply(enabled),
  updateAdminUsers: (userIds: number[]): Promise<boolean> =>
    window.electronAPI.updateTelegramAdminUsers(userIds),
  updateLlmDirect: (config: BotLlmDirectConfig): Promise<boolean> =>
    window.electronAPI.updateTelegramLlmDirect(config),
  generatePairingCode: () => window.electronAPI.generateTelegramPairingCode(),
  revokePairingCode: (code: string): Promise<boolean> =>
    window.electronAPI.revokeTelegramPairingCode(code),
  unpairUser: (userId: number): Promise<boolean> => window.electronAPI.unpairTelegramUser(userId),
  forgetChannel: (chatId: number): Promise<boolean> => window.electronAPI.forgetTelegramChannel(chatId),
  onRuntime: (cb: (snapshot: TelegramRuntimeSnapshot) => void) =>
    window.electronAPI.onTelegramRuntime(cb),
};

export const botApi = {
  getProviderCommands: (): Promise<Record<Provider, BotProviderCommand>> =>
    window.electronAPI.getBotProviderCommands(),
  updateProviderCommands: (commands: Record<Provider, BotProviderCommand>): Promise<boolean> =>
    window.electronAPI.updateBotProviderCommands(commands),
  getBuiltinCommands: (): Promise<BotBuiltinCommands> =>
    window.electronAPI.getBotBuiltinCommands(),
  updateBuiltinCommands: (commands: BotBuiltinCommands): Promise<boolean> =>
    window.electronAPI.updateBotBuiltinCommands(commands),
  getByokCommands: (): Promise<BotByokCommandInfo[]> =>
    window.electronAPI.getBotByokCommands(),
  setByokCommandEnabled: (id: string, enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateBotByokCommand(id, enabled),
};

export const lineApi = {
  getSettings: (): Promise<LineSettingsSnapshot> => window.electronAPI.getLineSettings(),
  updateEnabled: (enabled: boolean): Promise<{ ok: boolean; message?: string }> =>
    window.electronAPI.updateLineEnabled(enabled),
  updateCredentials: (creds: LineCredentialsUpdate): Promise<{ ok: boolean; message?: string }> =>
    window.electronAPI.updateLineCredentials(creds),
  updatePort: (port: number): Promise<{ ok: boolean; message?: string }> =>
    window.electronAPI.updateLinePort(port),
  updateLlmDirect: (config: BotLlmDirectConfig): Promise<{ ok: boolean; snapshot: LineSettingsSnapshot }> =>
    window.electronAPI.updateLineLlmDirect(config),
  generatePairingCode: (): Promise<{ ok: boolean; snapshot: LineSettingsSnapshot }> =>
    window.electronAPI.generateLinePairingCode(),
  revokePairingCode: (code: string): Promise<{ ok: boolean; snapshot: LineSettingsSnapshot }> =>
    window.electronAPI.revokeLinePairingCode(code),
  unpairUser: (userId: string): Promise<{ ok: boolean; snapshot: LineSettingsSnapshot }> =>
    window.electronAPI.unpairLineUser(userId),
  refreshAccount: (): Promise<{ ok: boolean; message?: string }> =>
    window.electronAPI.refreshLineAccount(),
  onRuntime: (cb: (snapshot: LineRuntimeSnapshot) => void) =>
    window.electronAPI.onLineRuntime(cb),
};

export const dataKeyApi = {
  getStatus: (name: string): Promise<DataKeyStatus> => window.electronAPI.getDataKeyStatus(name),
  update: (name: string, value: string): Promise<{ ok: boolean }> => window.electronAPI.updateDataKey(name, value),
};

export const emailApi = {
  getSettings: (): Promise<EmailSettingsSnapshot> => window.electronAPI.getEmailSettings(),
  updateEnabled: (enabled: boolean): Promise<{ ok: boolean }> => window.electronAPI.updateEmailEnabled(enabled),
  updateCredentials: (creds: SmtpCredentials): Promise<{ ok: boolean; message?: string }> =>
    window.electronAPI.updateEmailCredentials(creds),
};

export const byokApi = {
  getSettings: (): Promise<ByokSettingsSnapshot> => window.electronAPI.getByokSettings(),
  saveInstance: (req: ByokInstanceSaveRequest): Promise<{ ok: boolean; snapshot: ByokSettingsSnapshot }> =>
    window.electronAPI.saveByokInstance(req),
  deleteInstance: (id: string): Promise<{ ok: boolean; snapshot: ByokSettingsSnapshot }> =>
    window.electronAPI.deleteByokInstance(id),
  listModels: (req: ByokConnectionProbe): Promise<ByokModelsResult> => window.electronAPI.listByokModels(req),
  testInstance: (req: ByokConnectionProbe): Promise<ByokTestResult> => window.electronAPI.testByokInstance(req),
  saveGroup: (req: ByokGroupSaveRequest): Promise<{ ok: boolean; snapshot: ByokSettingsSnapshot }> =>
    window.electronAPI.saveByokGroup(req),
  deleteGroup: (id: string): Promise<{ ok: boolean; snapshot: ByokSettingsSnapshot }> =>
    window.electronAPI.deleteByokGroup(id),
};

export const mcpApi = {
  list: (): Promise<McpServerView[]> => window.electronAPI.getMcpServers(),
  save: (req: McpServerSaveRequest): Promise<McpServerActionResult> => window.electronAPI.saveMcpServer(req),
  remove: (id: string): Promise<McpServerActionResult> => window.electronAPI.deleteMcpServer(id),
  connect: (id: string): Promise<McpServerActionResult> => window.electronAPI.connectMcpServer(id),
  disconnect: (id: string): Promise<McpServerActionResult> => window.electronAPI.disconnectMcpServer(id),
  onServerStatus: (cb: (servers: McpServerView[]) => void): (() => void) => window.electronAPI.onMcpServerStatus(cb),
};

export const accountApi = {
  getStatuses: (): Promise<AccountStatus[]> => window.electronAPI.getAccountStatuses(),
  openLogin: (provider: AuthProvider): Promise<boolean> => window.electronAPI.openAccountLogin(provider),
  logout: (provider: AuthProvider): Promise<boolean> => window.electronAPI.logoutAccount(provider),
  clearData: (provider: Provider): Promise<boolean> => window.electronAPI.clearProviderData(provider),
  onStatusChanged: (cb: (status: AccountStatus) => void) => window.electronAPI.onAccountStatusChanged(cb),
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
  getUpdateSource: (): Promise<UpdateSource> => window.electronAPI.getUpdateSource(),
  onUpdateAvailable: (cb: (payload: UpdateAvailablePayload) => void) => window.electronAPI.onUpdateAvailable(cb),
  onUpdateNotAvailable: (cb: () => void) => window.electronAPI.onUpdateNotAvailable(cb),
  onUpdateError: (cb: () => void) => window.electronAPI.onUpdateError(cb),
  openExternal: (url: string): Promise<boolean> => window.electronAPI.openExternalUrl(url),
};

export const shareApi = {
  getSettings: (): Promise<ShareSettings> => window.electronAPI.getShareSettings(),
  updateSettings: (patch: Partial<ShareSettings>): Promise<ShareSettings> =>
    window.electronAPI.updateShareSettings(patch),
  createLink: (request: ShareLinkRequest): Promise<ShareLinkResult> =>
    window.electronAPI.shareCreateLink(request),
  revokeLink: (deleteUrl: string): Promise<ShareLinkResult> =>
    window.electronAPI.shareRevokeLink(deleteUrl),
};

export const systemApi = {
  captureMarkdownDocument: (request: MarkdownCaptureRequest) =>
    window.electronAPI.captureMarkdownDocument(request),
  showWorker: (): void => window.electronAPI.showWorker(),
  openConfigDir: (): Promise<boolean> => window.electronAPI.openConfigDir(),
  openLogDir: (): Promise<boolean> => window.electronAPI.openLogDir(),
  selectPath: (request?: SelectPathRequest): Promise<SelectPathResult | null> =>
    window.electronAPI.selectPath(request),
  getPathForFile: (file: File): string => window.electronAPI.getPathForFile(file),
};

export const backupApi = {
  getCategories: (): Promise<BackupCategoryInfo[]> => window.electronAPI.backupGetCategories(),
  export: (categories: BackupCategoryId[], namePrefix?: string): Promise<BackupExportResult> =>
    window.electronAPI.backupExport(categories, namePrefix),
  inspect: (zipPath: string): Promise<BackupInspectResult> => window.electronAPI.backupInspect(zipPath),
  import: (zipPath: string, categories: BackupCategoryId[]): Promise<BackupImportResult> =>
    window.electronAPI.backupImport(zipPath, categories),
};

export const windowApi = {
  minimize: (): void => window.electronAPI.minimizeWindow(),
  maximize: (): void => window.electronAPI.maximizeWindow(),
  close: (): void => window.electronAPI.closeWindow(),
  respondCloseDialog: (action: 'quit' | 'hide', remember: boolean): void =>
    window.electronAPI.respondCloseDialog(action, remember),
  respondAgentConfirm: (id: string, choice: AgentConfirmChoice): void =>
    window.electronAPI.respondAgentConfirm(id, choice),
};

export const ipcEvents = {
  onLog: (cb: (msg: string) => void) => window.electronAPI.onLog(cb),
  onStatus: (cb: (status: string) => void) => window.electronAPI.onStatus(cb),
  onQueueUpdate: (cb: (state: QueueState) => void) => window.electronAPI.onQueueUpdate(cb),
  onFileListUpdate: (cb: (files: OutputFile[]) => void) => window.electronAPI.onFileListUpdate(cb),
  onChatTurn: (cb: (event: ChatTurnEvent) => void) => window.electronAPI.onChatTurn(cb),
  onUiNotification: (cb: (payload: UiNotificationPayload) => void) =>
    window.electronAPI.onUiNotification(cb),
  onNavigateSettings: (cb: () => void) => window.electronAPI.onNavigateSettings(cb),
  onShowCloseDialog: (cb: () => void) => window.electronAPI.onShowCloseDialog(cb),
  onAgentConfirm: (cb: (payload: AgentConfirmPayload) => void) => window.electronAPI.onAgentConfirm(cb),
  onFlowCreated: (cb: (flow: FlowDefinition) => void) => window.electronAPI.onFlowCreated(cb),
  onNotifyOnCompleteChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onNotifyOnCompleteChanged(cb),
  onLaunchAtStartupChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onLaunchAtStartupChanged(cb),
  onCloseToTrayChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onCloseToTrayChanged(cb),
  onMetricsChanged: (cb: (snapshot: MetricsSnapshot) => void) =>
    window.electronAPI.onMetricsChanged(cb),
  onTempChatModeChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onTempChatModeChanged(cb),
  onTempChatResult: (cb: (payload: TempChatResult) => void) =>
    window.electronAPI.onTempChatResult(cb),
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
  deleteFlows: (flowIds: string[]): Promise<boolean> => window.electronAPI.deleteFlows(flowIds),
  setFlowsEnabled: (flowIds: string[], enabled: boolean): Promise<FlowDefinition[]> =>
    window.electronAPI.setFlowsEnabled(flowIds, enabled),
  duplicateFlow: (flowId: string): Promise<FlowDefinition | null> => window.electronAPI.duplicateFlow(flowId),
  moveFlow: (flowId: string, direction: 'up' | 'down'): Promise<FlowDefinition[]> =>
    window.electronAPI.moveFlow(flowId, direction),
  reorderFlows: (orderedIds: string[]): Promise<FlowDefinition[]> =>
    window.electronAPI.reorderFlows(orderedIds),
  execute: (flowId: string): Promise<FlowExecutionResult> => window.electronAPI.executeFlow(flowId),
  runChatCommand: (flowId: string, command: string, input: string, conversationPath?: string): Promise<ChatCommandResult> =>
    window.electronAPI.runChatCommand(flowId, command, input, conversationPath),
  abort: (flowId: string): Promise<boolean> => window.electronAPI.abortFlow(flowId),
  generate: (description: string): Promise<FlowGenerationResult> => window.electronAPI.generateFlow(description),
  exportFlow: (flow: FlowDefinition): Promise<boolean> => window.electronAPI.exportFlow(flow),
  exportFlowResult: (content: string, defaultFileName: string): Promise<boolean> =>
    window.electronAPI.exportFlowResult(content, defaultFileName),
};

export const searchApi = {
  run: (query: string, targetUrl: string, mode?: SearchMode, conversationPath?: string, clientToken?: string): Promise<SearchCommandResult> =>
    window.electronAPI.runSearchCommand(query, targetUrl, mode, conversationPath, clientToken),
};

export const agentApi = {
  run: (goal: string, targetUrl: string, runId: string, conversationPath?: string): Promise<AgentCommandResult> =>
    window.electronAPI.runAgentCommand(goal, targetUrl, runId, conversationPath),
  resume: (runId: string, answer?: string): Promise<AgentCommandResult> =>
    window.electronAPI.resumeAgentRun(runId, answer),
  cancel: (runId: string): Promise<boolean> => window.electronAPI.cancelAgentRun(runId),
  listResumable: (): Promise<AgentRunSummary[]> => window.electronAPI.listResumableAgentRuns(),
  discard: (runId: string): Promise<boolean> => window.electronAPI.discardAgentRun(runId),
  onTrace: (cb: (payload: AgentTracePayload) => void): (() => void) => window.electronAPI.onAgentTrace(cb),
};

export const rssApi = {
  hasCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.rssHasCheckpoint(stepId),
  clearCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.rssClearCheckpoint(stepId),
  discoverFeed: (siteUrl: string): Promise<FeedCandidate[]> => window.electronAPI.rssDiscoverFeed(siteUrl),
};

export const scraperApi = {
  hasCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.scraperHasCheckpoint(stepId),
  clearCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.scraperClearCheckpoint(stepId),
  pickSelector: (args: ScraperPickRequest): Promise<ScraperPickResult | null> =>
    window.electronAPI.scraperPickSelector(args),
};

export const ytSubsApi = {
  hasCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.ytSubsHasCheckpoint(stepId),
  clearCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.ytSubsClearCheckpoint(stepId),
};

