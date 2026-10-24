import { useLayoutEffect } from 'react';
import type React from 'react';
import styles from './useScrollEdgeFade.module.css';

/** Hidden content below this counts as none: zoomed windows scroll in fractional pixels. */
const EDGE_SLACK_PX = 1;

export interface EdgeFade {
  top: boolean;
  bottom: boolean;
}

/** Which edges of a vertical scroll container have content scrolled past them. */
export function edgeFade(scrollTop: number, clientHeight: number, scrollHeight: number): EdgeFade {
  return {
    top: scrollTop > EDGE_SLACK_PX,
    bottom: scrollTop + clientHeight < scrollHeight - EDGE_SLACK_PX,
  };
}

function setFlag(el: HTMLElement, name: string, on: boolean): void {
  if (on) el.setAttribute(name, '');
  else el.removeAttribute(name);
}

/**
 * Fades the top or bottom edge of a vertical scroll container while there is more list beyond
 * it. Returns the class to put on that container. The edges are written straight onto the
 * element as `data-fade-top` / `data-fade-bottom`, so scrolling never re-renders the list.
 */
export function useScrollEdgeFade(ref: React.RefObject<HTMLElement | null>): string {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const fade = edgeFade(el.scrollTop, el.clientHeight, el.scrollHeight);
      setFlag(el, 'data-fade-top', fade.top);
      setFlag(el, 'data-fade-bottom', fade.bottom);
      el.style.setProperty('--scroll-fade-bar', `${el.offsetWidth - el.clientWidth}px`);
    };
    // Rows come and go without the container changing size, so its children are watched too.
    const resize = new ResizeObserver(update);
    const watch = (): void => {
      resize.disconnect();
      resize.observe(el);
      for (const child of Array.from(el.children)) resize.observe(child);
      update();
    };
    const mutation = new MutationObserver(watch);
    mutation.observe(el, { childList: true });
    el.addEventListener('scroll', update, { passive: true });
    watch();
    return () => {
      el.removeEventListener('scroll', update);
      mutation.disconnect();
      resize.disconnect();
    };
  }, [ref]);
  return styles.fade;
}
