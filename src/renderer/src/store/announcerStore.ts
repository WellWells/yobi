import { create } from 'zustand';

interface AnnouncerState {
  message: string;
  /** Bumped on every announcement, so the same words said twice still change the region. */
  seq: number;
}

/** What the window's one polite live region (`LiveAnnouncer`) says next. */
export const useAnnouncerStore = create<AnnouncerState>(() => ({ message: '', seq: 0 }));

/**
 * Tells a screen reader something that happened out of its sight (WCAG 4.1.3): short, in the UI
 * language, never the content itself (a reply is "reply complete", not the answer). Polite: it waits
 * for the reader to finish. Errors are toasts with `role="alert"` and do not come through here.
 */
export function announce(text: string): void {
  const message = text.trim();
  if (!message) return;
  useAnnouncerStore.setState((state) => ({ message, seq: state.seq + 1 }));
}
