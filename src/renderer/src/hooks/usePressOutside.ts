import { useEffect, useRef, type RefObject } from 'react';

/** Menus and tooltips are portalled out of whatever opened them; a press in one still belongs to it. */
const PORTALLED = '.mantine-Menu-dropdown, .mantine-Popover-dropdown, .mantine-Tooltip-tooltip';

/**
 * Calls `onOutside` for a press outside every element in `refs` while `active`. Presses in a
 * portalled menu (the model picker inside the writing tools) count as inside.
 */
export function usePressOutside(
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
  onOutside: (target: Element) => void,
  active: boolean,
): void {
  const handler = useRef(onOutside);
  handler.current = onOutside;
  const targets = useRef(refs);
  targets.current = refs;

  useEffect(() => {
    if (!active) return undefined;
    const onPress = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(PORTALLED)) return;
      if (targets.current.some((ref) => ref.current?.contains(target))) return;
      handler.current(target);
    };
    document.addEventListener('mousedown', onPress, true);
    return () => document.removeEventListener('mousedown', onPress, true);
  }, [active]);
}
