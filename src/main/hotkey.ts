import { globalShortcut } from 'electron';
import { canonicalise, toAccelerator } from '../shared/shortcuts';

export type HotkeySlot = 'main' | 'quickExport';

const registered = new Map<HotkeySlot, string>();
let _paused = false;

export function setHotkeyPaused(paused: boolean): void {
  _paused = paused;
}

export function isHotkeyPaused(): boolean {
  return _paused;
}

export function registerHotkey(
  slot: HotkeySlot,
  accelerator: string,
  handler: () => void,
  debounceMs: number = 1000,
): boolean {
  const previous = registered.get(slot);
  if (previous) {
    try {
      globalShortcut.unregister(previous);
    } catch {
    }
    registered.delete(slot);
  }

  const target = toAccelerator(accelerator.trim(), process.platform === 'darwin');
  if (!target) return true;

  let lastTrigger = 0;

  let ok = false;
  try {
    ok = globalShortcut.register(target, () => {
      if (_paused) return;
      const now = Date.now();
      if (now - lastTrigger < debounceMs) return;
      lastTrigger = now;
      handler();
    });
  } catch {
    ok = false;
  }

  if (ok) {
    registered.set(slot, target);
  }

  return ok;
}

export function isSameAccelerator(a: string, b: string): boolean {
  const left = canonicalise(a);
  const right = canonicalise(b);
  return left.length > 0 && left === right;
}

export function wouldCollide(next: string, currentOwn: string, otherSlot: string): boolean {
  if (isSameAccelerator(next, currentOwn)) return false;
  return isSameAccelerator(next, otherSlot);
}

export function ownsAccelerator(accelerator: string): boolean {
  const target = toAccelerator(accelerator.trim(), process.platform === 'darwin');
  if (!target) return false;
  try {
    return globalShortcut.isRegistered(target);
  } catch {
    return false;
  }
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll();
  registered.clear();
}
