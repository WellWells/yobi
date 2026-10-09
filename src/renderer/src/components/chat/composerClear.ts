import type { KeyboardEventLike } from '../../../../shared/shortcuts';
import { matchesShortcut } from '../../store/shortcutStore';

/**
 * Ctrl+C in the message box, as in Claude Code: with text selected it copies; with nothing
 * selected and something drafted it clears the draft.
 */
export function wantsComposerClear(
  event: KeyboardEventLike,
  field: Pick<HTMLTextAreaElement, 'selectionStart' | 'selectionEnd'>,
  hasDraft: boolean,
): boolean {
  if (!hasDraft) return false;
  if (field.selectionStart !== field.selectionEnd) return false;
  return matchesShortcut(event, 'chat.clearComposer');
}

/**
 * Deletes through the browser's editing pipeline instead of setting state, so the deletion lands
 * on the field's undo stack and Ctrl+Z brings the draft back; the resulting `input` event reaches
 * React's onChange. Returns false when the browser refused, so the caller clears the state itself.
 */
export function deleteAllText(field: HTMLTextAreaElement): boolean {
  if (!field.value) return true;
  field.select();
  return typeof document.execCommand === 'function' && document.execCommand('delete');
}
