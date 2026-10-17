import { create } from 'zustand';
import type { WritingAction, WritingContext } from '../../../shared/writingTools';
import type { SourceRange } from '../utils/markdownBlocks';

/**
 * What a rewrite would change. `file`: an answer as saved, `range` null when the selection could
 * not be traced to its Markdown (a rendered formula) — then only "insert below" is possible.
 * `draft`: a block in the answer editor, where the result changes the draft, not the file.
 */
export type RewriteTarget =
  | {
    kind: 'file';
    /** The conversation file, or the temporary chat's key (nothing can be written there). */
    path: string;
    turnIndex: number;
    /** The answer when the rewrite started; a different answer at "replace" time is a conflict. */
    response: string;
    range: SourceRange | null;
    /** Where "insert below" goes when `range` is null: after this offset's block; null = the end. */
    insertAt: number | null;
  }
  | {
    kind: 'draft';
    path: string;
    turnIndex: number;
    /** The draft text when the rewrite started. */
    original: string;
    range: SourceRange;
  };

export interface RewriteJob {
  id: string;
  action: WritingAction;
  instruction: string;
  providerUrl: string;
  text: string;
  /** The question and the text around the passage, sent along so the rewrite keeps its meaning. */
  context: WritingContext;
  target: RewriteTarget;
  status: 'waiting' | 'running' | 'done' | 'error';
  result: string;
  /** Why the request failed (status `error`), or why putting the result in place did (status `done`). */
  error: string;
}

/** The request is still out: queued or being written. */
export function rewriteBusy(job: RewriteJob | null): boolean {
  return job !== null && (job.status === 'waiting' || job.status === 'running');
}

interface WritingToolsState {
  job: RewriteJob | null;
  /** The model the panel offers; '' until main says which one was used last. */
  modelUrl: string;
  /** Picked in the panel this session; otherwise main's choice is read again on every use. */
  modelChosen: boolean;
  /** The block a result card in a reading answer is placed after. */
  anchor: HTMLElement | null;
  /** Hands text to the composer as a quote; registered by the chat view. */
  quote: ((text: string) => void) | null;
  setJob: (job: RewriteJob | null, anchor?: HTMLElement | null) => void;
  patchJob: (id: string, patch: Partial<RewriteJob>) => void;
  setModelUrl: (url: string) => void;
  chooseModel: (url: string) => void;
  setQuote: (quote: ((text: string) => void) | null) => void;
}

export const useWritingToolsStore = create<WritingToolsState>((set) => ({
  job: null,
  modelUrl: '',
  modelChosen: false,
  anchor: null,
  quote: null,
  setJob: (job, anchor = null) => set({ job, anchor: job ? anchor : null }),
  patchJob: (id, patch) => set((state) => (state.job?.id === id ? { job: { ...state.job, ...patch } } : state)),
  setModelUrl: (modelUrl) => set({ modelUrl }),
  chooseModel: (modelUrl) => set({ modelUrl, modelChosen: true }),
  setQuote: (quote) => set({ quote }),
}));
