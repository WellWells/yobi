import { useEffect, useRef } from 'react';
import { trackActivity, type ActivityState } from '../utils/recapState';

const INPUT_EVENTS = ['keydown', 'pointerdown', 'wheel', 'pointermove'] as const;

/** Reports how long the user was gone each time they come back to the window. */
export function useWindowAway(onReturn: (awayMs: number) => void): void {
  const callback = useRef(onReturn);
  callback.current = onReturn;

  useEffect(() => {
    let activity: ActivityState = { lastActiveAt: Date.now(), focused: document.hasFocus() };
    const handle = (event: 'focus' | 'blur' | 'input'): void => {
      const next = trackActivity(activity, event, Date.now());
      activity = next.state;
      if (next.awayMs !== null) callback.current(next.awayMs);
    };
    const onFocus = (): void => handle('focus');
    const onBlur = (): void => handle('blur');
    const onInput = (): void => handle('input');
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    for (const name of INPUT_EVENTS) window.addEventListener(name, onInput, { capture: true, passive: true });
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      for (const name of INPUT_EVENTS) window.removeEventListener(name, onInput, { capture: true });
    };
  }, []);
}
