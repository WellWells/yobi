import { showAppNotice } from '../../hooks/useUiNotifications';

interface ReplacePrompt {
  /** The text in the field now, which an undo puts back. */
  previous: string;
  next: string;
  /** Whether `previous` is the user's own edit; a built-in template is replaced without a notice. */
  edited: boolean;
  commit: (text: string) => Promise<boolean>;
  message: string;
  undoLabel: string;
}

/**
 * Swaps a prompt template for a built-in one. Replacing the user's own edit offers it back for a
 * moment through the notice's undo instead of asking first.
 */
export async function replacePromptWithUndo({ previous, next, edited, commit, message, undoLabel }: ReplacePrompt): Promise<boolean> {
  const saved = await commit(next);
  if (saved && edited) {
    showAppNotice({ message, level: 'info', undo: { label: undoLabel, run: () => { void commit(previous); } } });
  }
  return saved;
}
