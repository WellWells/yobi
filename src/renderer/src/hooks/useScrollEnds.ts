import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** How far a chevron moves a row: most of what is in view, so the item cut at the edge stays in sight. */
const PAGE_FRACTION = 0.8;

export interface ScrollEnds {
  /** Part of the row is out of view before the start of what is shown. */
  back: boolean;
  /** Part of the row is out of view past the end of what is shown. */
  forward: boolean;
}

export interface ScrollEndsHandle<T extends HTMLElement> {
  /** The row that scrolls sideways. */
  ref: RefObject<T | null>;
  ends: ScrollEnds;
  /** Reads the ends again; wire it to the row's `onScroll`. */
  measure: () => void;
  /** Moves the row one page back (-1) or forward (1). */
  page: (direction: 1 | -1) => void;
}

/**
 * The chevrons of a sideways-scrolling row whose scrollbar is hidden (the settings tab strip, the
 * template gallery's rails): which ends still hide something, and a page step for each. The ends
 * are read again when the row resizes, when it scrolls, and on every render of its host, since
 * what the row holds (a search's matches) changes its width.
 */
export function useScrollEnds<T extends HTMLElement>(): ScrollEndsHandle<T> {
  const ref = useRef<T>(null);
  const [ends, setEnds] = useState<ScrollEnds>({ back: false, forward: false });

  const measure = useCallback(() => {
    const row = ref.current;
    if (!row) return;
    const back = row.scrollLeft > 1;
    const forward = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setEnds((prev) => (prev.back === back && prev.forward === forward ? prev : { back, forward }));
  }, []);

  useEffect(() => {
    const row = ref.current;
    if (!row) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  useLayoutEffect(measure);

  const page = useCallback((direction: 1 | -1) => {
    const row = ref.current;
    row?.scrollBy({ left: direction * row.clientWidth * PAGE_FRACTION, behavior: 'smooth' });
  }, []);

  return { ref, ends, measure, page };
}
