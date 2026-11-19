/**
 * A list read afresh (an IPC answer, a broadcast) with each entry equal to one held kept as the
 * held object, and the held list itself when nothing changed: memoised rows and memos keyed on the
 * list then skip what did not change. Equality is by value (JSON), so it suits plain data only.
 */
export function keepUnchanged<T>(held: readonly T[], incoming: readonly T[], keyOf: (entry: T) => string): T[] {
  const byKey = new Map(held.map((entry) => [keyOf(entry), entry]));
  let changed = held.length !== incoming.length;
  const next = incoming.map((entry, index) => {
    const before = byKey.get(keyOf(entry));
    if (before !== undefined && (before === entry || JSON.stringify(before) === JSON.stringify(entry))) {
      if (held[index] !== before) changed = true;
      return before;
    }
    changed = true;
    return entry;
  });
  return changed ? next : (held as T[]);
}
