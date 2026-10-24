import { MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import type { SwipeAction } from '../hooks/useRowSwipe';

export interface TrailingSwipeLabels {
  more: string;
  delete: string;
}

export interface LeadingSwipeLabels {
  pin: string;
  unpin: string;
}

/** A conversation row swipes both ways: pin on the right, More and Delete on the left. */
export type ConversationSwipeLabels = TrailingSwipeLabels & LeadingSwipeLabels;

interface TrailingSwipeHandlers {
  /** Open the row's context menu (the same one right-click opens). */
  onMore: () => void;
  /** The context menu's own delete path. */
  onDelete: () => void;
}

interface LeadingSwipeState {
  /** The context menu's own pin toggle. */
  onTogglePin: () => void;
  pinned: boolean;
}

/**
 * A conversation row's left swipe, as in Mail: More, then Delete; swiping all the way across
 * deletes (the delete path itself decides whether that is a confirm or a move to Recently
 * Deleted).
 */
export function conversationTrailingActions(labels: TrailingSwipeLabels, handlers: TrailingSwipeHandlers): SwipeAction[] {
  return [
    { id: 'more', label: labels.more, icon: MoreHorizontal, tone: 'neutral', onTrigger: handlers.onMore },
    { id: 'delete', label: labels.delete, icon: Trash2, tone: 'destructive', onTrigger: handlers.onDelete, fullSwipe: true },
  ];
}

/**
 * A conversation row's right swipe, as in Apple Notes: one action, pin or unpin, and swiping all
 * the way across toggles it directly (Mail's leading full swipe). Nothing is lost either way.
 */
export function conversationLeadingActions(labels: LeadingSwipeLabels, state: LeadingSwipeState): SwipeAction[] {
  return [{
    id: 'pin',
    label: state.pinned ? labels.unpin : labels.pin,
    icon: state.pinned ? PinOff : Pin,
    tone: 'accent',
    onTrigger: state.onTogglePin,
    fullSwipe: true,
  }];
}

/** A flow row's left swipe: More, then Delete. No full swipe: a deleted flow has no trash to come back from. */
export function flowTrailingActions(labels: TrailingSwipeLabels, handlers: TrailingSwipeHandlers): SwipeAction[] {
  return [
    { id: 'more', label: labels.more, icon: MoreHorizontal, tone: 'neutral', onTrigger: handlers.onMore },
    { id: 'delete', label: labels.delete, icon: Trash2, tone: 'destructive', onTrigger: handlers.onDelete },
  ];
}
