import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConversationFindStore } from '../store/conversationFindStore';
import { clearMatches, collectMatches, paintMatches, revealMatch } from '../utils/conversationFind';
import { firstMatchFrom } from '../utils/findMatches';

/** Typing settles before the page is searched again. */
const QUERY_DEBOUNCE_MS = 120;
/** A streaming render or a reload settles before the matches are recounted. */
const MUTATION_DEBOUNCE_MS = 200;

/** Marks the find bar, whose own counter changing must not count as the conversation changing. */
export const FIND_BAR_ATTR = 'data-find-bar';

export interface ConversationFind {
  count: number;
  /** Index of the current match, or -1. */
  current: number;
  next: () => void;
  previous: () => void;
}

/**
 * Finds the bar's query in the conversation shown in `containerRef` (the chat's scroll area) and
 * keeps the matches current as the page changes. `resetKey` names the open conversation: a new one
 * lands on its first match again.
 */
export function useConversationFind(containerRef: RefObject<HTMLElement | null>, resetKey: string): ConversationFind {
  const { open, query, caseSensitive, wholeWord } = useConversationFindStore(useShallow((s) => ({
    open: s.open, query: s.query, caseSensitive: s.caseSensitive, wholeWord: s.wholeWord,
  })));
  const [count, setCount] = useState(0);
  const [current, setCurrent] = useState(-1);
  const rangesRef = useRef<Range[]>([]);
  const currentRef = useRef(-1);
  // Set by a new query or conversation, and kept until there is something to land on: a
  // conversation opened from Ctrl+K arrives a moment after the query does.
  const landPendingRef = useRef(false);

  const show = useCallback((ranges: Range[], index: number, reveal: boolean): void => {
    rangesRef.current = ranges;
    currentRef.current = index;
    setCount(ranges.length);
    setCurrent(index);
    paintMatches(ranges, index);
    const container = containerRef.current;
    if (reveal && container && ranges[index]) revealMatch(ranges[index], container);
  }, [containerRef]);

  const recount = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;
    const ranges = collectMatches(container, query.trim() ? query : '', { caseSensitive, wholeWord });
    if (ranges.length === 0) {
      show([], -1, false);
      return;
    }
    if (landPendingRef.current) {
      landPendingRef.current = false;
      const viewTop = container.getBoundingClientRect().top;
      show(ranges, firstMatchFrom(ranges.map((range) => range.getBoundingClientRect().top), viewTop), true);
      return;
    }
    show(ranges, Math.min(Math.max(currentRef.current, 0), ranges.length - 1), false);
  }, [containerRef, query, caseSensitive, wholeWord, show]);

  // A new query, new options or another conversation: search again and land on a match.
  useEffect(() => {
    if (!open) return;
    landPendingRef.current = true;
    const timer = window.setTimeout(recount, QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, recount, resetKey]);

  // The page changed under the bar (an answer arrived, the file reloaded): recount, stay put.
  useEffect(() => {
    const container = containerRef.current;
    if (!open || !container) return;
    let timer = 0;
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return !target?.closest(`[${FIND_BAR_ATTR}]`);
      });
      if (!relevant) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(recount, MUTATION_DEBOUNCE_MS);
    });
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [open, recount, containerRef]);

  useEffect(() => {
    if (open) return;
    clearMatches();
    rangesRef.current = [];
    currentRef.current = -1;
    setCount(0);
    setCurrent(-1);
  }, [open]);

  useEffect(() => clearMatches, []);

  const step = useCallback((delta: number): void => {
    const ranges = rangesRef.current;
    if (ranges.length === 0) return;
    landPendingRef.current = false;
    const index = currentRef.current < 0
      ? (delta > 0 ? 0 : ranges.length - 1)
      : (currentRef.current + delta + ranges.length) % ranges.length;
    show(ranges, index, true);
  }, [show]);

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  return { count, current, next, previous };
}
