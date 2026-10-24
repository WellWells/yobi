import { create } from 'zustand';

interface WatchMissingState {
  /** Flows whose watched folder (file trigger) the main process cannot find right now. */
  missing: string[];
  setMissing: (flowIds: string[]) => void;
}

export const useWatchMissingStore = create<WatchMissingState>((set) => ({
  missing: [],
  setMissing: (missing) => set({ missing }),
}));

let listening = false;

/** Reads the current list once and follows the main process's broadcasts after that. */
export function followWatchMissing(): void {
  if (listening) return;
  const api = window.electronAPI;
  if (!api?.getWatchMissing || !api.onWatchMissing) return;
  listening = true;
  const { setMissing } = useWatchMissingStore.getState();
  api.onWatchMissing((flowIds) => setMissing(flowIds));
  void api.getWatchMissing().then(setMissing).catch(() => undefined);
}
