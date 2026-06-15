import { globalShortcut } from 'electron';

let _currentAccelerator: string | null = null;
let _paused = false;

export function setHotkeyPaused(paused: boolean): void {
  _paused = paused;
}

export function registerHotkey(
  accelerator: string,
  handler: () => void,
  debounceMs: number = 1000,
): boolean {
  if (_currentAccelerator) {
    try {
      globalShortcut.unregister(_currentAccelerator);
    } catch {
    }
  }

  let lastTrigger = 0;

  const ok = globalShortcut.register(accelerator, () => {
    if (_paused) return;
    const now = Date.now();
    if (now - lastTrigger < debounceMs) return;
    lastTrigger = now;
    handler();
  });

  if (ok) {
    _currentAccelerator = accelerator;
  }

  return ok;
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll();
  _currentAccelerator = null;
}
