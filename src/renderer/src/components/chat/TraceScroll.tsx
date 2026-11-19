import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Box } from '@mantine/core';
import { readerScrolledUp, type ScrollMetrics } from '../../hooks/useStickToBottom';
import { useScrollEdgeFade } from '../../hooks/useScrollEdgeFade';

/** About fourteen rows; a short window still keeps room for the answer under the trace. */
export const TRACE_MAX_HEIGHT = 'min(40vh, 360px)';

/** Closer than this to the end of the box counts as reading the newest step. */
const FOLLOW_SLACK_PX = 16;

/**
 * Whether the box keeps pinning the newest step after a scroll: back at the end resumes it, the
 * reader scrolling up lets go, and anything else (rows growing, the box clamping) leaves it as it was.
 */
export function traceFollowsAfterScroll(following: boolean, previous: ScrollMetrics, next: ScrollMetrics): boolean {
  if (next.height - next.top - next.viewport <= FOLLOW_SLACK_PX) return true;
  if (readerScrolledUp(previous, next)) return false;
  return following;
}

function readMetrics(el: HTMLElement): ScrollMetrics {
  return { top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight };
}

// The negative margin and matching padding keep a tabbed-to row's focus ring inside the box (a
// scroll container clips everything past its padding) while the rows still line up with the header.
const BOX_STYLE = {
  maxHeight: TRACE_MAX_HEIGHT,
  overflowY: 'auto',
  margin: -4,
  padding: 4,
} as const;

interface TraceScrollProps {
  /** Start at the newest step and keep it in view as steps arrive, until the reader scrolls up. */
  follow: boolean;
  children: ReactNode;
}

/**
 * The expanded trace, capped in height and scrolled inside. Without the cap a forty-step run
 * pushed the answer a page further down with every step. The wheel is never trapped: at either
 * end of the box it carries on to the conversation (no `overscroll-behavior`).
 */
export function TraceScroll({ follow, children }: TraceScrollProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fadeClass = useScrollEdgeFade(boxRef);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (follow && box) box.scrollTop = box.scrollHeight;
  }, [follow]);

  useEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!follow || !box || !content) return undefined;
    let following = true;
    let last = readMetrics(box);
    const onScroll = (): void => {
      const now = readMetrics(box);
      following = traceFollowsAfterScroll(following, last, now);
      last = now;
    };
    const observer = new ResizeObserver(() => {
      if (!following) return;
      box.scrollTop = box.scrollHeight;
      last = readMetrics(box);
    });
    box.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    return () => {
      box.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [follow]);

  return (
    <Box ref={boxRef} className={fadeClass} style={BOX_STYLE} data-trace-scroll="">
      <Box ref={contentRef}>{children}</Box>
    </Box>
  );
}
