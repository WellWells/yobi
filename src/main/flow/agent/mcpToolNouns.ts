import type { McpTool } from '../../mcp/mcpTypes';

/** How many nouns a summary line lists, and how long that list may get in characters. */
export const COVERS_MAX_NOUNS = 8;
export const COVERS_MAX_CHARS = 96;
/** A single noun longer than this is a mangled identifier, not a word the model can match on. */
const NOUN_MAX_CHARS = 20;

/** Words that say what a tool DOES. They carry no scent of what the server is about. */
const VERBS = new Set([
  'list', 'get', 'search', 'find', 'create', 'add', 'update', 'edit', 'delete', 'remove', 'send', 'save',
  'read', 'set', 'fetch', 'query', 'lookup', 'look', 'retrieve', 'show', 'display', 'view', 'open', 'close',
  'reply', 'forward', 'rename', 'move', 'copy', 'duplicate', 'reorder', 'apply', 'empty', 'clear', 'mark',
  'write', 'post', 'put', 'patch', 'modify', 'insert', 'upsert', 'upload', 'download', 'archive', 'restore',
  'run', 'execute', 'start', 'stop', 'check', 'locate', 'inspect', 'describe', 'count', 'browse', 'make',
  'transition', 'convert', 'spawn', 'wait', 'share', 'invite', 'assign', 'link', 'sync',
]);

/** Prepositions and articles: the head noun sits before them ("searchConfluenceUsingCql"). */
const BREAKS = new Set(['to', 'for', 'from', 'by', 'with', 'using', 'in', 'on', 'of', 'into', 'at', 'via', 'as', 'the', 'a', 'an', 'and', 'or']);

/** Trailing words that qualify a noun rather than name one ("lookupJiraAccountId"). */
const FILLER = new Set(['id', 'ids', 'info', 'details', 'detail', 'metadata', 'meta', 'data', 'tool', 'tools', 'all', 'my', 'new', 'recent', 'latest']);

/** camelCase, PascalCase, snake_case, kebab-case and dotted names, lowercased. */
function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !/^\d+$/.test(word));
}

/** Naive, and only ever used as a dedupe key: "messages" and "message" are one noun. */
function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** The head noun of one tool name, or null when the name is only verbs, filler or the server's own name. */
function headNoun(name: string, ownName: ReadonlySet<string>): string | null {
  const words = splitWords(name).filter((word) => !VERBS.has(word) && !ownName.has(word));
  while (words.length > 0 && BREAKS.has(words[0])) words.shift();
  const cut = words.findIndex((word) => BREAKS.has(word));
  const head = cut === -1 ? words : words.slice(0, cut);
  while (head.length > 0 && FILLER.has(head[head.length - 1])) head.pop();
  const noun = head[head.length - 1];
  return noun && noun.length <= NOUN_MAX_CHARS ? noun : null;
}

/**
 * What a server is about, as nouns read off its tool names, in order of first appearance. A few
 * sample tool names cannot describe a large server; nouns are cheap and match the words users write.
 */
export function toolNouns(tools: readonly McpTool[], serverName: string): string[] {
  const ownName = new Set(splitWords(serverName));
  const shown = new Map<string, string>();
  for (const tool of tools) {
    const noun = headNoun(tool.name, ownName);
    if (!noun) continue;
    const key = singular(noun);
    const seen = shown.get(key);
    // A plural reads as "this server holds many of these", so it wins over an earlier singular.
    if (seen === undefined || (seen === key && noun !== key)) shown.set(key, noun);
  }
  const nouns: string[] = [];
  let length = 0;
  for (const noun of shown.values()) {
    const cost = noun.length + (nouns.length > 0 ? 2 : 0);
    if (nouns.length >= COVERS_MAX_NOUNS || length + cost > COVERS_MAX_CHARS) break;
    nouns.push(noun);
    length += cost;
  }
  return nouns;
}
