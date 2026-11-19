import { useCallback, useRef, useState } from 'react';

/**
 * An element's width (border box, whole pixels), and nothing else about its box. Mantine's
 * `useElementSize` keeps the whole rect, so a change of height or position redraws its owner too,
 * and it reports the first size only after a frame: the flow editor drew itself three more times
 * just after opening. This one measures as the element attaches — the state update
 * joins that commit's own — and then only when the width really changes.
 */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    // A hidden view (`display: none`) measures 0: keep the last width, so hiding and showing the
    // view again redraws nothing.
    const measure = (): void => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  return [ref, width];
}
