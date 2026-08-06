import { globalShortcut } from 'electron';

export type HotkeySlot = 'main' | 'quickExport';

const registered = new Map<HotkeySlot, string>();
let _paused = false;

export function setHotkeyPaused(paused: boolean): void {
  _paused = paused;
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

  const target = accelerator.trim();
  if (!target) return true;

  let lastTrigger = 0;

  const ok = globalShortcut.register(target, () => {
    if (_paused) return;
    const now = Date.now();
    if (now - lastTrigger < debounceMs) return;
    lastTrigger = now;
    handler();
  });

  if (ok) {
    registered.set(slot, target);
  }

  return ok;
}

/**
 * Whether two accelerators would fight over the same combination. Blank never collides —
 * that is how a slot is switched off.
 */
export function isSameAccelerator(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  return left.length > 0 && left === right;
}

/**
 * Whether giving one slot `next` would fight with the other slot's binding.
 *
 * Only a *change* can introduce a collision. An install that already has both slots on the
 * same combination — nothing used to check — has to stay editable, otherwise every later save
 * from either field would be refused and the user could never break the tie.
 */
export function wouldCollide(next: string, currentOwn: string, otherSlot: string): boolean {
  if (isSameAccelerator(next, currentOwn)) return false;
  return isSameAccelerator(next, otherSlot);
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll();
  registered.clear();
}
