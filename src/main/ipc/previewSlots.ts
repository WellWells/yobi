/**
 * One read in flight per field of a setup form: keyed by the asking window and the field's slot.
 * A newer read for the same field stops the one still running, so typing never piles up requests.
 */
export interface PreviewSlots {
  /** Runs `read` with a signal that a newer read for the same slot (or `cancel`) aborts. */
  run: <T>(event: unknown, slot: unknown, read: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  cancel: (event: unknown, slot: unknown) => void;
}

const MAX_SLOT_CHARS = 100;

export function createPreviewSlots(): PreviewSlots {
  const running = new Map<string, AbortController>();

  function slotKey(event: unknown, slot: unknown): string | null {
    if (typeof slot !== 'string' || !slot || slot.length > MAX_SLOT_CHARS) return null;
    const senderId = (event as { sender?: { id?: number } } | null)?.sender?.id ?? 0;
    return `${senderId}:${slot}`;
  }

  function cancelKey(key: string): void {
    running.get(key)?.abort();
    running.delete(key);
  }

  return {
    async run(event, slot, read) {
      const key = slotKey(event, slot);
      const controller = new AbortController();
      if (key) {
        cancelKey(key);
        running.set(key, controller);
      }
      try {
        return await read(controller.signal);
      } finally {
        if (key && running.get(key) === controller) running.delete(key);
      }
    },
    cancel(event, slot) {
      const key = slotKey(event, slot);
      if (key) cancelKey(key);
    },
  };
}
