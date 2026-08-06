import { useEffect, useState } from 'react';
import { isTypingTarget } from '../utils/domUtils';

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
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return held;
}
