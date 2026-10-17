import { useCallback, useEffect, useState } from 'react';
import { ANSWER_SELECTOR } from '../utils/selectionSnapshot';

export interface ChatSelectionState {
  text: string;
  blockText: string;
  turnIndex: number | null;
  /** Wholly inside an answer's text, where it can be rewritten; a prompt or a title is not. */
  inAnswer: boolean;
  rect: { top: number; bottom: number; left: number; width: number };
}

const MAX_SELECTION_CHARS = 4_000;
const BLOCK_SELECTOR = 'p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6';

function elementFor(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function turnIndexFor(element: Element | null): number | null {
  const raw = element?.closest('[data-turn-index]')?.getAttribute('data-turn-index');
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

export function useChatSelection(
  containerRef: React.RefObject<HTMLElement | null>,
): { selection: ChatSelectionState | null; clear: () => void } {
  const [selection, setSelection] = useState<ChatSelectionState | null>(null);

  const clear = useCallback((): void => setSelection(null), []);

  const read = useCallback((): void => {
    const container = containerRef.current;
    const current = window.getSelection();
    if (!container || !current || current.isCollapsed || current.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = current.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    // Text selected while typing (an answer being edited, the find field) is not something to quote.
    const active = document.activeElement;
    if ((active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && container.contains(active)) {
      setSelection(null);
      return;
    }
    // Nor is text inside the answer editor or a rewrite's result card: those have their own actions.
    if (elementFor(range.commonAncestorContainer)?.closest('[data-selection-ignore]')) {
      setSelection(null);
      return;
    }
    const text = current.toString().trim();
    const rect = range.getBoundingClientRect();
    if (!text || (rect.width === 0 && rect.height === 0)) {
      setSelection(null);
      return;
    }
    const element = elementFor(range.commonAncestorContainer);
    setSelection({
      text: text.slice(0, MAX_SELECTION_CHARS),
      blockText: element?.closest(BLOCK_SELECTOR)?.textContent ?? '',
      turnIndex: turnIndexFor(element),
      inAnswer: Boolean(element?.closest(ANSWER_SELECTOR)),
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
    });
  }, [containerRef]);

  useEffect(() => {
    const onSettle = (): void => read();
    const onSelectionChange = (): void => {
      const current = window.getSelection();
      if (!current || current.isCollapsed) setSelection(null);
    };
    document.addEventListener('mouseup', onSettle);
    document.addEventListener('keyup', onSettle);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('mouseup', onSettle);
      document.removeEventListener('keyup', onSettle);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [read]);

  useEffect(() => {
    if (!selection) return;
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        read();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [selection, containerRef, read]);

  return { selection, clear };
}
