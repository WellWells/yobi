import { useCallback, useEffect, useMemo, useRef } from 'react';
import { currentRecap, type RecapView } from '../../../shared/recap';
import type { ConversationDoc } from '../../../shared/conversationDoc';
import { useAppStore } from '../store/appStore';
import { useRecapStore } from '../store/recapStore';
import { presentRecap, type RecapContext, type RecapPresentation } from '../utils/recapState';
import { useWindowAway } from './useWindowAway';

export interface ConversationRecap extends RecapPresentation {
  recap: RecapView | null;
  /** Closes the `/recap` line, or marks the icon's recap as seen once its card has opened. */
  dismiss: () => void;
  /** `/recap`: show it now, whatever the thresholds say. */
  showNow: () => void;
}

/** Feeds the open conversation and the window's comings and goings into the recap state machine. */
export function useConversationRecap(args: {
  path: string;
  conversation: ConversationDoc | null;
  pendingCount: number;
}): ConversationRecap {
  const { path, conversation, pendingCount } = args;
  const currentView = useAppStore((s) => s.currentView);
  const enabled = useAppStore((s) => s.showRecap);
  const state = useRecapStore((s) => s.state);
  const dispatch = useRecapStore((s) => s.dispatch);
  const recap = useMemo(() => (conversation ? currentRecap(conversation) : null), [conversation]);

  const ctx: RecapContext = {
    path,
    recap,
    turnCount: conversation?.turns.length ?? 0,
    pending: pendingCount > 0,
  };
  // Events arrive from listeners and effects; they must read the conversation as it is now.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useWindowAway(useCallback((awayMs: number) => {
    dispatch({ kind: 'returned', awayMs, ctx: ctxRef.current });
  }, [dispatch]));

  useEffect(() => {
    dispatch({ kind: 'switched', path });
  }, [dispatch, path]);

  useEffect(() => {
    if (conversation) dispatch({ kind: 'loaded', ctx: ctxRef.current, now: Date.now() });
  }, [dispatch, conversation, path]);

  // Any send starting here closes the line, the one that brought it up included.
  const previousPending = useRef(pendingCount);
  useEffect(() => {
    if (pendingCount > previousPending.current) dispatch({ kind: 'sendStarted' });
    previousPending.current = pendingCount;
  }, [dispatch, pendingCount]);

  const dismiss = useCallback(() => dispatch({ kind: 'dismiss' }), [dispatch]);
  const showNow = useCallback(() => dispatch({ kind: 'manual', ctx: ctxRef.current }), [dispatch]);

  return { ...presentRecap(state, { ...ctx, currentView, enabled }), recap, dismiss, showNow };
}
