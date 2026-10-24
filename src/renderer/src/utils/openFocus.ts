/*
 * Where the caret goes after a click opens something from the sidebar: the box the user types into
 * next. For a conversation that is the composer; for a Notion document it is the writing assistant's
 * box (the document view has no composer), and nowhere when that panel is closed. Which one is only
 * known once the file has loaded, so the click records a request and the chat view settles it then.
 */

/** A click asked for the caret; `held` is what had focus right after the click moved it. */
export interface PendingOpenFocus {
  path: string;
  held: Element | null;
}

export type OpenFocusTarget = 'wait' | 'chat' | 'assistant' | 'none';

export interface OpenFocusState {
  pending: PendingOpenFocus | null;
  selectedPath: string | null | undefined;
  /** The opened file's content has arrived (a document is recognised from it). */
  loaded: boolean;
  isDocument: boolean;
  assistantOpen: boolean;
  active: Element | null;
  body: Element | null;
}

/**
 * `wait` until the clicked file has loaded; then `none` if the user has moved on — another file
 * open, or focus somewhere the click did not put it — else the box for what opened.
 */
export function openFocusTarget(state: OpenFocusState): OpenFocusTarget {
  const { pending } = state;
  if (!pending) return 'none';
  if (state.selectedPath !== pending.path) return 'none';
  if (!state.loaded) return 'wait';
  const moved = state.active !== null && state.active !== state.body && state.active !== pending.held;
  if (moved) return 'none';
  if (state.isDocument) return state.assistantOpen ? 'assistant' : 'none';
  return 'chat';
}
