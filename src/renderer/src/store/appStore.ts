import { create } from 'zustand';
import { AUTH_PROVIDERS } from '../../../shared/types';
import type { AccountStatus, AuthProvider, HiddenSources, OutputFile, Provider, QueueState } from '../../../shared/types';
import type { GeminiModelState } from '../../../shared/geminiModels';
import type { ClaudeModelState } from '../../../shared/claudeModels';
import type { ChatgptModelState } from '../../../shared/chatgptModels';
import { parseMarkdownBlocks, conversationAliases } from '../utils/parseMarkdownBlocks';
import type { MarkdownBlocks } from '../utils/parseMarkdownBlocks';
import { parseConversationDoc } from '../../../shared/conversationDoc';
import type { ConversationDoc } from '../../../shared/conversationDoc';
import { DEFAULT_MODEL_URL } from '../config/models';
import type { ModelOption } from '../config/models';
import type { LogLevel } from '../components/logFormat';

export function selectHiddenSources(s: {
  hiddenProviders: Provider[];
  hiddenByokIds: string[];
  hiddenByokGroupIds: string[];
}): HiddenSources {
  return {
    providers: s.hiddenProviders,
    byokIds: s.hiddenByokIds,
    byokGroupIds: s.hiddenByokGroupIds,
  };
}

export const NEW_CONVERSATION_KEY = '';

export interface PendingTurn {
  sendId: string;
  prompt: string;
  runId?: string;
  attachments?: string[];
}

export type View = 'chat' | 'settings' | 'about' | 'logs' | 'flow';

export const NAV_ORDER: View[] = ['chat', 'flow', 'logs', 'settings', 'about'];

export type LayoutMode = 'stacked' | 'side-by-side';

export const LOG_BUFFER_CAP = 5_000;
const LOG_BUFFER_TRIM = Math.floor(LOG_BUFFER_CAP * 0.1);

type FileUpdateOptions = { markUnread?: boolean };
const MD_ZOOM_STEP = 10;
const MD_ZOOM_MIN = 70;
const MD_ZOOM_MAX = 200;

function normalizeMarkdownZoom(value: number): number {
  if (!Number.isFinite(value)) return 100;
  const rounded = Math.round(value / MD_ZOOM_STEP) * MD_ZOOM_STEP;
  return Math.min(MD_ZOOM_MAX, Math.max(MD_ZOOM_MIN, rounded));
}

function createMarkdownZoomUpdate(nextZoom: number): { markdownZoom: number } {
  const markdownZoom = normalizeMarkdownZoom(nextZoom);
  window.electronAPI.updateMarkdownZoom(markdownZoom).catch(() => {});
  return { markdownZoom };
}

export type AccountStatusMap = Record<AuthProvider, boolean | null>;

function initAccountStatuses(): AccountStatusMap {
  return AUTH_PROVIDERS.reduce((acc, provider) => {
    acc[provider] = null;
    return acc;
  }, {} as AccountStatusMap);
}

interface AppState {
  status: 'idle' | 'processing';
  queue: QueueState;
  accountStatuses: AccountStatusMap;
  logs: string[];

  files: OutputFile[];
  selectedFile: OutputFile | null;
  fileContent: string | null;
  parsedBlocks: MarkdownBlocks | null;
  conversation: ConversationDoc | null;
  pendingTurns: Record<string, PendingTurn[]>;
  unreadFilePaths: Record<string, true>;

  tempChatMode: boolean;
  tempChatContent: string | null;
  tempChatBlocks: MarkdownBlocks | null;
  tempChatConversation: ConversationDoc | null;

  currentView: View;
  /** One-shot: a level filter another view asked the log panel to open with. */
  logLevelRequest: LogLevel[] | null;
  /** One-shot: the settings category another view asked Settings to open on. */
  settingsCategoryRequest: string | null;

  layoutMode: LayoutMode;
  markdownZoom: number;
  showTokenUsage: boolean;

  hotkey: string;
  hotkeyEnabled: boolean;
  userNickname: string;
  aiUrl: string;
  aiUrlLoaded: boolean;
  byokModels: ModelOption[];
  byokGroupModels: ModelOption[];
  byokModelsLoaded: boolean;
  /** Gemini's cached model list and the one Gemini setting; `null` until main answers. */
  geminiModels: GeminiModelState | null;
  /** The models this Claude account can select, and the one Claude setting; `null` until main answers. */
  claudeModels: ClaudeModelState | null;
  /** What this ChatGPT account offers (models and effort steps, or the thinking toggle) and the one ChatGPT setting. */
  chatgptModels: ChatgptModelState | null;
  hiddenProviders: Provider[];
  hiddenByokIds: string[];
  hiddenByokGroupIds: string[];
  hiddenSourcesLoaded: boolean;

  setStatus: (status: 'idle' | 'processing') => void;
  setQueue: (q: QueueState) => void;
  setAccountStatuses: (list: AccountStatus[]) => void;
  setAccountStatus: (status: AccountStatus) => void;
  appendLog: (msg: string) => void;
  clearLogs: () => void;
  setFiles: (files: OutputFile[], options?: FileUpdateOptions) => void;
  selectFile: (file: OutputFile | null) => void;
  setFileContent: (content: string | null) => void;
  addPendingTurn: (conversationPath: string, turn: PendingTurn) => void;
  clearPendingTurn: (sendId: string) => void;
  setTempChatMode: (enabled: boolean) => void;
  setTempChatResult: (content: string) => void;
  setView: (view: View) => void;
  openLogsFiltered: (levels: LogLevel[]) => void;
  clearLogLevelRequest: () => void;
  openSettingsCategory: (category: string) => void;
  clearSettingsCategoryRequest: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
  zoomInMarkdown: () => void;
  zoomOutMarkdown: () => void;
  resetMarkdownZoom: () => void;
  setShowTokenUsage: (show: boolean) => void;
  setHotkey: (hotkey: string) => void;
  setHotkeyEnabled: (enabled: boolean) => void;
  setUserNickname: (nickname: string) => void;
  setAiUrl: (url: string) => void;
  hydrateAiUrl: (url: string) => void;
  setByokModels: (models: ModelOption[]) => void;
  setByokGroupModels: (models: ModelOption[]) => void;
  setGeminiModels: (state: GeminiModelState) => void;
  setClaudeModels: (state: ClaudeModelState) => void;
  setChatgptModels: (state: ChatgptModelState) => void;
  setHiddenSources: (next: HiddenSources) => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  queue: { total: 0, current: 0, status: 'idle', items: [] },
  accountStatuses: initAccountStatuses(),
  logs: [],
  files: [],
  selectedFile: null,
  fileContent: null,
  parsedBlocks: null,
  conversation: null,
  pendingTurns: {},
  unreadFilePaths: {},
  tempChatMode: false,
  tempChatContent: null,
  tempChatBlocks: null,
  tempChatConversation: null,
  currentView: 'chat',
  logLevelRequest: null,
  settingsCategoryRequest: null,
  hotkey: 'Alt+G',
  hotkeyEnabled: true,
  userNickname: '',
  aiUrl: DEFAULT_MODEL_URL,
  aiUrlLoaded: false,
  byokModels: [],
  byokGroupModels: [],
  byokModelsLoaded: false,
  geminiModels: null,
  claudeModels: null,
  chatgptModels: null,
  hiddenProviders: [],
  hiddenByokIds: [],
  hiddenByokGroupIds: [],
  hiddenSourcesLoaded: false,
  layoutMode: 'stacked',
  markdownZoom: 100,
  showTokenUsage: true,

  setStatus: (status) => set({ status }),
  setQueue: (queue) => set({ queue }),
  setAccountStatuses: (list) =>
    set((state) => {
      const accountStatuses = { ...state.accountStatuses };
      for (const status of list) accountStatuses[status.provider] = status.loggedIn;
      return { accountStatuses };
    }),
  setAccountStatus: (status) =>
    set((state) => ({
      accountStatuses: { ...state.accountStatuses, [status.provider]: status.loggedIn },
    })),
  appendLog: (msg) =>
    set((state) => {
      const logs = [...state.logs, msg];
      if (logs.length <= LOG_BUFFER_CAP) return { logs };
      return { logs: logs.slice(LOG_BUFFER_TRIM) };
    }),
  clearLogs: () => set({ logs: [] }),
  setFiles: (files, options) => set((state) => {
    const existingPaths = new Set(state.files.map((file) => file.path));
    const incomingPaths = new Set(files.map((file) => file.path));
    const nextUnread: Record<string, true> = {};

    for (const filePath of Object.keys(state.unreadFilePaths)) {
      if (incomingPaths.has(filePath)) nextUnread[filePath] = true;
    }

    if (options?.markUnread) {
      for (const file of files) {
        const isNewPath = !existingPaths.has(file.path);
        const isGeneratedOutput = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/i.test(file.name);
        if (isNewPath && isGeneratedOutput && file.path !== state.selectedFile?.path) {
          nextUnread[file.path] = true;
        }
      }
    }

    // A selected file that is no longer listed has been deleted under us — most often the
    // placeholder the main process unlinks when a new conversation's first turn fails. Holding
    // on to it leaves the header pointing at a path with nothing behind it, so rename, share
    // and show-in-folder all fail silently.
    const selectionGone = Boolean(state.selectedFile) && !incomingPaths.has(state.selectedFile!.path);
    const cleared = selectionGone
      ? { selectedFile: null, fileContent: null, parsedBlocks: null, conversation: null }
      : {};

    return { files, unreadFilePaths: nextUnread, ...cleared };
  }),
  selectFile: (selectedFile) => set((state) => {
    const samePath = Boolean(selectedFile?.path) && selectedFile?.path === state.selectedFile?.path;
    const content = samePath
      ? { fileContent: state.fileContent, parsedBlocks: state.parsedBlocks, conversation: state.conversation }
      : { fileContent: null, parsedBlocks: null, conversation: null };
    if (!selectedFile?.path || !state.unreadFilePaths[selectedFile.path]) {
      return { selectedFile, ...content };
    }
    const nextUnread = { ...state.unreadFilePaths };
    delete nextUnread[selectedFile.path];
    return { selectedFile, ...content, unreadFilePaths: nextUnread };
  }),
  setFileContent: (fileContent) => set({
    fileContent,
    parsedBlocks: fileContent !== null ? parseMarkdownBlocks(fileContent) : null,
    conversation: fileContent !== null ? parseConversationDoc(fileContent, conversationAliases()) : null,
  }),
  addPendingTurn: (conversationPath, turn) => set((state) => ({
    pendingTurns: {
      ...state.pendingTurns,
      [conversationPath]: [...(state.pendingTurns[conversationPath] ?? []), turn],
    },
  })),
  clearPendingTurn: (sendId) => set((state) => {
    const pendingTurns: Record<string, PendingTurn[]> = {};
    for (const [key, turns] of Object.entries(state.pendingTurns)) {
      const remaining = turns.filter((turn) => turn.sendId !== sendId);
      if (remaining.length > 0) pendingTurns[key] = remaining;
    }
    return { pendingTurns };
  }),
  setTempChatMode: (tempChatMode) => set(tempChatMode
    ? { tempChatMode }
    : { tempChatMode, tempChatContent: null, tempChatBlocks: null, tempChatConversation: null }),
  setTempChatResult: (content) => set({
    tempChatContent: content,
    tempChatBlocks: parseMarkdownBlocks(content),
    tempChatConversation: parseConversationDoc(content, conversationAliases()),
    selectedFile: null,
    fileContent: null,
    parsedBlocks: null,
    conversation: null,
  }),
  setView: (currentView) => set({ currentView }),
  openLogsFiltered: (logLevelRequest) => set({ currentView: 'logs', logLevelRequest }),
  clearLogLevelRequest: () => set({ logLevelRequest: null }),
  openSettingsCategory: (settingsCategoryRequest) => set({ currentView: 'settings', settingsCategoryRequest }),
  clearSettingsCategoryRequest: () => set({ settingsCategoryRequest: null }),
  setLayoutMode: (layoutMode) => {
    window.electronAPI.updateLayoutMode(layoutMode).catch(() => {});
    set({ layoutMode });
  },
  zoomInMarkdown: () => set((state) => createMarkdownZoomUpdate(state.markdownZoom + MD_ZOOM_STEP)),
  zoomOutMarkdown: () => set((state) => createMarkdownZoomUpdate(state.markdownZoom - MD_ZOOM_STEP)),
  resetMarkdownZoom: () => set(createMarkdownZoomUpdate(100)),
  setShowTokenUsage: (showTokenUsage) => {
    window.electronAPI.updateShowTokenUsage(showTokenUsage).catch(() => {});
    set({ showTokenUsage });
  },
  setHotkey: (hotkey) => set({ hotkey }),
  setHotkeyEnabled: (hotkeyEnabled) => set({ hotkeyEnabled }),
  setUserNickname: (userNickname) => set({ userNickname }),
  setAiUrl: (aiUrl) => set({ aiUrl, aiUrlLoaded: true }),
  hydrateAiUrl: (aiUrl) => set((s) => (s.aiUrlLoaded ? s : { aiUrl, aiUrlLoaded: true })),
  setByokModels: (byokModels) => set({ byokModels, byokModelsLoaded: true }),
  setByokGroupModels: (byokGroupModels) => set({ byokGroupModels }),
  setGeminiModels: (geminiModels) => set({ geminiModels }),
  setClaudeModels: (claudeModels) => set({ claudeModels }),
  setChatgptModels: (chatgptModels) => set({ chatgptModels }),
  setHiddenSources: (next) => set({
    hiddenProviders: next.providers,
    hiddenByokIds: next.byokIds,
    hiddenByokGroupIds: next.byokGroupIds,
    hiddenSourcesLoaded: true,
  }),
}));
