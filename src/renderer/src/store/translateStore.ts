import { create } from 'zustand';
import type { TurnTranslation } from '../../../shared/conversationDoc';
import { isTranslateLanguage, type TranslateLanguage } from '../../../shared/translateLanguages';

/** One answer being translated (or converted). Keyed by `turnKey(path, turnIndex)`. */
export interface TurnTranslateJob {
  id: string;
  to: TranslateLanguage;
  by: 'ai' | 'opencc';
  /** The answer when the job started; the result is saved against it. */
  source: string;
  status: 'queued' | 'waiting' | 'running' | 'error';
  error: string;
}

export interface ConversationTranslateJob {
  id: string;
  path: string;
  to: TranslateLanguage;
  done: number;
  total: number;
  phase: 'starting' | 'waiting' | 'running';
  /** Cancel was pressed; repeated on the next progress event in case main had not started yet. */
  cancelling?: boolean;
}

export function turnKey(path: string, turnIndex: number): string {
  return `${path}#${turnIndex}`;
}

export function translateBusy(job: TurnTranslateJob | undefined): boolean {
  return job !== undefined && job.status !== 'error';
}

const RECENT_KEY = 'yobi-translate-recent';

function readRecent(): TranslateLanguage[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isTranslateLanguage) : [];
  } catch {
    return [];
  }
}

interface TranslateState {
  jobs: Record<string, TurnTranslateJob>;
  /** Translations that are never written: the temporary chat's, and only for this session. */
  memory: Record<string, TurnTranslation>;
  recent: TranslateLanguage[];
  conversation: ConversationTranslateJob | null;
  setJob: (key: string, job: TurnTranslateJob | null) => void;
  patchJob: (id: string, patch: Partial<TurnTranslateJob>) => void;
  setMemory: (key: string, translation: TurnTranslation | null) => void;
  setRecent: (recent: TranslateLanguage[]) => void;
  setConversation: (job: ConversationTranslateJob | null) => void;
}

export const useTranslateStore = create<TranslateState>((set) => ({
  jobs: {},
  memory: {},
  recent: readRecent(),
  conversation: null,
  setJob: (key, job) => set((state) => {
    const jobs = { ...state.jobs };
    if (job) jobs[key] = job;
    else delete jobs[key];
    return { jobs };
  }),
  patchJob: (id, patch) => set((state) => {
    const entry = Object.entries(state.jobs).find(([, job]) => job.id === id);
    return entry ? { jobs: { ...state.jobs, [entry[0]]: { ...entry[1], ...patch } } } : state;
  }),
  setMemory: (key, translation) => set((state) => {
    const memory = { ...state.memory };
    if (translation) memory[key] = translation;
    else delete memory[key];
    return { memory };
  }),
  setRecent: (recent) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      // Private storage unavailable: the list just is not remembered across restarts.
    }
    set({ recent });
  },
  setConversation: (conversation) => set({ conversation }),
}));
