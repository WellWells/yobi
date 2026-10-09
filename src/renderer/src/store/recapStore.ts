import { create } from 'zustand';
import { INITIAL_RECAP_STATE, reduceRecap, type RecapEvent, type RecapState } from '../utils/recapState';

interface RecapStore {
  state: RecapState;
  dispatch: (event: RecapEvent) => void;
}

/** Kept in memory only: a restart starts with nothing armed or dismissed. */
export const useRecapStore = create<RecapStore>((set) => ({
  state: INITIAL_RECAP_STATE,
  dispatch: (event) => set((store) => ({ state: reduceRecap(store.state, event) })),
}));

/** Called by the explicit open actions (sidebar, search), so a reload after a send is never "opening". */
export function noteConversationOpened(path: string): void {
  useRecapStore.getState().dispatch({ kind: 'opened', path });
}

/** Called before the renamed file is selected, so a rename is neither a switch nor an opening. */
export function noteConversationRenamed(from: string, to: string): void {
  if (from !== to) useRecapStore.getState().dispatch({ kind: 'renamed', from, to });
}
