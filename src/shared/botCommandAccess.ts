/**
 * Who may run a flow's bot command.
 *
 * Pairing is the only gate a flow command has ever had: once the bot has paired with someone,
 * every registered command is theirs. That is the wrong default for a command reading a private
 * data source — the LINE message store is the whole reason this exists — but it is the rule
 * every existing flow was written under, so an EMPTY list keeps meaning "anyone paired". A
 * non-empty list narrows the command to exactly those ids, on top of the pairing check rather
 * than instead of it.
 *
 * Ids are compared as strings across both platforms: Telegram's are numeric and LINE's start
 * with `U`, so one list can hold both without a namespace prefix.
 */
export function normalizeAllowedUserIds(raw: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw ?? []) {
    const id = String(entry).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isBotUserAllowed(allowedUserIds: readonly string[] | undefined, userId: string): boolean {
  const allowed = normalizeAllowedUserIds(allowedUserIds);
  if (allowed.length === 0) return true;
  return allowed.includes(String(userId).trim());
}
