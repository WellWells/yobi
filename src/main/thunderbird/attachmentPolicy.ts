/**
 * Yobi's one rule on top of the Thunderbird bridge: a file attached to outgoing mail must be a file the
 * `/agent` sandbox would let the model read. The bridge reads the file itself, so the check runs
 * before the call leaves Yobi and the bridge is handed the absolute path that passed — a relative path
 * would otherwise be resolved twice, against two different folders.
 *
 * Keyed on the `attachments` argument rather than on tool names, so a compose tool the add-on adds
 * later is covered without a change here.
 */

/** Resolves a path the model supplied to the file it names, or says why it may not be read. */
export type AttachmentPathGuard = (raw: string) => Promise<{ path: string } | { denied: string }>;

export type CallVerdict = { args: Record<string, unknown> } | { denied: string };

/** `key` names the argument holding the paths (`attachments` for mail, `file` for line_send). */
export async function applyAttachmentPolicy(
  args: Record<string, unknown>,
  guard: AttachmentPathGuard,
  key = 'attachments',
): Promise<CallVerdict> {
  const list = args[key];
  if (!Array.isArray(list)) return { args };
  const checked: unknown[] = [];
  for (const entry of list) {
    // Inline `{ name, contentType, base64 }` data holds no path to check.
    if (typeof entry !== 'string') {
      checked.push(entry);
      continue;
    }
    const verdict = await guard(entry);
    if ('denied' in verdict) return verdict;
    checked.push(verdict.path);
  }
  return { args: { ...args, [key]: checked } };
}
