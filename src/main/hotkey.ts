import { globalShortcut } from 'electron';
import { comboOverlaps, toAccelerator } from '../shared/shortcuts';

/** The OS-wide hotkeys: ask about the selection, quick export, and box a screen region to ask about. */
export type HotkeySlot = 'main' | 'quickExport' | 'region';

const registered = new Map<HotkeySlot, string>();
let _paused = false;

export function setHotkeyPaused(paused: boolean): void {
  _paused = paused;
}

export function isHotkeyPaused(): boolean {
  return _paused;
}

/** A second press within this window is ignored. */
const HOTKEY_DEBOUNCE_MS = 1_000;

export function registerHotkey(slot: HotkeySlot, accelerator: string, handler: () => void): boolean {
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
      if (now - lastTrigger < HOTKEY_DEBOUNCE_MS) return;
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

/**
 * One key press for the OS, however it is spelt: on a Mac CommandOrControl is Command, so the
 * flow recorder's `CommandOrControl+Control+J` and the default `Command+Ctrl+J` are one combo.
 */
export function isSamePress(a: string, b: string): boolean {
  return comboOverlaps(a, b, process.platform === 'darwin');
}

/** Whether `next` is held by another OS hotkey slot; keeping one's own combo never collides. */
export function wouldCollide(next: string, currentOwn: string, ...otherSlots: string[]): boolean {
  if (isSamePress(next, currentOwn)) return false;
  return otherSlots.some((other) => isSamePress(next, other));
}

/**
 * Lets go of all three OS hotkeys. Rebinding them one after another (a restored backup) would
 * otherwise refuse a combo that moves from a slot not yet rebound to one bound before it.
 */
export function releaseHotkeySlots(): void {
  for (const accelerator of registered.values()) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
    }
  }
  registered.clear();
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
