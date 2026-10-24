/**
 * Schema keywords an MCP server (Yobi's own) can put on a tool argument: the other names models
 * write it as (`origin` for `from`), and words that mean one of its enum options (`TRTC` for
 * `taipei`). Models often call a tool from a one-line summary without its schema in view; these
 * put such a call right before it is checked, at no cost in prompt space. Read by
 * `flow/agent/mcpTools.ts`.
 */
export const ALSO_NAMED = 'x-also-named';
export const ENUM_ALIASES = 'x-enum-aliases';

/** An alias is compared apart from case, width, spaces, `_` and `-` ("Taoyuan Airport MRT"). */
export function aliasKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, '');
}

/** The option `word` stands for in an alias table, or null. */
export function lookupAlias(table: Readonly<Record<string, unknown>>, word: string): string | null {
  const key = aliasKey(word);
  const hit = Object.entries(table).find(([alias]) => aliasKey(alias) === key)?.[1];
  return typeof hit === 'string' ? hit : null;
}
