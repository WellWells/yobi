import { create } from 'zustand';
import { AUTH_PROVIDERS } from '../../../shared/types';
import type { AccountStatus, AuthProvider, HiddenSources, OutputFile, Provider, QueueState, ReadingZoomCommand } from '../../../shared/types';
import type { GeminiModelState } from '../../../shared/geminiModels';
import type { ClaudeModelState } from '../../../shared/claudeModels';
import type { ChatgptModelState } from '../../../shared/chatgptModels';
import type { StepProgress } from '../../../shared/stepProgress';
import { parseMarkdownBlocks, conversationAliases } from '../utils/parseMarkdownBlocks';
import type { MarkdownBlocks } from '../utils/parseMarkdownBlocks';
import { parseConversationDoc } from '../../../shared/conversationDoc';
import { rememberLastActivity } from '../utils/lastActivity';
import { notionConversation } from '../../../shared/notion/notionDoc';
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
  /** When it was sent; a run's view older than this belongs to an earlier attempt. */
  beganAt?: number;
  attachments?: string[];
  /** Where each of them is, so the bubble shows the pictures from the moment it is sent. */
  attachmentFiles?: string[];
  /** A flow command: no model is thinking, so the bubble says it is running. */
  command?: boolean;
  /** Where a step of that flow is, as it last reported (a download's percentage). */
  progress?: StepProgress;
  /** A `!` command: its output as it runs, then the model reading it. */
  shell?: PendingShell;
}

export interface PendingShell {
  command: string;
  /** The latest lines while it runs. */
  output: string;
  running: boolean;
  /** Known once main has picked them. */
  shellLabel?: string;
  folder?: string;
  exitCode?: number | null;
  stopped?: boolean;
}

export type View = 'chat' | 'settings' | 'about' | 'logs' | 'flow';

export const NAV_ORDER: View[] = ['chat', 'flow', 'logs', 'settings', 'about'];

/** The two views with a sidebar, switched between at its top; Settings, Logs and About open from its foot. */
export type MainView = 'chat' | 'flow';

export function isMainView(view: View): view is MainView {
  return view === 'chat' || view === 'flow';
}

/**
 * The view on screen: Settings (with its Logs and About pages) is a dialog over the chat or flow
 * view it was opened from, which stays drawn behind it.
 */
export function drawnView(state: { currentView: View; lastMainView: MainView }): MainView {
  return isMainView(state.currentView) ? state.currentView : state.lastMainView;
}

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
  /** The chat or flow view last shown: where Settings' back button returns. */
  lastMainView: MainView;
  /** One-shot: a level filter another view asked the log panel to open with. */
  logLevelRequest: LogLevel[] | null;
  /** One-shot: the settings category another view asked Settings to open on. */
  settingsCategoryRequest: string | null;

  layoutMode: LayoutMode;
  markdownZoom: number;
  showTokenUsage: boolean;
  /** The recap icon above the composer. */
  showRecap: boolean;

  hotkey: string;
  /** The screen-region hotkey; empty = off. */
  regionHotkey: string;
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
  setPendingTurnProgress: (sendId: string, progress: StepProgress) => void;
  updatePendingShell: (sendId: string, patch: Partial<PendingShell>) => void;
  setTempChatMode: (enabled: boolean) => void;
  setTempChatResult: (content: string) => void;
  setView: (view: View) => void;
  /** Closes the Settings dialog (with its Logs and About pages) back to the view behind it. */
  closeSettings: () => void;
  openLogsFiltered: (levels: LogLevel[]) => void;
  clearLogLevelRequest: () => void;
  openSettingsCategory: (category: string) => void;
  clearSettingsCategoryRequest: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
  zoomInMarkdown: () => void;
  zoomOutMarkdown: () => void;
  resetMarkdownZoom: () => void;
  /** The macOS View menu's reading-size items, sent over from main. */
  applyReadingZoomCommand: (command: ReadingZoomCommand) => void;
  setShowTokenUsage: (show: boolean) => void;
  setShowRecap: (show: boolean) => void;
  setHotkey: (hotkey: string) => void;
  setRegionHotkey: (hotkey: string) => void;
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

export const useAppStore = create<AppState>((set, get) => ({
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
  lastMainView: 'chat',
  logLevelRequest: null,
  settingsCategoryRequest: null,
  // Empty until bootstrap reads it: empty also means "off", so nothing advertises a combo early.
  hotkey: '',
  regionHotkey: '',
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
  showRecap: true,

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
  setFiles: (files, options) => {
    rememberLastActivity(files);
    set((state) => {
      const existingPaths = new Set(state.files.map((file) => file.path));
      const incomingPaths = new Set(files.map((file) => file.path));
      const nextUnread: Record<string, true> = {};

      for (const filePath of Object.keys(state.unreadFilePaths)) {
        if (incomingPaths.has(filePath)) nextUnread[filePath] = true;
      }

      if (options?.markUnread) {
        for (const file of files) {
          const isNewPath = !existingPaths.has(file.path);
          // A bot chat's file carries its chat ahead of the stamp (`tg-Alice-2026-…`).
          const isGeneratedOutput = /(?:^|-)\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/i.test(file.name);
          if (isNewPath && isGeneratedOutput && file.path !== state.selectedFile?.path) {
            nextUnread[file.path] = true;
          }
        }
      }

      // A selected file no longer listed was deleted (e.g. the placeholder main unlinks when a first turn
      // fails); drop it so rename, share and show-in-folder don't target a missing path.
      const selectionGone = Boolean(state.selectedFile) && !incomingPaths.has(state.selectedFile!.path);
      const cleared = selectionGone
        ? { selectedFile: null, fileContent: null, parsedBlocks: null, conversation: null }
        : {};

      return { files, unreadFilePaths: nextUnread, ...cleared };
    });
  },
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
    conversation: fileContent !== null
      ? notionConversation(fileContent) ?? parseConversationDoc(fileContent, conversationAliases())
      : null,
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
  setPendingTurnProgress: (sendId, progress) => set((state) => {
    let changed = false;
    const pendingTurns: Record<string, PendingTurn[]> = {};
    for (const [key, turns] of Object.entries(state.pendingTurns)) {
      pendingTurns[key] = turns.map((turn) => {
        if (turn.sendId !== sendId) return turn;
        changed = true;
        return { ...turn, progress };
      });
    }
    return changed ? { pendingTurns } : state;
  }),
  updatePendingShell: (sendId, patch) => set((state) => {
    let changed = false;
    const pendingTurns: Record<string, PendingTurn[]> = {};
    for (const [key, turns] of Object.entries(state.pendingTurns)) {
      pendingTurns[key] = turns.map((turn) => {
        if (turn.sendId !== sendId || !turn.shell) return turn;
        changed = true;
        return { ...turn, shell: { ...turn.shell, ...patch } };
      });
    }
    return changed ? { pendingTurns } : state;
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
  setView: (currentView) => set((state) => ({
    currentView,
    lastMainView: isMainView(currentView) ? currentView : state.lastMainView,
  })),
  closeSettings: () => set((state) => ({ currentView: state.lastMainView })),
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
  applyReadingZoomCommand: (command) => {
    const store = get();
    if (command === 'in') return store.zoomInMarkdown();
    if (command === 'out') return store.zoomOutMarkdown();
    if (command === 'reset') store.resetMarkdownZoom();
  },
  setShowTokenUsage: (showTokenUsage) => {
    window.electronAPI.updateShowTokenUsage(showTokenUsage).catch(() => {});
    set({ showTokenUsage });
  },
  setShowRecap: (showRecap) => {
    window.electronAPI.updateShowRecap(showRecap).catch(() => {});
    set({ showRecap });
  },
  setHotkey: (hotkey) => set({ hotkey }),
  setRegionHotkey: (regionHotkey) => set({ regionHotkey }),
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
