import { useEffect } from 'react';
import { useFlowOutlineStore } from '../../../store/useFlowOutlineStore';

/**
 * Which step cards the editor shows, written to the outline store as the first and last for the
 * outline's rail. Never scrolls anything and never changes the selection; while a jump is under
 * way the rail follows where it lands, not the cards it passes.
 */
export function useReadingPosition(box: HTMLElement | null, flowId: string, stepKey: string): void {
  const setVisible = useFlowOutlineStore((s) => s.setVisible);
  useEffect(() => {
    if (!box || typeof IntersectionObserver === 'undefined') return undefined;
    const shown = new Set<Element>();
    let frame = 0;
    const publish = (): void => {
      frame = 0;
      const cards = [...box.querySelectorAll<HTMLElement>('[data-step-id]')].filter((card) => shown.has(card));
      const first = cards[0]?.dataset.stepId;
      const last = cards[cards.length - 1]?.dataset.stepId;
      setVisible(first && last ? { flowId, first, last } : null);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) shown.add(entry.target);
        else shown.delete(entry.target);
      }
      if (!frame) frame = requestAnimationFrame(publish);
    }, { root: box, threshold: 0 });
    box.querySelectorAll('[data-step-id]').forEach((card) => observer.observe(card));
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [box, flowId, stepKey, setVisible]);
}
