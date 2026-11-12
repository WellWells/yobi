/**
 * What a right-click lands on, for the app's own Cut / Copy / Paste / Select All menu. Electron
 * draws no context menu of its own, so without this a right-click in a field did nothing.
 */

export type TextField = HTMLInputElement | HTMLTextAreaElement;

/** Input types whose text can be selected and edited like a text box. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

export interface FieldTarget {
  kind: 'field';
  el: TextField;
  start: number;
  end: number;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canSelectAll: boolean;
}

export interface SelectionTarget {
  kind: 'selection';
  text: string;
}

export type TextMenuTarget = FieldTarget | SelectionTarget;

export function isTextField(el: Element | null): el is TextField {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type.toLowerCase());
}

/** The field the event came from: the element itself, or the one it sits in (a Mantine section). */
function fieldOf(target: EventTarget | null): TextField | null {
  if (!(target instanceof Element)) return null;
  if (isTextField(target)) return target;
  const inner = target.closest('input, textarea');
  return isTextField(inner) ? inner : null;
}

function selectionRange(el: TextField): { start: number; end: number } {
  // A number input has no selection API and reads null; treat it as the caret at the end.
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * The menu for a right-click: a field gets the edit commands it allows (a password never gives
 * its text out, a read-only or disabled field takes nothing in); anywhere else only selected
 * text gets a menu, with Copy. Null = no menu, as before.
 */
export function resolveTextMenuTarget(target: EventTarget | null, selectedText: string): TextMenuTarget | null {
  const el = fieldOf(target);
  if (el) {
    const { start, end } = selectionRange(el);
    const hasSelection = end > start;
    const secret = el instanceof HTMLInputElement && el.type.toLowerCase() === 'password';
    const editable = !el.readOnly && !el.disabled;
    return {
      kind: 'field',
      el,
      start,
      end,
      canCut: hasSelection && editable && !secret,
      canCopy: hasSelection && !secret,
      canPaste: editable,
      canSelectAll: el.value.length > 0 && !el.disabled,
    };
  }
  if (selectedText.trim().length > 0) return { kind: 'selection', text: selectedText };
  return null;
}

/**
 * A context press (right button; Ctrl+click on macOS) in the focused field that has a selection.
 * Chromium moves the caret to the press point on mousedown — before `contextmenu` fires — so a
 * right-click in the blank part of the field dropped the selection the menu was meant to cut or
 * copy. Windows text boxes keep it; preventing this press keeps it here too.
 */
export function keepsSelectionOnPress(e: MouseEvent, mac: boolean): boolean {
  const contextPress = e.button === 2 || (mac && e.button === 0 && e.ctrlKey);
  if (!contextPress) return false;
  const el = fieldOf(e.target);
  if (!el || el.ownerDocument.activeElement !== el) return false;
  return (el.selectionEnd ?? 0) > (el.selectionStart ?? 0);
}

/** Puts the caret and selection back in the field the menu was opened on; focus left it for the menu. */
export function restoreField(target: FieldTarget): void {
  target.el.focus();
  try {
    target.el.setSelectionRange(target.start, target.end);
  } catch {
    // A number input has no selection API; the caret stays where focus put it.
  }
}

/** Removes the selection the menu was opened on, as the Delete key would (Ctrl+Z brings it back). */
export function deleteFromField(target: FieldTarget): void {
  restoreField(target);
  if (typeof document.execCommand === 'function' && document.execCommand('delete')) return;
  insertIntoField(target.el, target.start, target.end, '');
}

/** Give a field's paste handler the clipboard text before the ordinary editable insertion. */
export function pasteIntoField(target: FieldTarget, text: string): void {
  restoreField(target);
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
  if (!target.el.dispatchEvent(event)) return;
  insertIntoField(target.el, target.start, target.end, text);
}

/**
 * Replaces the field's selection with `text` the way typing would: through the editing command,
 * so React's onChange fires and Ctrl+Z takes it back. Falls back to setting the value when the
 * command is not available (no document focus, a DOM without editing).
 */
export function insertIntoField(el: TextField, start: number, end: number, text: string): void {
  el.focus();
  try {
    el.setSelectionRange(start, end);
  } catch {
    // No selection API: the command still inserts at the caret.
  }
  if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const caret = start + text.length;
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    // No selection API.
  }
}
