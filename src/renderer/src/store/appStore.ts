import { create } from 'zustand';
import type { OutputFile, QueueState, WorkerAttention } from '../../../shared/types';
import { parseMarkdownBlocks } from '../utils/parseMarkdownBlocks';
import type { MarkdownBlocks } from '../utils/parseMarkdownBlocks';
import { DEFAULT_MODEL_URL } from '../config/models';
import type { ModelOption } from '../config/models';

export type View = 'chat' | 'settings' | 'about' | 'logs' | 'agentflow';
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

interface AppState {
  status: 'idle' | 'processing';
  queue: QueueState;
  workerAttention: WorkerAttention;
  logs: string[];

  files: OutputFile[];
  selectedFile: OutputFile | null;
  fileContent: string | null;
  parsedBlocks: MarkdownBlocks | null;
  unreadFilePaths: Record<string, true>;

  currentView: View;

  layoutMode: LayoutMode;
  markdownZoom: number;

  hotkey: string;
  aiUrl: string;
  duckaiModels: ModelOption[];

  setStatus: (status: 'idle' | 'processing') => void;
  setQueue: (q: QueueState) => void;
  setWorkerAttention: (state: WorkerAttention) => void;
  appendLog: (msg: string) => void;
  clearLogs: () => void;
  setFiles: (files: OutputFile[], options?: FileUpdateOptions) => void;
  selectFile: (file: OutputFile | null) => void;
  setFileContent: (content: string | null) => void;
  setView: (view: View) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  zoomInMarkdown: () => void;
  zoomOutMarkdown: () => void;
  resetMarkdownZoom: () => void;
  setHotkey: (hotkey: string) => void;
  setAiUrl: (url: string) => void;
  setDuckaiModels: (models: ModelOption[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  queue: { total: 0, current: 0, status: 'idle', items: [] },
  workerAttention: 'idle',
  logs: [],
  files: [],
  selectedFile: null,
  fileContent: null,
  parsedBlocks: null,
  unreadFilePaths: {},
  currentView: 'chat',
  hotkey: 'Alt+G',
  aiUrl: DEFAULT_MODEL_URL,
  duckaiModels: [],
  layoutMode: 'stacked',
  markdownZoom: 100,


  setStatus: (status) => set({ status }),
  setQueue: (queue) => set({ queue }),
  setWorkerAttention: (workerAttention) => set({ workerAttention }),
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
  setView: (currentView) => set({ currentView }),
  setLayoutMode: (layoutMode) => {
    window.electronAPI.updateLayoutMode(layoutMode).catch(() => {});
    set({ layoutMode });
  },
  zoomInMarkdown: () => set((state) => createMarkdownZoomUpdate(state.markdownZoom + MD_ZOOM_STEP)),
  zoomOutMarkdown: () => set((state) => createMarkdownZoomUpdate(state.markdownZoom - MD_ZOOM_STEP)),
  resetMarkdownZoom: () => set(createMarkdownZoomUpdate(100)),
  setHotkey: (hotkey) => set({ hotkey }),
  setAiUrl: (aiUrl) => set({ aiUrl }),
  setDuckaiModels: (duckaiModels) => set({ duckaiModels }),
}));
