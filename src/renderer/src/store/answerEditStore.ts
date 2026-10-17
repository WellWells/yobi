import { create } from 'zustand';

/** One answer open in the editor. Kept per conversation and turn, so leaving and coming back loses nothing. */
export interface AnswerDraft {
  text: string;
  /** The answer as it was when editing started; the save is refused if the file no longer says this. */
  base: string;
  /** The file changed under the editor; the user picks between their text and the file's. */
  conflict: boolean;
  saving: boolean;
  /** Where to put the caret when the editor opens (a source offset), then cleared. */
  focus?: number;
}

/** The last save, so it can be undone until the conversation moves on. Memory only. */
export interface SavedAnswerEdit {
  path: string;
  turnIndex: number;
  before: string;
  beforeEditedAt: string | null;
  /** Turns in the conversation at save time: a new turn sends the edit, and an undo after that would lie. */
  turnCount: number;
}

interface AnswerEditState {
  drafts: Record<string, AnswerDraft>;
  saved: SavedAnswerEdit | null;
  /** Opens the editor; an editor already open for the turn keeps its text and only moves the caret. */
  start: (path: string, turnIndex: number, response: string, focus?: number) => void;
  update: (path: string, turnIndex: number, patch: Partial<AnswerDraft>) => void;
  discard: (path: string, turnIndex: number) => void;
  setSaved: (saved: SavedAnswerEdit | null) => void;
}

export function draftKey(path: string, turnIndex: number): string {
  return `${turnIndex}\u0000${path}`;
}

export const useAnswerEditStore = create<AnswerEditState>((set) => ({
  drafts: {},
  saved: null,
  start: (path, turnIndex, response, focus) => set((state) => {
    const key = draftKey(path, turnIndex);
    const open = state.drafts[key];
    if (open) {
      return focus === undefined ? state : { drafts: { ...state.drafts, [key]: { ...open, focus } } };
    }
    return {
      drafts: {
        ...state.drafts,
        [key]: { text: response, base: response, conflict: false, saving: false, ...(focus === undefined ? {} : { focus }) },
      },
      // A new edit is a new decision; the previous one's undo no longer reads as "the last thing I did".
      saved: null,
    };
  }),
  update: (path, turnIndex, patch) => set((state) => {
    const key = draftKey(path, turnIndex);
    const draft = state.drafts[key];
    return draft ? { drafts: { ...state.drafts, [key]: { ...draft, ...patch } } } : state;
  }),
  discard: (path, turnIndex) => set((state) => {
    const key = draftKey(path, turnIndex);
    if (!state.drafts[key]) return state;
    const { [key]: _dropped, ...drafts } = state.drafts;
    return { drafts };
  }),
  setSaved: (saved) => set({ saved }),
}));
