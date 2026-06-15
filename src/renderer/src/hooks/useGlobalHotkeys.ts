import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { isTypingTarget } from '../utils/domUtils';

function getScrollableHostWithin(container: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  let current: HTMLElement | null = target;
  while (current && container.contains(current)) {
    const scrollbarWidth = current.offsetWidth - current.clientWidth;
    if (current.scrollHeight > current.clientHeight && scrollbarWidth > 0) {
      return current;
    }
    current = current.parentElement;
  }
  const containerScrollbarWidth = container.offsetWidth - container.clientWidth;
  if (container.scrollHeight > container.clientHeight && containerScrollbarWidth > 0) {
    return container;
  }
  return null;
}

function isPointerOverVerticalScrollbar(container: HTMLElement, event: WheelEvent): boolean {
  const host = getScrollableHostWithin(container, event.target);
  if (!host) return false;
  const scrollbarWidth = host.offsetWidth - host.clientWidth;
  if (scrollbarWidth <= 0) return false;
  const rect = host.getBoundingClientRect();
  return event.clientX >= rect.right - scrollbarWidth;
}

interface UseGlobalHotkeysOptions {
  contentAreaRef: RefObject<HTMLDivElement | null>;
  onFocusPrompt: () => void;
  zoomInMarkdown: () => void;
  zoomOutMarkdown: () => void;
  resetMarkdownZoom: () => void;
}

export function useGlobalHotkeys({
  contentAreaRef,
  onFocusPrompt,
  zoomInMarkdown,
  zoomOutMarkdown,
  resetMarkdownZoom,
}: UseGlobalHotkeysOptions): void {
  const wheelZoomTickRef = useRef(0);

  useEffect(() => {
    const onFocusPromptHotkey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey && !event.shiftKey &&
        event.key.toLowerCase() === 'e'
      ) {
        event.preventDefault();
        onFocusPrompt();
      }
    };
    window.addEventListener('keydown', onFocusPromptHotkey);
    return () => window.removeEventListener('keydown', onFocusPromptHotkey);
  }, [onFocusPrompt]);

  useEffect(() => {
    const onZoomHotkey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key;
      const code = event.code;

      if (code === 'NumpadAdd' || key === '+' || key === '=') {
        event.preventDefault();
        zoomInMarkdown();
        return;
      }
      if (code === 'NumpadSubtract' || key === '-' || key === '_') {
        event.preventDefault();
        zoomOutMarkdown();
        return;
      }
      if (code === 'Numpad0' || key === '0') {
        event.preventDefault();
        resetMarkdownZoom();
      }
    };
    window.addEventListener('keydown', onZoomHotkey);
    return () => window.removeEventListener('keydown', onZoomHotkey);
  }, [resetMarkdownZoom, zoomInMarkdown, zoomOutMarkdown]);

  useEffect(() => {
    const onWheelZoom = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const contentArea = contentAreaRef.current;
      if (!contentArea) return;
      const target = event.target;
      if (!(target instanceof Node) || !contentArea.contains(target)) return;
      if (isPointerOverVerticalScrollbar(contentArea, event)) return;

      const now = Date.now();
      if (now - wheelZoomTickRef.current < 70) return;
      wheelZoomTickRef.current = now;

      if (event.deltaY < 0) {
        zoomInMarkdown();
        return;
      }
      if (event.deltaY > 0) {
        zoomOutMarkdown();
      }
    };

    window.addEventListener('wheel', onWheelZoom, { passive: false });
    return () => window.removeEventListener('wheel', onWheelZoom);
  }, [contentAreaRef, zoomInMarkdown, zoomOutMarkdown]);
}
