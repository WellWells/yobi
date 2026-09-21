import type { LayoutMode } from '../../store/appStore';

/**
 * Whether the chat area shows the conversation view rather than the document view.
 *
 * Side-by-side deliberately renders a conversation of a single turn as a document: there is
 * nothing to thread yet, and the document reads better next to the composer. That rule used to
 * ignore pending turns, so asking a follow-up on a one-turn conversation put the question into
 * a view that cannot render it — the composer cleared and nothing at all appeared until the
 * reply landed, minutes later. Anything in flight now forces the conversation view, whatever
 * the layout says.
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
