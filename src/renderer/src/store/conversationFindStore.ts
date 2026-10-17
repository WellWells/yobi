import { create } from 'zustand';

interface ConversationFindState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Bumped on every request to show the bar, so an open bar takes focus again and selects its text. */
  focusToken: number;
  /** Opens the bar; a given query replaces the current one (the selection, or a Ctrl+K search). */
  show: (query?: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  toggleCaseSensitive: () => void;
  toggleWholeWord: () => void;
}

export const useConversationFindStore = create<ConversationFindState>((set) => ({
  open: false,
  query: '',
  caseSensitive: false,
  wholeWord: false,
  focusToken: 0,
  show: (query) => set((state) => ({
    open: true,
    query: query ?? state.query,
    focusToken: state.focusToken + 1,
  })),
  close: () => set({ open: false }),
  setQuery: (query) => set({ query }),
  toggleCaseSensitive: () => set((state) => ({ caseSensitive: !state.caseSensitive })),
  toggleWholeWord: () => set((state) => ({ wholeWord: !state.wholeWord })),
}));
