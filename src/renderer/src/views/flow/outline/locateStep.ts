import { stepDomId } from '../StepCard';

/** Shows a step card in the open editor (opens folded blocks around it), opening its form when asked; the step list registers it while it is mounted. */
type Expander = (stepId: string, expand: boolean) => void;
let expander: Expander | null = null;

export function setStepExpander(next: Expander | null): void {
  expander = next;
}

/** The editor's scroll box, where its cards are; null before the editor is drawn. */
function scrollBoxOf(card: HTMLElement): HTMLElement | null {
  let node = card.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

export interface LocateOptions {
  /** Open its form as well (not for steps that have none). */
  expand?: boolean;
  /** Move the keyboard focus to the card's title button. */
  focus?: boolean;
}

/**
 * Brings a step card into view in the editor, the one way every jump does it (the outline, the
 * band's "failed at step N", search results): a card whose header is already fully in view is
 * left where it is; otherwise it scrolls to just under the band (the card's scroll-margin), smooth
 * within a screen and a half, a jump further than that so the observers do not fire all the way.
 */
export function locateStep(stepId: string, options: LocateOptions = {}): void {
  expander?.(stepId, Boolean(options.expand));
  // After the expand has been drawn.
  requestAnimationFrame(() => {
    const card = document.getElementById(stepDomId(stepId));
    if (!card) return;
    const box = scrollBoxOf(card);
    const header = card.firstElementChild instanceof HTMLElement ? card.firstElementChild : card;
    if (box) {
      const boxRect = box.getBoundingClientRect();
      const headRect = header.getBoundingClientRect();
      const margin = parseFloat(getComputedStyle(card).scrollMarginTop) || 0;
      const inView = headRect.top >= boxRect.top + margin && headRect.bottom <= boxRect.bottom;
      if (!inView) {
        // The box's own scroll, not scrollIntoView: that also scrolls the clipped ancestors.
        const offset = card.getBoundingClientRect().top - boxRect.top - margin;
        box.scrollTo({ top: box.scrollTop + offset, behavior: Math.abs(offset) < boxRect.height * 1.5 ? 'smooth' : 'auto' });
      }
    }
    if (options.focus) {
      card.querySelector<HTMLElement>('[data-step-title]')?.focus({ preventScroll: true });
    }
  });
}
