/*
 * Reading what the Notion MCP server returns. `notion-fetch` answers with JSON whose `text` wraps
 * the page in `<page><properties>{json}</properties>…<content>…</content></page>`; errors come back
 * as the Notion API's error JSON.
 */

export interface NotionPage {
  /** 32 lowercase hex digits. */
  page: string;
  url: string;
  title: string;
  icon?: string;
  /** The page content, Notion-flavored Markdown, exactly as Notion matches `update_content` against it. */
  body: string;
  /** `page_last_edited_at`, changes on every edit. */
  editedAt: string;
  /** Notion left blocks out (truncated, or block types the API cannot express). */
  partial: boolean;
}

export type NotionFetchError = 'notPage' | 'unreadable';

export type NotionCallError = 'noMatch' | 'ambiguous' | 'notConnected' | 'auth' | 'notFound' | 'failed';

export interface NotionSearchHit {
  page: string;
  url: string;
  title: string;
  icon?: string;
  /** Already kept as a document in Yobi: choosing it opens that one. */
  kept?: boolean;
}

/** One stretch of a sidebar list (`notion-list-*-pages`); `next` asks for the stretch after it. */
export interface NotionPageList {
  hits: NotionSearchHit[];
  next: string | null;
}

const HEX32_RE = /([0-9a-f]{32})(?![0-9a-f])/i;
const UUID_RE = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/i;

/** A page id from a Notion URL, a dashed UUID or 32 hex digits; null for anything else. */
export function parseNotionPageId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let target = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase();
      const notion = host === 'notion.so' || host.endsWith('.notion.so') || host === 'notion.site'
        || host.endsWith('.notion.site') || host === 'notion.com' || host.endsWith('.notion.com');
      if (!notion) return null;
      // The page is the last id in the path; `?p=` (a page opened as a peek) wins over it.
      target = url.searchParams.get('p') ?? url.pathname;
    } catch {
      return null;
    }
  }
  const uuid = UUID_RE.exec(target);
  if (uuid) return uuid.slice(1).join('').toLowerCase();
  const matches = [...target.matchAll(new RegExp(HEX32_RE.source, 'gi'))];
  const last = matches.at(-1)?.[1];
  return last ? last.toLowerCase() : null;
}

function between(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start < 0 || end < start + open.length) return null;
  return text.slice(start + open.length, end);
}

function stripEdgeNewlines(text: string): string {
  return text.replace(/^\n/, '').replace(/\n$/, '');
}

function iconOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const icon = value as { type?: unknown; emoji?: unknown };
  return icon.type === 'emoji' && typeof icon.emoji === 'string' && icon.emoji ? icon.emoji : undefined;
}

export function parseFetchResult(raw: string): NotionPage | { error: NotionFetchError } {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { error: 'unreadable' };
    data = parsed as Record<string, unknown>;
  } catch {
    return { error: 'unreadable' };
  }
  const metadata = data.metadata as { type?: unknown } | undefined;
  if (metadata?.type !== 'page') return { error: 'notPage' };
  const text = typeof data.text === 'string' ? data.text : '';
  const url = typeof data.url === 'string' ? data.url.replace(/\?pvs=\d+$/, '') : '';
  const page = parseNotionPageId(url);
  // The properties come first and the content last: the content is looked for after the
  // properties end, and runs to the last closing tag (a page may mention either tag in its text).
  const propsStart = text.indexOf('<properties>');
  const propsEnd = propsStart < 0 ? -1 : text.indexOf('</properties>', propsStart);
  const content = between(text.slice(propsEnd < 0 ? 0 : propsEnd), '<content>', '</content>');
  const editedAt = typeof data.page_last_edited_at === 'string' ? data.page_last_edited_at : '';
  if (!page || content === null || !editedAt) return { error: 'unreadable' };

  let title = '';
  const properties = propsStart < 0 || propsEnd < 0 ? null : text.slice(propsStart + '<properties>'.length, propsEnd);
  if (properties) {
    try {
      const value = (JSON.parse(properties) as { title?: unknown }).title;
      if (typeof value === 'string') title = value;
    } catch {
      // Fall back to the top-level title below.
    }
  }
  const icon = iconOf(data.icon);
  if (!title && typeof data.title === 'string') {
    title = icon && data.title.startsWith(`${icon} `) ? data.title.slice(icon.length + 1) : data.title;
  }
  const unknownBlocks = typeof data.unknown_block_count === 'number' ? data.unknown_block_count : 0;
  return {
    page,
    url,
    title: title.trim(),
    ...(icon ? { icon } : {}),
    body: stripEdgeNewlines(content),
    editedAt,
    partial: data.truncated === true || unknownBlocks > 0,
  };
}

/** What went wrong with a call, from the error text the server sent back. */
export function classifyNotionError(text: string): NotionCallError {
  if (/No matches found/i.test(text)) return 'noMatch';
  if (/Multiple matches found/i.test(text)) return 'ambiguous';
  if (/unauthori[sz]ed|invalid[_ ]token|\b401\b/i.test(text)) return 'auth';
  if (/object_not_found|Could not find|\b404\b/i.test(text)) return 'notFound';
  return 'failed';
}

/** Pages from a `notion-search` answer; databases and anything without a page id are left out. */
export function parseSearchResult(raw: string): NotionSearchHit[] {
  let results: unknown;
  try {
    results = (JSON.parse(raw) as { results?: unknown }).results;
  } catch {
    return [];
  }
  if (!Array.isArray(results)) return [];
  const hits: NotionSearchHit[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (entry.type !== undefined && entry.type !== 'page') continue;
    const url = typeof entry.url === 'string' ? entry.url.replace(/\?pvs=\d+$/, '') : '';
    const page = parseNotionPageId(typeof entry.id === 'string' ? entry.id : url);
    if (!page || seen.has(page)) continue;
    seen.add(page);
    // Only an emoji is shown (as text); an image URL or a Notion icon id is not.
    const icon = typeof entry.icon === 'string' && entry.icon && !/^(?:https?:|icons\/|\/)/.test(entry.icon) && entry.icon.length <= 16
      ? entry.icon
      : iconOf(entry.icon);
    hits.push({
      page,
      url: url || `https://www.notion.so/${page}`,
      title: typeof entry.title === 'string' ? entry.title : '',
      ...(icon ? { icon } : {}),
    });
  }
  return hits;
}

/** A `notion-list-*-pages` answer: the same entries as a search, plus the cursor to the next stretch. */
export function parsePageList(raw: string): NotionPageList {
  let next: unknown;
  try {
    next = (JSON.parse(raw) as { nextCursor?: unknown }).nextCursor;
  } catch {
    return { hits: [], next: null };
  }
  return { hits: parseSearchResult(raw), next: typeof next === 'string' && next ? next : null };
}
