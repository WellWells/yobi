import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useShortcutAction } from '../shortcuts/useShortcutAction';

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
  onCycleModel: () => void;
  onNewConversation: () => void;
  onOpenSearch: () => void;
  zoomInMarkdown: () => void;
  zoomOutMarkdown: () => void;
  resetMarkdownZoom: () => void;
}

export function useGlobalHotkeys({
  contentAreaRef,
  onFocusPrompt,
  onCycleModel,
  onNewConversation,
  onOpenSearch,
  zoomInMarkdown,
  zoomOutMarkdown,
  resetMarkdownZoom,
}: UseGlobalHotkeysOptions): void {
  const wheelZoomTickRef = useRef(0);

  useShortcutAction('chat.newConversation', () => onNewConversation(), 'chat');
  useShortcutAction('nav.quickSwitch', () => onOpenSearch(), 'chat');
  useShortcutAction('chat.cycleModel', () => onCycleModel(), 'chat');
  useShortcutAction('chat.focusComposer', () => onFocusPrompt(), 'chat');

  useShortcutAction('view.zoomIn', () => zoomInMarkdown(), 'chat');
  useShortcutAction('view.zoomOut', () => zoomOutMarkdown(), 'chat');
  useShortcutAction('view.zoomReset', () => resetMarkdownZoom(), 'chat');

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
