import type { KeyboardEventLike } from '../../../../shared/shortcuts';
import { matchesShortcut } from '../../store/shortcutStore';

/**
 * Ctrl+Shift+V / Cmd+Shift+V in the message box, the paste-as-plain-text key: a file copied in
 * Explorer or Finder comes in as its absolute path. Plain Ctrl+V keeps attaching it.
 */
export function wantsPathPaste(event: KeyboardEventLike): boolean {
  return matchesShortcut(event, 'composer.pastePath');
}

/** Quoted only when it has to be, so a single plain path pastes exactly as it is. */
function quotePath(filePath: string): string {
  return /\s/.test(filePath) ? `"${filePath}"` : filePath;
}

/**
 * What lands in the box for these paths: space-separated (one line both a sentence and a `!`
 * shell command can take), with a space added only where it would otherwise run into the
 * neighbouring text.
 */
export function pathPasteText(paths: readonly string[], before: string, after: string): string {
  const joined = paths.map(quotePath).join(' ');
  if (!joined) return '';
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  return `${lead}${joined}${trail}`;
}

/**
 * Types the paths over the selection through the browser's editing pipeline, so Ctrl+Z takes
 * them back out and React hears the input. Returns the new value when the browser refused, for
 * the caller to set itself; null when the field already has it.
 */
export function insertPathsAtCaret(field: HTMLTextAreaElement, paths: readonly string[]): string | null {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const text = pathPasteText(paths, field.value.slice(0, start), field.value.slice(end));
  if (!text) return null;
  if (document.activeElement === field
    && typeof document.execCommand === 'function'
    && document.execCommand('insertText', false, text)) {
    return null;
  }
  return `${field.value.slice(0, start)}${text}${field.value.slice(end)}`;
}
