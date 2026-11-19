/**
 * A knowledge base: a folder of the user's own documents that `/agent` searches and cites, under a
 * name the user picks (人資, 研發). Stored in config.json as `knowledgeBases`; the index lives apart
 * (`<userData>/knowledge/<id>.sqlite`) and is rebuilt from the folder whenever it is missing.
 */

export interface KnowledgeBase {
  /** Stable, also the index file's name and the bot grant's (`kb:<id>`). */
  id: string;
  /** What the user calls it; also how a message names it. */
  name: string;
  folder: string;
  /** Other names a message may use for it (HR, 人事). */
  aliases: string[];
}

export const KB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const KB_NAME_MAX = 40;
export const KB_ALIASES_MAX = 8;

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, KB_NAME_MAX) : '';
}

export function normalizeKnowledgeBases(raw: unknown): KnowledgeBase[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeBase[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<Record<keyof KnowledgeBase, unknown>>;
    const id = typeof obj.id === 'string' ? obj.id : '';
    const name = cleanName(obj.name);
    const folder = typeof obj.folder === 'string' ? obj.folder.trim() : '';
    if (!KB_ID_PATTERN.test(id) || ids.has(id) || !name || !folder) continue;
    ids.add(id);
    const aliases = Array.isArray(obj.aliases)
      ? [...new Set(obj.aliases.map(cleanName).filter((alias) => alias && alias !== name))].slice(0, KB_ALIASES_MAX)
      : [];
    out.push({ id, name, folder, aliases });
  }
  return out;
}

/*
 * In the composer a knowledge base sits among the connectors, as `kb:<id>`: picked from the same
 * menu, shown as the same chip, attached by name with the same undo, remembered per conversation.
 * Main splits these ids off at the boundary (`splitKnowledgeIds`); they never reach a connector lookup.
 */
export const KB_CONNECTOR_PREFIX = 'kb:';

export function kbConnectorId(id: string): string {
  return `${KB_CONNECTOR_PREFIX}${id}`;
}

export function splitKnowledgeIds(ids: readonly string[] | undefined): { knowledge: string[]; servers: string[] } {
  const knowledge: string[] = [];
  const servers: string[] = [];
  for (const raw of ids ?? []) {
    const id = raw.trim();
    if (!id) continue;
    if (!id.startsWith(KB_CONNECTOR_PREFIX)) {
      servers.push(id);
      continue;
    }
    const kbId = id.slice(KB_CONNECTOR_PREFIX.length);
    if (KB_ID_PATTERN.test(kbId) && !knowledge.includes(kbId)) knowledge.push(kbId);
  }
  return { knowledge, servers };
}

/**
 * The documents a "knowledge base only" conversation is limited to, by base id: relative paths as
 * the index names them (a draft and the signed version, or two clients' contracts, in
 * one base — "answer from these two only"). A base without an entry is searched whole.
 */
export type KnowledgeFileScope = Readonly<Record<string, readonly string[]>>;

/** Files one scope names at most, over all its bases: a question about a few documents, not a second base. */
export const KB_FILE_SCOPE_MAX = 200;

/**
 * A scope as stored or sent, made safe to use: only bases in `kbIds`, only non-empty relative paths
 * (they are compared with the index, never opened), at most `KB_FILE_SCOPE_MAX`; undefined when
 * nothing is left — which means no limit, so a caller that asked for one must check `kbIds` first.
 */
export function readKnowledgeFileScope(raw: unknown, kbIds: readonly string[]): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const scope: Record<string, string[]> = {};
  let count = 0;
  for (const [kbId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!kbIds.includes(kbId) || !Array.isArray(value)) continue;
    const files = [...new Set(value.filter((rel): rel is string => typeof rel === 'string' && rel.length > 0 && rel.length <= 1_024 && !rel.includes('\0')))]
      .slice(0, KB_FILE_SCOPE_MAX - count);
    if (files.length === 0) continue;
    scope[kbId] = files;
    count += files.length;
  }
  return count > 0 ? scope : undefined;
}

/*
 * A cited passage's link. Not a file:// URL: the chip and the Markdown link would hand that to the
 * system, which opens any path; this one is opened by main only after checking that the path is a
 * file inside that knowledge base's folder (`openKbCitation`).
 */
export const KB_CITATION_SCHEME = 'yobi-kb:';

export function kbCitationUrl(kbId: string, rel: string): string {
  return `${KB_CITATION_SCHEME}//${kbId}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

export function parseKbCitationUrl(url: string): { kbId: string; rel: string } | null {
  if (!url.startsWith(`${KB_CITATION_SCHEME}//`)) return null;
  const rest = url.slice(KB_CITATION_SCHEME.length + 2).split('#')[0];
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const kbId = rest.slice(0, slash);
  if (!KB_ID_PATTERN.test(kbId)) return null;
  try {
    const rel = rest.slice(slash + 1).split('/').map(decodeURIComponent).join('/');
    if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) return null;
    return { kbId, rel };
  } catch {
    return null;
  }
}

const KB_MARKDOWN_LINK = /\[((?:\\.|[^\]\\])*)\]\(<?yobi-kb:\/\/[^)>\s]*>?\)/g;

/**
 * An answer for a chat app: a link to a document only opens on this computer, so it becomes its
 * words (`[\[1\]](<yobi-kb://…>)` → `[1]`, a source line keeps the file name).
 */
export function withoutKbLinks(markdown: string): string {
  return markdown.replace(KB_MARKDOWN_LINK, (_match, label: string) => label.replace(/\\(.)/g, '$1'));
}

export function isKbCitationUrl(url: string): boolean {
  return parseKbCitationUrl(url) !== null;
}

function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\s_-]+$/u;

/** Where a name occurs in the text as a name: Latin names on word boundaries, others anywhere. */
function mentions(text: string, name: string): boolean {
  const needle = fold(name);
  if ([...needle].length < 2) return false;
  if (!LATIN_ONLY.test(needle)) return text.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

/**
 * The knowledge bases a message names (by name or alias), in settings order. A name inside a code
 * block, a quote or a link is not the user naming it; the caller strips those first.
 */
export function knowledgeBasesNamedIn(text: string, bases: readonly KnowledgeBase[]): string[] {
  const folded = fold(text);
  return bases.filter((base) => [base.name, ...base.aliases].some((name) => mentions(folded, name))).map((base) => base.id);
}
