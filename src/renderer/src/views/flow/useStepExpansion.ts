import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** A new step, or a loop or condition with its end marker; more at once is a whole flow replaced. */
const MAX_OPENED_ON_ADD = 2;

export interface StepExpansion {
  expanded: ReadonlySet<string>;
  toggle: (stepId: string) => void;
  setAll: (stepIds: readonly string[], open: boolean) => void;
}

/**
 * Which step cards are drawn open. A flow opens with every card folded; a step that appears while
 * it is open (one added, or a loop with its end) opens, and so does a step the last run failed on.
 * The editor stays mounted across flows, so a different flow id starts over.
 */
export function useStepExpansion(flowId: string, stepIds: readonly string[], failedIds: readonly string[]): StepExpansion {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(failedIds));
  const seen = useRef({ flowId, ids: new Set(stepIds) });
  const stepKey = stepIds.join('\n');
  const failedKey = failedIds.join('\n');

  // Layout effect: a step just added must not flash folded for a frame.
  useLayoutEffect(() => {
    const ids = stepKey ? stepKey.split('\n') : [];
    const before = seen.current;
    seen.current = { flowId, ids: new Set(ids) };
    if (before.flowId !== flowId) {
      setExpanded(new Set());
      return;
    }
    const added = ids.filter((id) => !before.ids.has(id));
    if (added.length > 0 && added.length <= MAX_OPENED_ON_ADD) {
      setExpanded((current) => new Set([...current, ...added]));
    }
  }, [flowId, stepKey]);

  useEffect(() => {
    if (!failedKey) return;
    const failed = failedKey.split('\n');
    setExpanded((current) => (failed.every((id) => current.has(id)) ? current : new Set([...current, ...failed])));
  }, [failedKey]);

  const toggle = useCallback((stepId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const setAll = useCallback((ids: readonly string[], open: boolean) => {
    setExpanded(open ? new Set(ids) : new Set());
  }, []);

  return { expanded, toggle, setAll };
}
