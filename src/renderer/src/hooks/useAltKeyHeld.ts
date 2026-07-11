import { useEffect, useState } from 'react';
import { isTypingTarget } from '../utils/domUtils';

// Tracks whether Alt (and only Alt) is currently held so the title bar can
// surface the Alt+<number> navigation hints. The guard mirrors the shortcut's
// own gate (Alt alone, not while typing) so the badges only show up when the
// shortcut would actually fire.
export function useAltKeyHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const sync = (event: KeyboardEvent): void => {
      const altOnly = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      setHeld(altOnly && !isTypingTarget(document.activeElement));
    };
    const clear = (): void => setHeld(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    // Alt+Tab (or any focus loss) can swallow the keyup, so reset on blur to
    // avoid the badges getting stuck on screen.
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return held;
}
