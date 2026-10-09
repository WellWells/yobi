import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEventLike } from '../../../../shared/shortcuts';
import type { ComposerEditorEventPayload } from '../../../../shared/types';
import { composerEditorApi } from '../../api/electronApi';
import { matchesShortcut } from '../../store/shortcutStore';

/** Ctrl+G in the message box, as in Claude Code: the draft opens in the user's own editor. */
export function wantsExternalEditor(event: KeyboardEventLike): boolean {
  return matchesShortcut(event, 'chat.externalEditor');
}

/**
 * Puts the editor's text in the field through the browser's editing pipeline, so Ctrl+Z brings
 * back what was there before. Returns false when the browser refused, so the caller sets the
 * state itself.
 */
export function replaceAllText(field: HTMLTextAreaElement, text: string): boolean {
  if (field.value === text) return true;
  if (typeof document.execCommand !== 'function') return false;
  // The editing commands act on the focused field; Yobi is usually in the background here, and
  // focusing an element does not raise the window.
  if (document.activeElement !== field) field.focus({ preventScroll: true });
  // A hidden field (another view is showing) cannot take focus, and the command would then type
  // into whatever has it.
  if (document.activeElement !== field) return false;
  field.select();
  return text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
}

export interface ExternalEditorHandlers {
  /** Text the editor saved; `closed` is true once the editor is done with it. */
  onText: (text: string | null, closed: boolean) => void;
  onFailed: () => void;
}

export interface ExternalEditor {
  editing: boolean;
  open: (text: string) => Promise<void>;
  /** `apply` takes in what was saved since the last event — "done"; a send passes false. */
  finish: (apply: boolean) => Promise<void>;
}

/** Routes one session's events; anything for an earlier session is ignored. */
export function routeEditorEvent(
  event: ComposerEditorEventPayload,
  currentId: string | null,
  handlers: ExternalEditorHandlers,
): 'ignored' | 'open' | 'ended' {
  if (event.id !== currentId) return 'ignored';
  if (event.kind === 'saved') {
    handlers.onText(event.text, false);
    return 'open';
  }
  if (event.kind === 'closed') handlers.onText(event.text, true);
  else handlers.onFailed();
  return 'ended';
}

export function useExternalEditor(handlers: ExternalEditorHandlers): ExternalEditor {
  const [editing, setEditing] = useState(false);
  const idRef = useRef<string | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const settle = useCallback((id: string | null): void => {
    idRef.current = id;
    setEditing(id !== null);
  }, []);

  useEffect(() => composerEditorApi.onEvent((event) => {
    if (routeEditorEvent(event, idRef.current, handlersRef.current) === 'ended') settle(null);
  }), [settle]);

  // A session the composer no longer shows would keep its temp file until the app quits.
  useEffect(() => () => {
    if (idRef.current) void composerEditorApi.finish(idRef.current);
  }, []);

  const open = useCallback(async (text: string): Promise<void> => {
    const id = await composerEditorApi.open(text);
    if (!id) {
      settle(null);
      handlersRef.current.onFailed();
      return;
    }
    settle(id);
  }, [settle]);

  const finish = useCallback(async (apply: boolean): Promise<void> => {
    const id = idRef.current;
    if (!id) return;
    settle(null);
    const text = await composerEditorApi.finish(id);
    if (apply) handlersRef.current.onText(text, true);
  }, [settle]);

  return { editing, open, finish };
}
