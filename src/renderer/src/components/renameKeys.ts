import { isComposingKey } from '../utils/imeKeys';

/** On the ✨ button of a rename box. */
export const AI_NAME_BUTTON_ATTR = 'data-ai-name-button';
/** On the dropdown of a model menu (`AiModelMenu`). */
export const AI_MODEL_MENU_ATTR = 'data-ai-model-menu';

/**
 * Focus going to the ✨ button or into its model menu: a box that saves on blur stays open, since
 * hovering and picking a model is the user still naming, not leaving.
 */
export function isAiNameTarget(node: EventTarget | null): boolean {
  if (!node || typeof (node as Element).closest !== 'function') return false;
  return (node as Element).closest(`[${AI_MODEL_MENU_ATTR}],[${AI_NAME_BUTTON_ATTR}]`) !== null;
}

export type RenameMode = 'rename' | 'field';
export type RenameKeyAction = 'commit' | 'cancel' | 'none';

/**
 * Enter saves and Escape cancels a rename box; a field (the flow editor's name) has no save of its
 * own, so there Escape only stops a running name. An input method composing owns both keys.
 */
export function renameKeyAction(
  event: { key: string; isComposing: boolean; keyCode: number },
  mode: RenameMode,
): RenameKeyAction {
  if (isComposingKey(event)) return 'none';
  if (event.key === 'Escape') return 'cancel';
  if (event.key === 'Enter' && mode === 'rename') return 'commit';
  return 'none';
}
