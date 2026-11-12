import { useCallback, useRef, useState } from 'react';

/**
 * Whether an element has been on screen at least once. A long flow with every card open mounts
 * every preview and chat list at the same time; reads wait until their card scrolls into view,
 * and stay done once it has (scrolling past again does not read again). Without
 * IntersectionObserver (tests, old engines) everything counts as seen.
 */
export function useSeenOnScreen<T extends HTMLElement = HTMLDivElement>(): [(node: T | null) => void, boolean] {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  const observerRef = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setSeen(true);
      observer.disconnect();
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  return [ref, seen];
}
