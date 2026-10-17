import { create } from 'zustand';
import type { AppliedSpot, AssistantQuestion, PlacedEdit, UnplacedEdit } from '../../../shared/docAssistant';

/**
 * `pending`: not in the document (the editor was open when the reply came, or a save failed);
 * `applied` → `reverted` by undo; `stale`: its text is no longer where it was, so it can neither
 * go in nor come out.
 */
export type AssistantEditState = 'pending' | 'applied' | 'skipped' | 'reverted' | 'stale';

export interface AssistantEditCard extends PlacedEdit {
  id: string;
  state: AssistantEditState;
  /** The heading the place sits under, to say where it is; '' at the top of the page. */
  heading: string;
  /** Where it went in the document, to find it again for undo. */
  applied?: AppliedSpot;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** What the user pointed at when sending (the page's words). */
  quote?: string;
  ask?: AssistantQuestion | null;
  edits?: AssistantEditCard[];
  /** Places the model named that could not be found in the document, even after a retry. */
  unplaced?: UnplacedEdit[];
}

/** `retrying`: the reply broke the format or named places that are not in the document; asked again. */
export interface AssistantJob {
  /** The request out now; each attempt has its own. */
  requestId: string;
  phase: 'waiting' | 'running' | 'retrying';
  attempt: number;
}

export interface AssistantSelection {
  /** The words as the page shows them, for the chip. */
  text: string;
  /** The same passage as written, when it could be traced; sent instead of `text`. */
  source: string | null;
}

export interface AssistantThread {
  messages: AssistantMessage[];
  job: AssistantJob | null;
  /** Why the last request failed, with the message to send again. */
  error: { message: string; retry: string } | null;
  selection: AssistantSelection | null;
}

const EMPTY: AssistantThread = { messages: [], job: null, error: null, selection: null };

const OPEN_KEY = 'yobi-doc-assistant-open';
const WIDTH_KEY = 'yobi-doc-assistant-width';
export const ASSISTANT_WIDTH_MIN = 300;
export const ASSISTANT_WIDTH_MAX = 640;
const ASSISTANT_WIDTH_DEFAULT = 380;

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return value >= ASSISTANT_WIDTH_MIN && value <= ASSISTANT_WIDTH_MAX ? value : ASSISTANT_WIDTH_DEFAULT;
  } catch {
    return ASSISTANT_WIDTH_DEFAULT;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private storage off: the panel just forgets.
  }
}

interface DocAssistantState {
  /** Per document path; kept in memory only, for as long as the app runs. */
  threads: Record<string, AssistantThread>;
  open: boolean;
  width: number;
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
  patch: (path: string, patch: Partial<AssistantThread>) => void;
  addMessage: (path: string, message: AssistantMessage) => void;
  /** `spots`: where each edit now applied went (by id). */
  setEditState: (path: string, messageId: string, editIds: readonly string[], state: AssistantEditState, spots?: Record<string, AppliedSpot>) => void;
  clear: (path: string) => void;
}

export function threadOf(threads: Record<string, AssistantThread>, path: string): AssistantThread {
  return threads[path] ?? EMPTY;
}

export const useDocAssistantStore = create<DocAssistantState>((set) => ({
  threads: {},
  open: readOpen(),
  width: readWidth(),
  setOpen: (open) => {
    remember(OPEN_KEY, open ? '1' : '0');
    set({ open });
  },
  setWidth: (width) => {
    const clamped = Math.round(Math.min(ASSISTANT_WIDTH_MAX, Math.max(ASSISTANT_WIDTH_MIN, width)));
    remember(WIDTH_KEY, String(clamped));
    set({ width: clamped });
  },
  patch: (path, patch) => set((state) => ({
    threads: { ...state.threads, [path]: { ...threadOf(state.threads, path), ...patch } },
  })),
  addMessage: (path, message) => set((state) => {
    const thread = threadOf(state.threads, path);
    return { threads: { ...state.threads, [path]: { ...thread, messages: [...thread.messages, message] } } };
  }),
  setEditState: (path, messageId, editIds, editState, spots) => set((state) => {
    const thread = threadOf(state.threads, path);
    const messages = thread.messages.map((message) => (message.id !== messageId || !message.edits ? message : {
      ...message,
      edits: message.edits.map((edit) => {
        if (!editIds.includes(edit.id)) return edit;
        const spot = spots?.[edit.id];
        return spot ? { ...edit, state: editState, applied: spot } : { ...edit, state: editState };
      }),
    }));
    return { threads: { ...state.threads, [path]: { ...thread, messages } } };
  }),
  clear: (path) => set((state) => {
    const { [path]: _gone, ...rest } = state.threads;
    return { threads: rest };
  }),
}));
