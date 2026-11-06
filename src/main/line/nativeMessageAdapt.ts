/**
 * Rewrites line-cli's CLI wording in messages coming from the native core into Yobi's tool wording,
 * so the model is never told to run a command or pass a flag that does not exist here.
 */

/** Converts line-cli CLI phrasing (`--reply-to`, `line read X`, `line <cmd>`) to Yobi tool names. */
export function adaptMessage(s: string): string {
  return s
    .replace(/--reply-to\b/g, 'reply_to')
    .replace(/--allow-duplicate\b/g, 'allow_duplicate')
    .replace(/\bline read (\S+)/g, 'line_get_history with chat_id $1')
    // Only command-like contexts (start of text, a backtick, "run/use/try/with line status"): never prose.
    .replace(
      /(^|`|\b(?:run|use|try|with) )line (history|unread|search|status|send|download|preview|members|stats)\b/g,
      (_m, pre: string, cmd: string) => `${pre}line_${cmd === 'history' ? 'get_history' : cmd === 'unread' ? 'get_unread' : cmd}`,
    );
}
