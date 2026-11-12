import { useCallback, useRef, useState } from 'react';

/**
 * Whether an element is narrower than `below`, by its own width (a container's layout, not the
 * window's). Unlike Mantine's `useElementSize` it changes state only when the width crosses the
 * line, so a window being dragged wider or narrower does not re-render the component on every
 * pixel. A width of 0 (the element hidden, `display: none`) keeps the last answer: a dialog that
 * closes and reopens does not flip its layout and back.
 */
export function useWidthBelow<T extends HTMLElement = HTMLDivElement>(below: number): [(node: T | null) => void, boolean] {
  const [narrow, setNarrow] = useState(false);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) setNarrow(width < below);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, [below]);
  return [ref, narrow];
}
