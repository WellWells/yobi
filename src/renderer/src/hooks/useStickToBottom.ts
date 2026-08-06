import { useCallback, useEffect, useRef, type RefObject } from 'react';

const NEAR_BOTTOM_PX = 80;

export function isNearBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX;
}

function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let element = node?.parentElement ?? null; element; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element);
    if (overflowY === 'auto' || overflowY === 'scroll') return element;
  }
  return null;
}

export function useStickToBottom(
  contentRef: RefObject<HTMLElement | null>,
  rebindKey: string,
): { follow: () => void; release: () => void } {
  const following = useRef(false);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const content = contentRef.current;
    const container = scrollParent(content);
    if (!content || !container) return;
    containerRef.current = container;

    let lastTop = container.scrollTop;
    const onScroll = (): void => {
      const top = container.scrollTop;
      const scrolledUp = top < lastTop - 1;
      lastTop = top;
      const atBottom = isNearBottom(top, container.scrollHeight, container.clientHeight);
      if (atBottom) following.current = true;
      else if (scrolledUp) following.current = false;
    };
    container.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      if (!following.current) return;
      container.scrollTop = container.scrollHeight;
      lastTop = container.scrollTop;
    });
    observer.observe(content);

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

  const release = useCallback((): void => { following.current = false; }, []);

  return { follow, release };
}
