import type { LayoutMode } from '../../store/appStore';

/**
 * Whether the chat area shows the conversation view rather than the document view.
 *
 * Side-by-side renders a single-turn conversation as a document, but anything in flight forces the
 * conversation view: the document view cannot render a pending follow-up.
 */
export function shouldShowConversationView(args: {
  layoutMode: LayoutMode;
  turnCount: number;
  pendingTurnCount: number;
  hasContent: boolean;
}): boolean {
  if (!args.hasContent) return false;
  if (args.pendingTurnCount > 0) return true;
  if (args.turnCount === 0) return false;
  return !(args.layoutMode === 'side-by-side' && args.turnCount <= 1);
}
