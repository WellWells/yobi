import { useEffect, useRef } from 'react';
import type { ShortcutId } from '../../../shared/shortcuts';
import type { View } from '../store/appStore';
import { useShortcutStore } from '../store/shortcutStore';
import type { ShortcutHandler } from '../store/shortcutStore';

export function useShortcutAction(
  id: ShortcutId,
  handler: ShortcutHandler,
  view: View | 'any' = 'any',
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const registerHandler = useShortcutStore.getState().registerHandler;
    return registerHandler(id, view, (event, combo) => handlerRef.current(event, combo));
  }, [id, view]);
}
