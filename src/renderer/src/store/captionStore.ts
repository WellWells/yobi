import { useEffect } from 'react';
import { create } from 'zustand';
import type { View } from './appStore';

interface CaptionState {
  /** One entry per mounted pane, the view it is drawn in. */
  narrowIn: readonly View[];
}

/**
 * Panes at the window's right edge too narrow for the caption controls' words beside their own
 * (the writing assistant next to a document). While the current view shows one, the controls keep
 * to their icons.
 */
export const useCaptionStore = create<CaptionState>(() => ({ narrowIn: [] }));

/** Marks such a pane as shown in `view`; the returned function takes the mark back. */
export function holdNarrowCaptionPane(view: View): () => void {
  useCaptionStore.setState((s) => ({ narrowIn: [...s.narrowIn, view] }));
  return () => useCaptionStore.setState((s) => {
    const at = s.narrowIn.indexOf(view);
    return { narrowIn: at < 0 ? s.narrowIn : [...s.narrowIn.slice(0, at), ...s.narrowIn.slice(at + 1)] };
  });
}

/** Held by such a pane while it is mounted; `view` is the view it is drawn in. */
export function useNarrowCaptionPane(view: View): void {
  useEffect(() => holdNarrowCaptionPane(view), [view]);
}
