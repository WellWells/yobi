import { useCallback, useEffect, useRef, type RefObject } from 'react';

const NEAR_BOTTOM_PX = 80;

export function isNearBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX;
}

export interface ScrollMetrics {
  top: number;
  height: number;
  viewport: number;
}

/**
 * Whether a scroll moved up because the reader did it, not because content shrank or the viewport
 * grew (the browser then pulls `scrollTop` down by itself).
 */
export function readerScrolledUp(previous: ScrollMetrics, next: ScrollMetrics): boolean {
  const clamped = next.height < previous.height || next.viewport > previous.viewport;
  return !clamped && next.top < previous.top - 1;
}

function readMetrics(container: HTMLElement): ScrollMetrics {
  return { top: container.scrollTop, height: container.scrollHeight, viewport: container.clientHeight };
}

function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let element = node?.parentElement ?? null; element; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element);
    if (overflowY === 'auto' || overflowY === 'scroll') return element;
  }
  return null;
}

export type ScrollMove = 'jump' | 'follow' | 'none';

export interface ScrollSnapshot {
  path: string;
  turns: number;
  pending: number;
}

/**
 * What opening or updating a conversation does to the scroll position. Opening one — a switch,
 * or a first mount, which is what the sidebar produces since it shows a loading state between
 * two conversations — lands on the latest turn the way the providers' web apps do.
 */
export function scrollMoveFor(previous: ScrollSnapshot | null, next: ScrollSnapshot): ScrollMove {
  if (!previous || previous.path !== next.path) return 'jump';
  if (next.turns > previous.turns || next.pending > previous.pending) return 'follow';
  return 'none';
}

export function useStickToBottom(
  contentRef: RefObject<HTMLElement | null>,
  rebindKey: string,
): { follow: () => void; jump: () => void } {
  const following = useRef(false);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const content = contentRef.current;
    const container = scrollParent(content);
    if (!content || !container) return;
    containerRef.current = container;

    let last = readMetrics(container);
    const onScroll = (): void => {
      const now = readMetrics(container);
      const scrolledUp = readerScrolledUp(last, now);
      last = now;
      if (isNearBottom(now.top, now.height, now.viewport)) following.current = true;
      else if (scrolledUp) following.current = false;
    };
    container.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      if (!following.current) return;
      container.scrollTop = container.scrollHeight;
      last = readMetrics(container);
    });
    observer.observe(content);
    // The viewport shrinks too, not only the content grows: a row appearing above the composer (the
    // recap, the resume banner) or the composer itself growing must not hide the end of the answer.
    observer.observe(container);

    return () => {
      container.removeEventListener('scroll', onScroll);
      observer.disconnect();
      containerRef.current = null;
    };
  }, [contentRef, rebindKey]);

  const follow = useCallback((): void => {
    following.current = true;
    const container = containerRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, []);

  // Instant, and it keeps following: math, diagrams and images finish rendering after the first
  // paint and would otherwise push the end back out of view. Scrolling up still lets go. Called
  // from a layout effect on first mount, before the effect above has found the container.
  const jump = useCallback((): void => {
    following.current = true;
    const container = containerRef.current ?? scrollParent(contentRef.current);
    if (container) container.scrollTop = container.scrollHeight;
  }, [contentRef]);

  return { follow, jump };
}
