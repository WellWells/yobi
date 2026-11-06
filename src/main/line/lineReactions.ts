/** My own reaction in a stored message's reaction columns. */

function isCancelled(cancel: unknown): boolean {
  if (cancel === true) return true;
  if (typeof cancel === 'number') return Math.trunc(cancel) !== 0;
  return typeof cancel === 'string' && /^[+-]?\d+$/.test(cancel) && Number(cancel) !== 0;
}

function parsed(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The predefined code of my reaction, 0 for none. The list is the newer record: when it mentions me,
 * a leftover legacy entry does not count.
 */
export function ownReaction(status: string, legacy: string, own: ReadonlySet<string>): number {
  const list = (parsed(status) as { reactionList?: unknown } | null)?.reactionList;
  if (Array.isArray(list)) {
    let listed = false;
    for (const e of list as { reactor?: string; PredefinedType?: number; cancel?: unknown }[]) {
      if (!own.has(e?.reactor ?? '')) continue;
      listed = true;
      if (!isCancelled(e.cancel)) return Number(e.PredefinedType) || 0;
    }
    if (listed) return 0;
  }
  const old = parsed(legacy);
  if (old && typeof old === 'object') {
    for (const e of Object.values(old) as { fromUserMid?: string; reactionType?: { predefinedReactionType?: number } }[]) {
      if (own.has(e?.fromUserMid ?? '')) return Number(e.reactionType?.predefinedReactionType) || 0;
    }
  }
  return 0;
}
