import type { GeminiModelChoice, GeminiModelState } from '../../../shared/geminiModels';
import type { ClaudeModelChoice, ClaudeModelState } from '../../../shared/claudeModels';
import type { ChatgptModelChoice, ChatgptModelState } from '../../../shared/chatgptModels';
import type { McpFlowToolsRequest, McpFlowToolsResult } from '../../../shared/mcpFlowStep';
import type { MemoryEditResult, MemoryNote, BotSelfChange, UserMemorySnapshot } from '../../../shared/userMemory';
import type {
  BotApprovePairingRequest,
  BotApprovePairingResult,
  BotSetBlockedRequest,
  BotSetBlockedResult,
  BotSetDefaultGrantsRequest,
  BotSetDefaultGrantsResult,
  BotSetGroupPermissionsRequest,
  BotSetGroupPermissionsResult,
  BotSetPermissionsRequest,
  BotSetPermissionsResult,
} from '../../../shared/botPermissions';
import type {
  MemoryCurateApplyResult,
  MemoryCuratePick,
  MemoryCurateProposeRequest,
  MemoryCurateProposeResult,
} from '../../../shared/memoryCurate';
import type { WritingToolsProgress, WritingToolsRequest, WritingToolsResult } from '../../../shared/writingTools';
import type { ConversationMenuCommandEvent, ConversationMenuTarget } from '../../../shared/conversationMenu';
import type { DocAssistantProgress, DocAssistantRequest, DocAssistantResult } from '../../../shared/docAssistant';
import type {
  ConversationTranslateProgress, ConversationTranslateRequest, ConversationTranslateResult,
  TranslateProgress, TranslateRequest, TranslateResult, TurnTranslationRequest, TurnTranslationResult,
} from '../../../shared/translate';
import type { YtdlToolsState } from '../../../shared/ytdl';
import type { DownloadsKeep } from '../../../shared/downloads';
import type { TelegramLargeUploadInput, TelegramLargeUploadResult } from '../../../shared/telegramUpload';
import type { ConversationHistoryList, ConversationRestoreResult } from '../../../shared/conversationHistory';
import type { ConversationMovedEvent, ConversationMoveResult } from '../../../shared/conversationMove';
import type { ConversationFolder, FolderActionResult, FolderDeleteResult } from '../../../shared/conversationFolders';
import type { SidebarViewPrefs } from '../../../shared/sidebarView';
import type { LinkRecognitionState, LinkRecognitionTarget } from '../../../shared/linkRecognition';
import type {
  NotionBrowseResult,
  NotionDocStatus,
  NotionImportResult,
  NotionPullResult,
  NotionPushResult,
  NotionSearchResult,
} from '../../../shared/notion/notionSyncTypes';
import type { FlowSaveSource, FlowVersionList, FlowVersionRestoreResult } from '../../../shared/flowVersions';
import type {
  MarkdownExportResult,
  AccountStatus,
  SiteAccount,
  SiteAccountStatus,
  AgentConfirmChoice,
  AgentConfirmPayload,
  AttachmentStashRequest,
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
  ComposerEditorEventPayload,
  ExternalEditorSettings,
  FeedCandidate,
  ScraperPickRequest,
  ScraperPickResult,
  FlowDefinition,
  FlowExecutionEvent,
  FlowExecutionLog,
  FlowExecutionResult,
  FlowBuildOutcome,
  FlowBuildPayload,
  FlowBuildRequestPayload,
  HiddenSources,
  MarkdownCaptureRequest,
  BatchCaptureFormat,
  BatchCaptureItem,
  BatchCaptureProgress,
  BatchCaptureResult,
  ZipExportResult,
  ShareLinkRequest,
  ShareLinkResult,
  ShareSettings,
  MetricsSnapshot,
  NotifyEventPrefs,
  OutputFile,
  TrashedConversation,
  TrashResult,
  ResponseEditRequest,
  ResponseEditResult,
  StartedConversation,
  ConversationImportResult,
  StashedAttachment,
  PromptPreferences,
  ChatTurnEvent,
  PromptTriggerOptions,
  Provider,
  QueueState,
  AgentCommandResult,
  AgentRunState,
  AgentRunSummary,
  AgentTracePayload,
  SecretHealth,
  SecretTarget,
  SelectPathRequest,
  SelectPathResult,
  TempChatResult,
  BotProviderCommand,
  TelegramRuntimeSnapshot,
  TelegramSettingsSnapshot,
  LineSettingsSnapshot,
  LineChatListResult,
  LineRuntimeSnapshot,
  SocketBotActionResult,
  SocketBotPlatform,
  SocketBotRuntimeSnapshot,
  SocketBotSettingsSnapshot,
  LineCredentialsUpdate,
  EmailSettingsSnapshot,
  DataKeyStatus,
  MailAccountInput,
  MailAccountSaveResult,
  UpdateAvailablePayload,
  UpdateSource,
  UiNotificationPayload,
  HotkeyBindResult,
} from '../../../shared/types';
import type { BotAudienceSnapshot, BotPlatform, TrackpadGestureEvent } from '../../../shared/types';
import type { StepProgress } from '../../../shared/stepProgress';
import type { CalendarSaveRequest, CalendarSaveResult, CalendarSummary, CalendarTestRequest, CalendarTestResult } from '../../../shared/calendars';
import type { FlowMetricsSnapshot } from '../../../shared/flowMetrics';
import type { ConversationTokenStats } from '../../../shared/tokenEstimate';
import type { FeedPreviewRequest, FeedPreviewResult } from '../../../shared/feedPreview';
import type { PttBoardChoice, PttBoardPreviewRequest, PttBoardPreviewResult } from '../../../shared/pttBoard';

import type { ShortcutOverride } from '../../../shared/shortcuts';

/** A conversation's versions, named by its file and a version id. */
export const conversationHistoryApi = {
  list: (filePath: string): Promise<ConversationHistoryList> => window.electronAPI.listConversationVersions(filePath),
  get: (filePath: string, vid: string): Promise<string | null> => window.electronAPI.getConversationVersion(filePath, vid),
  restore: (filePath: string, vid: string): Promise<ConversationRestoreResult> =>
    window.electronAPI.restoreConversationVersion(filePath, vid),
  deleteVersion: (filePath: string, vid: string): Promise<boolean> =>
    window.electronAPI.deleteConversationVersion(filePath, vid),
  deleteAll: (filePath: string): Promise<boolean> => window.electronAPI.deleteConversationVersions(filePath),
  /** The screen's text, before another app's change replaces it; main decides whether it is kept. */
  keepBeforeReload: (filePath: string, previous: string): Promise<boolean> =>
    window.electronAPI.keepConversationBeforeReload(filePath, previous),
};

/**
 * Notion documents. A push names the changes by the ids `status` listed; main recomputes what they
 * are, so nothing the renderer holds is ever sent to Notion as text.
 */
export const notionApi = {
  connected: (): Promise<boolean> => window.electronAPI.notionConnected(),
  search: (query: string): Promise<NotionSearchResult> => window.electronAPI.notionSearch(query),
  /** Favorites and recently viewed pages; a cursor asks for more of the recent ones. */
  browse: (cursor: string | null = null): Promise<NotionBrowseResult> => window.electronAPI.notionBrowse(cursor),
  importPage: (input: string): Promise<NotionImportResult> => window.electronAPI.notionImport(input),
  status: (filePath: string): Promise<NotionDocStatus | null> => window.electronAPI.notionStatus(filePath),
  pull: (filePath: string): Promise<NotionPullResult> => window.electronAPI.notionPull(filePath),
  /** `title`: the H1 the preview showed, to send as the page title; null leaves the title alone. */
  push: (filePath: string, ids: string[], title: string | null): Promise<NotionPushResult> =>
    window.electronAPI.notionPush(filePath, ids, title),
  resolve: (filePath: string, key: string, choice: 'mine' | 'theirs'): Promise<boolean> =>
    window.electronAPI.notionResolve(filePath, key, choice),
  revert: (filePath: string, id: string): Promise<boolean> => window.electronAPI.notionRevert(filePath, id),
};

export const ytdlToolsApi = {
  get: (): Promise<YtdlToolsState> => window.electronAPI.ytdlToolsGet(),
  install: (): Promise<YtdlToolsState> => window.electronAPI.ytdlToolsInstall(),
  checkUpdate: (): Promise<YtdlToolsState> => window.electronAPI.ytdlToolsCheckUpdate(),
  remove: (): Promise<YtdlToolsState> => window.electronAPI.ytdlToolsRemove(),
  setCustom: (paths: { ytdlp: string; ffmpegDir: string } | null): Promise<YtdlToolsState> =>
    window.electronAPI.ytdlToolsSetCustom(paths),
  setNightly: (on: boolean): Promise<YtdlToolsState> => window.electronAPI.ytdlToolsSetNightly(on),
  onState: (cb: (state: YtdlToolsState) => void): (() => void) => window.electronAPI.onYtdlToolsState(cb),
  getDownloadsKeep: (): Promise<DownloadsKeep> => window.electronAPI.getDownloadsKeep(),
  setDownloadsKeep: (choice: DownloadsKeep): Promise<DownloadsKeep> => window.electronAPI.setDownloadsKeep(choice),
};

export const fileApi = {
  getList: (): Promise<OutputFile[]> => window.electronAPI.getFileList(),
  search: (query: string): Promise<OutputFile[]> => window.electronAPI.searchFileList(query),
  getContent: (filePath: string): Promise<string | null> => window.electronAPI.getFileContent(filePath),
  /** Moves conversations to Recently Deleted. */
  deleteFile: (filePath: string): Promise<TrashResult> => window.electronAPI.deleteFile(filePath),
  deleteFiles: (filePaths: string[]): Promise<TrashResult> => window.electronAPI.deleteFiles(filePaths),
  /** Only for the files `deleteFiles` could not move, after the user agreed. */
  deleteFilesPermanently: (filePaths: string[]): Promise<number> => window.electronAPI.deleteFilesPermanently(filePaths),
  /** Settings › Clear all history: every conversation and Recently Deleted, for good. */
  deleteAll: (): Promise<number> => window.electronAPI.deleteAllFiles(),
  updateH1: (filePath: string, title: string): Promise<boolean> => window.electronAPI.updateFileH1(filePath, title),
  /** Pins or unpins conversations; resolves to how many files main changed. */
  setPinned: (paths: string[], pinned: boolean): Promise<number> =>
    window.electronAPI.setConversationsPinned({ paths, pinned }),
  editTurnResponse: (request: ResponseEditRequest): Promise<ResponseEditResult> =>
    window.electronAPI.editTurnResponse(request),
  startConversation: (prompt: string): Promise<StartedConversation | null> =>
    window.electronAPI.startConversation(prompt),
  importConversations: (filePaths: string[]): Promise<ConversationImportResult> =>
    window.electronAPI.importConversations(filePaths),
  /** Hands the rows to the OS as a native file drag; call from `dragstart` after preventDefault. */
  startDrag: (filePaths: string[]): void => window.electronAPI.startFileDrag(filePaths),
  /**
   * Moves conversations to the outputs folder (`''`) or a folder directly in it. Each path gets its
   * own outcome; busy ones (a send, an Agent question waiting) are left where they are.
   */
  moveConversations: (filePaths: string[], folder: string): Promise<ConversationMoveResult> =>
    window.electronAPI.moveConversations(filePaths, folder),
  showInFolder: (filePath: string): Promise<void> => window.electronAPI.showInFolder(filePath),
  /** Saves the conversation as plain Markdown, without hidden markers, where the user picks. */
  exportMarkdown: (filePath: string): Promise<MarkdownExportResult> =>
    window.electronAPI.exportConversationMarkdown(filePath),
  openPath: (filePath: string): Promise<boolean> => window.electronAPI.openPath(filePath),
  /** The OS "Open with" chooser (Windows) or the default text editor (macOS). */
  openWith: (filePath: string): Promise<boolean> => window.electronAPI.openFileWith(filePath),
  /** Puts the files themselves on the clipboard, ready to paste into a folder or a chat app. */
  /** Resolves to how many of the files were put on the clipboard. */
  copyFiles: (filePaths: string[]): Promise<number> => window.electronAPI.copyFilesToClipboard(filePaths),
  /** The conversation files as they are on disk, in one archive the user saves. */
  exportZip: (filePaths: string[]): Promise<ZipExportResult> => window.electronAPI.exportFilesZip(filePaths),
  /** Renders each conversation as a PDF/PNG card into a folder the user picks. */
  batchCapture: (format: BatchCaptureFormat, items: BatchCaptureItem[]): Promise<BatchCaptureResult> =>
    window.electronAPI.batchCaptureStart(format, items),
  stopBatchCapture: (): Promise<boolean> => window.electronAPI.batchCaptureStop(),
  onBatchCaptureProgress: (cb: (progress: BatchCaptureProgress) => void): (() => void) =>
    window.electronAPI.onBatchCaptureProgress(cb),
};

/** Recently Deleted: addressed by trash id only, never by path. */
/** The macOS menu bar's Conversation menu: what is open goes up, a clicked command comes back. */
export const conversationMenuApi = {
  setTarget: (target: ConversationMenuTarget | null): Promise<boolean> => window.electronAPI.setConversationMenuTarget(target),
  onCommand: (cb: (event: ConversationMenuCommandEvent) => void) => window.electronAPI.onConversationMenuCommand(cb),
};

export const trashApi = {
  list: (): Promise<TrashedConversation[]> => window.electronAPI.listTrash(),
  /** Resolves to the restored paths. */
  restore: (trashIds: string[]): Promise<string[]> => window.electronAPI.restoreFromTrash(trashIds),
  /** Deletes for good; resolves to how many. */
  purge: (trashIds: string[] | 'all'): Promise<number> => window.electronAPI.purgeTrash(trashIds),
  onChanged: (cb: (count: number) => void): (() => void) => window.electronAPI.onTrashChanged(cb),
};

/** Conversation folders: real folders directly inside outputs, addressed by name. */
export const folderApi = {
  list: (): Promise<ConversationFolder[]> => window.electronAPI.listFolders(),
  create: (name: string): Promise<FolderActionResult> => window.electronAPI.createFolder(name),
  /** Makes a deleted folder again (the undo of deleting an empty one); system folders too. */
  recreate: (name: string): Promise<FolderActionResult> => window.electronAPI.createFolder(name, { restoring: true }),
  rename: (from: string, to: string): Promise<FolderActionResult> => window.electronAPI.renameFolder(from, to),
  /** Its conversations go to Recently Deleted (`trashIds` undoes it); the folder goes when nothing else is in it. */
  remove: (name: string): Promise<FolderDeleteResult> => window.electronAPI.deleteFolder(name),
  onChanged: (cb: (folders: ConversationFolder[]) => void): (() => void) => window.electronAPI.onFolderListChanged(cb),
};

export const sidebarViewApi = {
  get: (): Promise<SidebarViewPrefs> => window.electronAPI.getSidebarView(),
  update: (patch: Partial<SidebarViewPrefs>): Promise<SidebarViewPrefs> => window.electronAPI.updateSidebarView(patch),
};

export const settingsApi = {
  openLanguagesFolder: (): Promise<boolean> => window.electronAPI.openLanguagesFolder(),
  getHotkey: (): Promise<string> => window.electronAPI.getHotkey(),
  updateHotkey: (hotkey: string): Promise<HotkeyBindResult> => window.electronAPI.updateHotkey(hotkey),
  getRegionHotkey: (): Promise<string> => window.electronAPI.getRegionHotkey(),
  updateRegionHotkey: (hotkey: string): Promise<HotkeyBindResult> => window.electronAPI.updateRegionHotkey(hotkey),
  setHotkeyPaused: (paused: boolean): Promise<boolean> => window.electronAPI.setHotkeyPaused(paused),
  getShortcuts: (): Promise<Record<string, ShortcutOverride>> => window.electronAPI.getShortcuts(),
  updateShortcuts: (next: Record<string, ShortcutOverride>): Promise<Record<string, ShortcutOverride>> =>
    window.electronAPI.updateShortcuts(next),
  getAiUrl: (): Promise<string> => window.electronAPI.getAiUrl(),
  updateAiUrl: (url: string): Promise<boolean> => window.electronAPI.updateAiUrl(url),
  getHiddenSources: (): Promise<HiddenSources> => window.electronAPI.getHiddenSources(),
  updateHiddenSources: (next: HiddenSources): Promise<{ ok: boolean }> =>
    window.electronAPI.updateHiddenSources(next),
  getPromptPreferences: (): Promise<PromptPreferences> => window.electronAPI.getPromptPreferences(),
  updatePromptPreferences: (prefs: PromptPreferences): Promise<boolean> =>
    window.electronAPI.updatePromptPreferences(prefs),
  getYoutubePrompt: (): Promise<string> => window.electronAPI.getYoutubePrompt(),
  updateYoutubePrompt: (prompt: string): Promise<boolean> => window.electronAPI.updateYoutubePrompt(prompt),
  getSyncSystemLanguageToModel: (): Promise<boolean> => window.electronAPI.getSyncSystemLanguageToModel(),
  updateSyncSystemLanguageToModel: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateSyncSystemLanguageToModel(enabled),
  getOneShotTemporaryChat: (): Promise<boolean> => window.electronAPI.getOneShotTemporaryChat(),
  updateOneShotTemporaryChat: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateOneShotTemporaryChat(enabled),
  getProviderFallback: (): Promise<boolean> => window.electronAPI.getProviderFallback(),
  updateProviderFallback: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateProviderFallback(enabled),
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
  getLayoutMode: (): Promise<string> => window.electronAPI.getLayoutMode(),
  getShowTokenUsage: (): Promise<boolean> => window.electronAPI.getShowTokenUsage(),
  getLinkRecognition: (): Promise<LinkRecognitionState> => window.electronAPI.getLinkRecognition(),
  setLinkRecognition: (target: LinkRecognitionTarget, on: boolean): Promise<LinkRecognitionState> =>
    window.electronAPI.setLinkRecognition(target, on),
  onLinkRecognitionChanged: (cb: (state: LinkRecognitionState) => void) => window.electronAPI.onLinkRecognitionChanged(cb),
  getMarkdownZoom: (): Promise<number> => window.electronAPI.getMarkdownZoom(),
  getCaptureSettings: (): Promise<CaptureSettings> => window.electronAPI.getCaptureSettings(),
  updateCaptureSettings: (settings: CaptureSettings): Promise<boolean> => window.electronAPI.updateCaptureSettings(settings),
  getQuickExport: (): Promise<QuickExportSettings> => window.electronAPI.getQuickExport(),
  updateQuickExport: (settings: QuickExportSettings): Promise<HotkeyBindResult> => window.electronAPI.updateQuickExport(settings),
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

export const flowMetricsApi = {
  get: (): Promise<FlowMetricsSnapshot> => window.electronAPI.getFlowMetrics(),
};

export const telegramApi = {
  getSettings: (): Promise<TelegramSettingsSnapshot> => window.electronAPI.getTelegramSettings(),
  updateEnabled: (enabled: boolean): Promise<boolean> => window.electronAPI.updateTelegramEnabled(enabled),
  updateToken: (token: string) => window.electronAPI.updateTelegramBotToken(token),
  updateLargeUpload: (input: TelegramLargeUploadInput): Promise<TelegramLargeUploadResult> =>
    window.electronAPI.updateTelegramLargeUpload(input),
  clearLargeUpload: (): Promise<TelegramLargeUploadResult> => window.electronAPI.clearTelegramLargeUpload(),
  testLargeUpload: (input: TelegramLargeUploadInput): Promise<TelegramLargeUploadResult> =>
    window.electronAPI.testTelegramLargeUpload(input),
  updateAllowGroupCommands: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateTelegramAllowGroupCommands(enabled),
  updateDefaultReplyMode: (mode: 'markdown' | 'png' | 'webp' | 'pdf'): Promise<boolean> =>
    window.electronAPI.updateTelegramDefaultReplyMode(mode),
  updateCompactReply: (enabled: boolean): Promise<boolean> =>
    window.electronAPI.updateTelegramCompactReply(enabled),
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
  /** Replaces one paired Telegram / LINE account's grants. */
  setPermissions: (request: BotSetPermissionsRequest): Promise<BotSetPermissionsResult> =>
    window.electronAPI.setBotPermissions(request),
  /** Replaces what a platform's accounts are given when they pair with a code. */
  setDefaultGrants: (request: BotSetDefaultGrantsRequest): Promise<BotSetDefaultGrantsResult> =>
    window.electronAPI.setBotDefaultGrants(request),
  /** Replaces what one group grants everyone in it; `grants: null` puts it back on the default. */
  setGroupPermissions: (request: BotSetGroupPermissionsRequest): Promise<BotSetGroupPermissionsResult> =>
    window.electronAPI.setBotGroupPermissions(request),
  /** Blocks or unblocks one unpaired person. */
  setBlocked: (request: BotSetBlockedRequest): Promise<BotSetBlockedResult> =>
    window.electronAPI.setBotBlocked(request),
  /** Pairs, without a code, someone who asked in a private chat to use the bot. */
  approvePairingRequest: (request: BotApprovePairingRequest): Promise<BotApprovePairingResult> =>
    window.electronAPI.approveBotPairingRequest(request),
  /** The groups the bot is in and the unpaired people who used it, for one platform. */
  getAudience: (platform: BotPlatform): Promise<BotAudienceSnapshot> =>
    window.electronAPI.getBotAudience(platform),
};

export const lineApi = {
  getSettings: (): Promise<LineSettingsSnapshot> => window.electronAPI.getLineSettings(),
  listChats: (): Promise<LineChatListResult> => window.electronAPI.listLineChats(),
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

/** Discord and Slack: every call names its platform. */
export const socketBotApi = {
  getSettings: (platform: SocketBotPlatform): Promise<SocketBotSettingsSnapshot | null> =>
    window.electronAPI.getSocketBotSettings(platform),
  updateEnabled: (platform: SocketBotPlatform, enabled: boolean): Promise<SocketBotActionResult> =>
    window.electronAPI.updateSocketBotEnabled(platform, enabled),
  updateSecrets: (platform: SocketBotPlatform, secrets: Record<string, string>): Promise<SocketBotActionResult> =>
    window.electronAPI.updateSocketBotSecrets(platform, secrets),
  updateLlmDirect: (platform: SocketBotPlatform, config: BotLlmDirectConfig): Promise<SocketBotActionResult> =>
    window.electronAPI.updateSocketBotLlmDirect(platform, config),
  generatePairingCode: (platform: SocketBotPlatform): Promise<SocketBotActionResult> =>
    window.electronAPI.generateSocketBotPairingCode(platform),
  revokePairingCode: (platform: SocketBotPlatform, code: string): Promise<SocketBotActionResult> =>
    window.electronAPI.revokeSocketBotPairingCode(platform, code),
  unpairUser: (platform: SocketBotPlatform, userId: string): Promise<SocketBotActionResult> =>
    window.electronAPI.unpairSocketBotUser(platform, userId),
  reconnect: (platform: SocketBotPlatform): Promise<SocketBotActionResult> =>
    window.electronAPI.reconnectSocketBot(platform),
  onRuntime: (cb: (snapshot: SocketBotRuntimeSnapshot) => void) =>
    window.electronAPI.onSocketBotRuntime(cb),
};

export const dataKeyApi = {
  getStatus: (name: string): Promise<DataKeyStatus> => window.electronAPI.getDataKeyStatus(name),
  update: (name: string, value: string): Promise<{ ok: boolean }> => window.electronAPI.updateDataKey(name, value),
};

export const calendarApi = {
  list: (): Promise<CalendarSummary[]> => window.electronAPI.listCalendars(),
  save: (request: CalendarSaveRequest): Promise<CalendarSaveResult> => window.electronAPI.saveCalendar(request),
  remove: (id: string): Promise<CalendarSummary[]> => window.electronAPI.removeCalendar(id),
  test: (request: CalendarTestRequest): Promise<CalendarTestResult> => window.electronAPI.testCalendar(request),
};

export const emailApi = {
  getSettings: (): Promise<EmailSettingsSnapshot> => window.electronAPI.getEmailSettings(),
  saveAccount: (input: MailAccountInput): Promise<MailAccountSaveResult> => window.electronAPI.updateEmailCredentials(input),
  removeAccount: (id: string): Promise<EmailSettingsSnapshot> => window.electronAPI.removeMailAccount(id),
  setDefault: (id: string): Promise<EmailSettingsSnapshot> => window.electronAPI.setDefaultMailAccount(id),
  signInMicrosoft: (id?: string): Promise<MailAccountSaveResult> => window.electronAPI.signInMicrosoftMail(id),
  cancelMicrosoft: (): Promise<void> => window.electronAPI.cancelMicrosoftMail(),
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
  setBuiltin: (id: string, enabled: boolean): Promise<McpServerActionResult> =>
    window.electronAPI.setBuiltinConnectorEnabled(id, enabled),
  onServerStatus: (cb: (servers: McpServerView[]) => void): (() => void) => window.electronAPI.onMcpServerStatus(cb),
  /** One connector's tools for the flow editor's connector step. */
  flowTools: (req: McpFlowToolsRequest): Promise<McpFlowToolsResult> => window.electronAPI.getMcpFlowTools(req),
};

export const accountApi = {
  getStatuses: (): Promise<AccountStatus[]> => window.electronAPI.getAccountStatuses(),
  openLogin: (provider: AuthProvider): Promise<boolean> => window.electronAPI.openAccountLogin(provider),
  logout: (provider: AuthProvider): Promise<boolean> => window.electronAPI.logoutAccount(provider),
  clearData: (provider: Provider): Promise<boolean> => window.electronAPI.clearProviderData(provider),
  onStatusChanged: (cb: (status: AccountStatus) => void) => window.electronAPI.onAccountStatusChanged(cb),
};

export const siteAccountApi = {
  getStatuses: (): Promise<SiteAccountStatus[]> => window.electronAPI.getSiteAccountStatuses(),
  openLogin: (site: SiteAccount): Promise<boolean> => window.electronAPI.openSiteAccountLogin(site),
  logout: (site: SiteAccount): Promise<boolean> => window.electronAPI.logoutSiteAccount(site),
  onStatusChanged: (cb: (status: SiteAccountStatus) => void) => window.electronAPI.onSiteAccountStatusChanged(cb),
};

export const userMemoryApi = {
  get: (): Promise<UserMemorySnapshot> => window.electronAPI.getUserMemory(),
  setEnabled: (enabled: boolean): Promise<UserMemorySnapshot> => window.electronAPI.setUserMemoryEnabled(enabled),
  add: (text: string): Promise<MemoryEditResult> => window.electronAPI.addUserMemory(text),
  update: (id: string, text: string): Promise<MemoryEditResult> => window.electronAPI.updateUserMemory(id, text),
  remove: (id: string): Promise<MemoryEditResult> => window.electronAPI.deleteUserMemory(id),
  clear: (): Promise<UserMemorySnapshot> => window.electronAPI.clearUserMemory(),
  undo: (note: MemoryNote): Promise<{ ok: boolean; snapshot: UserMemorySnapshot }> => window.electronAPI.undoUserMemoryNote(note),
  setBotSelf: (change: BotSelfChange): Promise<UserMemorySnapshot> => window.electronAPI.setUserMemoryBotSelf(change),
  onChanged: (cb: (snapshot: UserMemorySnapshot) => void) => window.electronAPI.onUserMemoryChanged(cb),
  getCurateModel: (): Promise<string> => window.electronAPI.getMemoryCurateModel(),
  proposeCuration: (request: MemoryCurateProposeRequest): Promise<MemoryCurateProposeResult> =>
    window.electronAPI.proposeMemoryCuration(request),
  cancelCuration: (): Promise<boolean> => window.electronAPI.cancelMemoryCuration(),
  applyCuration: (proposalId: string, picks: MemoryCuratePick[]): Promise<MemoryCurateApplyResult> =>
    window.electronAPI.applyMemoryCuration(proposalId, picks),
  undoCuration: (): Promise<{ ok: boolean }> => window.electronAPI.undoMemoryCuration(),
};

export const writingToolsApi = {
  getModel: (): Promise<string> => window.electronAPI.getWritingToolsModel(),
  run: (request: WritingToolsRequest): Promise<WritingToolsResult> => window.electronAPI.runWritingTools(request),
  cancel: (id: string): Promise<boolean> => window.electronAPI.cancelWritingTools(id),
  onProgress: (cb: (progress: WritingToolsProgress) => void) => window.electronAPI.onWritingToolsProgress(cb),
};

export const docAssistantApi = {
  run: (request: DocAssistantRequest): Promise<DocAssistantResult> => window.electronAPI.runDocAssistant(request),
  cancel: (id: string): Promise<boolean> => window.electronAPI.cancelDocAssistant(id),
  onProgress: (cb: (progress: DocAssistantProgress) => void) => window.electronAPI.onDocAssistantProgress(cb),
};

export const translateApi = {
  run: (request: TranslateRequest): Promise<TranslateResult> => window.electronAPI.runTranslate(request),
  cancel: (id: string): Promise<boolean> => window.electronAPI.cancelTranslate(id),
  onProgress: (cb: (progress: TranslateProgress) => void) => window.electronAPI.onTranslateProgress(cb),
  translateConversation: (request: ConversationTranslateRequest): Promise<ConversationTranslateResult> =>
    window.electronAPI.translateConversation(request),
  cancelConversation: (id: string): Promise<boolean> => window.electronAPI.cancelTranslateConversation(id),
  onConversationProgress: (cb: (progress: ConversationTranslateProgress) => void) =>
    window.electronAPI.onTranslateConversationProgress(cb),
  setTurnTranslation: (request: TurnTranslationRequest): Promise<TurnTranslationResult> =>
    window.electronAPI.setTurnTranslation(request),
};

export const geminiModelApi = {
  get: (): Promise<GeminiModelState> => window.electronAPI.getGeminiModels(),
  set: (patch: Partial<GeminiModelChoice>): Promise<GeminiModelState> => window.electronAPI.setGeminiModel(patch),
  refresh: (): Promise<GeminiModelState> => window.electronAPI.refreshGeminiModels(),
  onChanged: (cb: (state: GeminiModelState) => void) => window.electronAPI.onGeminiModelsChanged(cb),
};

export const claudeModelApi = {
  get: (): Promise<ClaudeModelState> => window.electronAPI.getClaudeModels(),
  set: (patch: Partial<ClaudeModelChoice>): Promise<ClaudeModelState> => window.electronAPI.setClaudeModel(patch),
  refresh: (): Promise<ClaudeModelState> => window.electronAPI.refreshClaudeModels(),
  onChanged: (cb: (state: ClaudeModelState) => void) => window.electronAPI.onClaudeModelsChanged(cb),
};

export const chatgptModelApi = {
  get: (): Promise<ChatgptModelState> => window.electronAPI.getChatgptModels(),
  set: (patch: Partial<ChatgptModelChoice>): Promise<ChatgptModelState> => window.electronAPI.setChatgptModel(patch),
  refresh: (): Promise<ChatgptModelState> => window.electronAPI.refreshChatgptModels(),
  onChanged: (cb: (state: ChatgptModelState) => void) => window.electronAPI.onChatgptModelsChanged(cb),
};

export const secretApi = {
  getHealth: (): Promise<SecretHealth> => window.electronAPI.getSecretHealth(),
  deleteBroken: (target: SecretTarget): Promise<{ ok: boolean }> => window.electronAPI.deleteBrokenSecret(target),
  onChanged: (cb: (health: SecretHealth) => void) => window.electronAPI.onSecretHealthChanged(cb),
};

export const promptApi = {
  triggerWithOptions: (options: PromptTriggerOptions): Promise<string | null> =>
    window.electronAPI.triggerPromptWithOptions(options),
};

/** Ctrl+G in the composer: the draft in the user's own editor, saves coming back as they land. */
export const composerEditorApi = {
  /** Resolves to the session id, or null when no editor could be started. */
  open: (text: string): Promise<string | null> => window.electronAPI.openComposerEditor(text),
  /** Ends the session; resolves to text saved since the last event, or null. */
  finish: (id: string): Promise<string | null> => window.electronAPI.finishComposerEditor(id),
  onEvent: (cb: (event: ComposerEditorEventPayload) => void) => window.electronAPI.onComposerEditorEvent(cb),
  getSettings: (): Promise<ExternalEditorSettings> => window.electronAPI.getExternalEditorSettings(),
  setSettings: (update: { choice: string; command: string }): Promise<ExternalEditorSettings> =>
    window.electronAPI.setExternalEditorSettings(update),
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
  openSiteVerification: (site: string): void => window.electronAPI.openSiteVerification(site),
  openConfigDir: (): Promise<boolean> => window.electronAPI.openConfigDir(),
  openLogDir: (): Promise<boolean> => window.electronAPI.openLogDir(),
  selectPath: (request?: SelectPathRequest): Promise<SelectPathResult | null> =>
    window.electronAPI.selectPath(request),
  getPathForFile: (file: File): string => window.electronAPI.getPathForFile(file),
};

export const attachmentApi = {
  stashBytes: (request: AttachmentStashRequest): Promise<StashedAttachment> =>
    window.electronAPI.stashAttachmentBytes(request),
  fromClipboard: (): Promise<StashedAttachment | null> => window.electronAPI.attachmentFromClipboard(),
  /** The screen region the region hotkey boxed, once; null when there is none waiting. */
  takeRegionCapture: (): Promise<StashedAttachment | null> => window.electronAPI.takeRegionCapture(),
  onRegionCaptureReady: (cb: () => void): (() => void) => window.electronAPI.onRegionCaptureReady(cb),
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
  isMaximized: (): Promise<boolean> => window.electronAPI.isWindowMaximized(),
  onMaximizedChanged: (cb: (maximized: boolean) => void) => window.electronAPI.onWindowMaximizedChanged(cb),
  onTrackpadGesture: (cb: (event: TrackpadGestureEvent) => void) => window.electronAPI.onTrackpadGesture(cb),
  respondCloseDialog: (action: 'quit' | 'hide', remember: boolean): void =>
    window.electronAPI.respondCloseDialog(action, remember),
  respondAgentConfirm: (id: string, choice: AgentConfirmChoice): void =>
    window.electronAPI.respondAgentConfirm(id, choice),
};

export const ipcEvents = {
  onLog: (cb: (msg: string) => void) => window.electronAPI.onLog(cb),
  onStatus: (cb: (status: string) => void) => window.electronAPI.onStatus(cb),
  onQueueUpdate: (cb: (state: QueueState) => void) => window.electronAPI.onQueueUpdate(cb),
  onOutputFilesChanged: (cb: () => void) => window.electronAPI.onOutputFilesChanged(cb),
  onConversationMoved: (cb: (event: ConversationMovedEvent) => void) => window.electronAPI.onConversationMoved(cb),
  onChatTurn: (cb: (event: ChatTurnEvent) => void) => window.electronAPI.onChatTurn(cb),
  onUiNotification: (cb: (payload: UiNotificationPayload) => void) =>
    window.electronAPI.onUiNotification(cb),
  onNavigateSettings: (cb: (category?: string) => void) => window.electronAPI.onNavigateSettings(cb),
  onShowCloseDialog: (cb: () => void) => window.electronAPI.onShowCloseDialog(cb),
  onAgentConfirm: (cb: (payload: AgentConfirmPayload) => void) => window.electronAPI.onAgentConfirm(cb),
  onAgentConfirmDismiss: (cb: (id: string) => void) => window.electronAPI.onAgentConfirmDismiss(cb),
  onFlowCreated: (cb: (flow: FlowDefinition) => void) => window.electronAPI.onFlowCreated(cb),
  onFlowUpdated: (cb: (flow: FlowDefinition) => void) => window.electronAPI.onFlowUpdated(cb),
  onFlowRemoved: (cb: (flowId: string) => void) => window.electronAPI.onFlowRemoved(cb),
  onNotifyOnCompleteChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onNotifyOnCompleteChanged(cb),
  onLaunchAtStartupChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onLaunchAtStartupChanged(cb),
  onCloseToTrayChanged: (cb: (enabled: boolean) => void) =>
    window.electronAPI.onCloseToTrayChanged(cb),
  onMetricsChanged: (cb: (snapshot: MetricsSnapshot) => void) =>
    window.electronAPI.onMetricsChanged(cb),
  onFlowMetricsChanged: (cb: (snapshot: FlowMetricsSnapshot) => void) =>
    window.electronAPI.onFlowMetricsChanged(cb),
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
  /**
   * `import` tags the flow's first version as imported (the import dialog and the template wizard).
   * `reviewed` is the editor's own Save: only it lifts a chat-made flow's public-web-only mark.
   */
  save: (flow: FlowDefinition, source?: FlowSaveSource, reviewed?: boolean): Promise<FlowDefinition | null> =>
    reviewed ? window.electronAPI.saveFlow(flow, source, true) : window.electronAPI.saveFlow(flow, source),
  listVersions: (flowId: string): Promise<FlowVersionList> => window.electronAPI.listFlowVersions(flowId),
  restoreVersion: (flowId: string, vid: string): Promise<FlowVersionRestoreResult> =>
    window.electronAPI.restoreFlowVersion(flowId, vid),
  deleteVersion: (flowId: string, vid: string): Promise<boolean> => window.electronAPI.deleteFlowVersion(flowId, vid),
  clearVersions: (flowId: string): Promise<boolean> => window.electronAPI.clearFlowVersions(flowId),
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
  runChatCommand: (flowId: string, command: string, input: string, conversationPath?: string, progressId?: string, modelUrl?: string): Promise<ChatCommandResult> =>
    window.electronAPI.runChatCommand(flowId, command, input, conversationPath, progressId, modelUrl),
  onChatCommandProgress: (cb: (payload: { progressId: string; progress: StepProgress }) => void) =>
    window.electronAPI.onChatCommandProgress(cb),
  abort: (flowId: string): Promise<boolean> => window.electronAPI.abortFlow(flowId),
  build: (request: FlowBuildRequestPayload): Promise<FlowBuildOutcome> => window.electronAPI.generateFlow(request),
  onBuildProgress: (cb: (payload: FlowBuildPayload) => void): (() => void) =>
    window.electronAPI.onFlowBuildProgress(cb),
  getAiUrl: (): Promise<string> => window.electronAPI.getFlowAiUrl(),
  exportFlow: (flow: FlowDefinition): Promise<boolean> => window.electronAPI.exportFlow(flow),
  exportFlowResult: (content: string, defaultFileName: string): Promise<boolean> =>
    window.electronAPI.exportFlowResult(content, defaultFileName),
};


export const agentApi = {
  run: (goal: string, targetUrl: string, runId: string, conversationPath?: string, attachments?: string[], mcpServerIds?: string[], web?: boolean): Promise<AgentCommandResult> =>
    window.electronAPI.runAgentCommand(goal, targetUrl, runId, conversationPath, attachments, mcpServerIds, web),
  setConversationConnectors: (filePath: string, serverIds: string[], web?: boolean, agent?: boolean): Promise<boolean> =>
    window.electronAPI.setConversationConnectors(filePath, serverIds, web, agent),
  resume: (runId: string, answer?: string): Promise<AgentCommandResult> =>
    window.electronAPI.resumeAgentRun(runId, answer),
  cancel: (runId: string): Promise<boolean> => window.electronAPI.cancelAgentRun(runId),
  listResumable: (): Promise<AgentRunSummary[]> => window.electronAPI.listResumableAgentRuns(),
  getRun: (runId: string): Promise<AgentRunState | null> => window.electronAPI.getAgentRun(runId),
  discard: (runId: string): Promise<boolean> => window.electronAPI.discardAgentRun(runId),
  onTrace: (cb: (payload: AgentTracePayload) => void): (() => void) => window.electronAPI.onAgentTrace(cb),
};

export const rssApi = {
  hasCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.rssHasCheckpoint(stepId),
  clearCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.rssClearCheckpoint(stepId),
  discoverFeed: (siteUrl: string): Promise<FeedCandidate[]> => window.electronAPI.rssDiscoverFeed(siteUrl),
  previewFeed: (request: FeedPreviewRequest): Promise<FeedPreviewResult> => window.electronAPI.rssPreviewFeed(request),
  cancelPreview: (slot: string): Promise<boolean> => window.electronAPI.rssCancelPreview(slot),
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

export const xPostsApi = {
  hasCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.xPostsHasCheckpoint(stepId),
  clearCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.xPostsClearCheckpoint(stepId),
};

export const pttBoardApi = {
  hasCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.pttBoardHasCheckpoint(stepId),
  clearCheckpoint: (stepId: string): Promise<boolean> => window.electronAPI.pttBoardClearCheckpoint(stepId),
  findBoards: (query: string): Promise<PttBoardChoice[]> => window.electronAPI.pttFindBoards(query),
  preview: (request: PttBoardPreviewRequest): Promise<PttBoardPreviewResult> => window.electronAPI.pttPreviewBoard(request),
  cancelPreview: (slot: string): Promise<boolean> => window.electronAPI.pttCancelPreview(slot),
};

