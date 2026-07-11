import { create } from 'zustand';
import { AUTH_PROVIDERS } from '../../../shared/types';
import type { AccountStatus, AuthProvider, HiddenSources, OutputFile, Provider, QueueState } from '../../../shared/types';
import { parseMarkdownBlocks } from '../utils/parseMarkdownBlocks';
import type { MarkdownBlocks } from '../utils/parseMarkdownBlocks';
import { DEFAULT_MODEL_URL } from '../config/models';
import type { ModelOption } from '../config/models';

// The store keeps the four hidden lists flat; every consumer wants them as one
// HiddenSources object. Pair with useShallow, or call on a getState() snapshot.
export function selectHiddenSources(s: {
  hiddenProviders: Provider[];
  hiddenDuckaiModelIds: string[];
  hiddenByokIds: string[];
  hiddenByokGroupIds: string[];
}): HiddenSources {
  return {
    providers: s.hiddenProviders,
    duckaiModelIds: s.hiddenDuckaiModelIds,
    byokIds: s.hiddenByokIds,
    byokGroupIds: s.hiddenByokGroupIds,
  };
}

export type View = 'chat' | 'settings' | 'about' | 'logs' | 'agentflow';

export const NAV_ORDER: View[] = ['chat', 'agentflow', 'logs', 'settings', 'about'];

export type LayoutMode = 'stacked' | 'side-by-side';
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

// null = not checked yet. Consumers must treat it as "assume usable" rather than
// "logged out", so a slow first check never blocks a model the user is entitled to.
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
  unreadFilePaths: Record<string, true>;

  // Temporary chat mode: session-only, replies live in memory and vanish when
  // the mode is exited.
  tempChatMode: boolean;
  tempChatContent: string | null;
  tempChatBlocks: MarkdownBlocks | null;

  currentView: View;

  layoutMode: LayoutMode;
  markdownZoom: number;

  hotkey: string;
  userNickname: string;
  aiUrl: string;
  duckaiModels: ModelOption[];
  byokModels: ModelOption[];
  byokGroupModels: ModelOption[];
  byokModelsLoaded: boolean;
  hiddenProviders: Provider[];
  hiddenDuckaiModelIds: string[];
  hiddenByokIds: string[];
  hiddenByokGroupIds: string[];
  // Gates ChatView's auto-reselect: before the first fetch lands, "nothing is
  // hidden" and "not fetched yet" are both an empty array.
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
  setTempChatMode: (enabled: boolean) => void;
  setTempChatResult: (content: string) => void;
  setView: (view: View) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  zoomInMarkdown: () => void;
  zoomOutMarkdown: () => void;
  resetMarkdownZoom: () => void;
  setHotkey: (hotkey: string) => void;
  setUserNickname: (nickname: string) => void;
  setAiUrl: (url: string) => void;
  setDuckaiModels: (models: ModelOption[]) => void;
  setByokModels: (models: ModelOption[]) => void;
  setByokGroupModels: (models: ModelOption[]) => void;
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
  unreadFilePaths: {},
  tempChatMode: false,
  tempChatContent: null,
  tempChatBlocks: null,
  currentView: 'chat',
  hotkey: 'Alt+G',
  userNickname: '',
  aiUrl: DEFAULT_MODEL_URL,
  duckaiModels: [],
  byokModels: [],
  byokGroupModels: [],
  byokModelsLoaded: false,
  hiddenProviders: [],
  hiddenDuckaiModelIds: [],
  hiddenByokIds: [],
  hiddenByokGroupIds: [],
  hiddenSourcesLoaded: false,
  layoutMode: 'stacked',
  markdownZoom: 100,


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
      if (state.logs.length < 500) {
        return { logs: [...state.logs, msg] };
      }
      const logs = state.logs.slice(-499);
      logs.push(msg);
      return { logs };
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

    return { files, unreadFilePaths: nextUnread };
  }),
  selectFile: (selectedFile) => set((state) => {
    if (!selectedFile?.path || !state.unreadFilePaths[selectedFile.path]) {
      return { selectedFile, fileContent: null, parsedBlocks: null };
    }
    const nextUnread = { ...state.unreadFilePaths };
    delete nextUnread[selectedFile.path];
    return { selectedFile, fileContent: null, parsedBlocks: null, unreadFilePaths: nextUnread };
  }),
  setFileContent: (fileContent) => set({
    fileContent,
    parsedBlocks: fileContent !== null ? parseMarkdownBlocks(fileContent) : null,
  }),
  // Leaving the mode drops the in-memory reply — no local trace remains.
  setTempChatMode: (tempChatMode) => set(tempChatMode
    ? { tempChatMode }
    : { tempChatMode, tempChatContent: null, tempChatBlocks: null }),
  // Deselect any open file so the fresh temporary reply is what the user sees.
  setTempChatResult: (content) => set({
    tempChatContent: content,
    tempChatBlocks: parseMarkdownBlocks(content),
    selectedFile: null,
    fileContent: null,
    parsedBlocks: null,
  }),
  setView: (currentView) => set({ currentView }),
  setLayoutMode: (layoutMode) => {
    window.electronAPI.updateLayoutMode(layoutMode).catch(() => {});
    set({ layoutMode });
  },
  zoomInMarkdown: () => set((state) => createMarkdownZoomUpdate(state.markdownZoom + MD_ZOOM_STEP)),
  zoomOutMarkdown: () => set((state) => createMarkdownZoomUpdate(state.markdownZoom - MD_ZOOM_STEP)),
  resetMarkdownZoom: () => set(createMarkdownZoomUpdate(100)),
  setHotkey: (hotkey) => set({ hotkey }),
  setUserNickname: (userNickname) => set({ userNickname }),
  setAiUrl: (aiUrl) => set({ aiUrl }),
  setDuckaiModels: (duckaiModels) => set({ duckaiModels }),
  setByokModels: (byokModels) => set({ byokModels, byokModelsLoaded: true }),
  setByokGroupModels: (byokGroupModels) => set({ byokGroupModels }),
  setHiddenSources: (next) => set({
    hiddenProviders: next.providers,
    hiddenDuckaiModelIds: next.duckaiModelIds,
    hiddenByokIds: next.byokIds,
    hiddenByokGroupIds: next.byokGroupIds,
    hiddenSourcesLoaded: true,
  }),
}));
