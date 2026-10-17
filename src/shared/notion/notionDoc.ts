import { stringifyMarker } from '../conversationDoc';
import type { ConversationDoc, NotionLink, ThreadMeta } from '../conversationDoc';
import { spaceNotionBlocks } from './notionBlocks';
import type { NotionPage } from './notionFetch';

/*
 * A Notion page kept in Yobi: an outputs `.md` with the page title as H1, the thread marker carrying
 * `notion`, then the page content (spaced, see notionBlocks.ts). The marker is the same one a
 * conversation has, so version history, renaming and the sidebar treat the file like any other.
 */

const MARKER_LINE_RE = /^<!--\s*yobi:thread\s+(\{.*\})\s*-->\s*$/;

export interface NotionDocParts {
  title: string;
  thread: ThreadMeta & { notion: NotionLink };
  /** The spaced body: everything after the marker line, leading blank lines dropped. */
  body: string;
}

function isNotionLink(value: unknown): value is NotionLink {
  if (!value || typeof value !== 'object') return false;
  const link = value as Record<string, unknown>;
  return typeof link.server === 'string' && typeof link.page === 'string' && /^[0-9a-f]{32}$/.test(link.page)
    && typeof link.url === 'string' && typeof link.at === 'string';
}

/**
 * A page title as the H1 holds it: one line, never empty (the sidebar and the header show it).
 * Notion's title is compared through this, so the H1's own rewriting is never a change to send.
 */
export function titleText(title: string): string {
  return title.replace(/\s+/g, ' ').trim() || 'Untitled';
}

function titleLine(title: string): string {
  return `# ${titleText(title)}`;
}

function markerLine(thread: ThreadMeta): string {
  return `<!-- yobi:thread ${stringifyMarker({ ...thread, v: 1 })} -->`;
}

/** A new file for a fetched page. `id` is the conversation id its versions are kept under. */
export function buildNotionDocFile(page: NotionPage, server: string, id: string, at: string): string {
  const notion: NotionLink = { server, page: page.page, url: page.url, ...(page.icon ? { icon: page.icon } : {}), at };
  const body = spaceNotionBlocks(page.body);
  return `${titleLine(page.title)}\n${markerLine({ v: 1, id, notion })}\n${body ? `\n${body}\n` : ''}`;
}

/**
 * The parts of a Notion document, or null when `raw` is not one: the H1 must be the first line and
 * the thread marker, carrying `notion`, the second (the shape `buildNotionDocFile` writes). Anything
 * looser would let a conversation that quotes a marker in its text read as a document.
 */
export function notionDocParts(raw: string): NotionDocParts | null {
  const text = raw.replace(/\r\n?/g, '\n');
  const firstBreak = text.indexOf('\n');
  if (firstBreak < 0) return null;
  const secondBreak = text.indexOf('\n', firstBreak + 1);
  const h1 = /^#\s+(.+)$/.exec(text.slice(0, firstBreak));
  const marker = MARKER_LINE_RE.exec(text.slice(firstBreak + 1, secondBreak < 0 ? text.length : secondBreak));
  if (!h1 || !marker) return null;
  let thread: unknown;
  try {
    thread = JSON.parse(marker[1] ?? '');
  } catch {
    return null;
  }
  if (!thread || typeof thread !== 'object' || !isNotionLink((thread as { notion?: unknown }).notion)) return null;
  const body = secondBreak < 0 ? '' : text.slice(secondBreak + 1).replace(/^\n+/, '').replace(/\n+$/, '');
  return {
    title: (h1[1] ?? '').trim(),
    thread: { ...(thread as ThreadMeta & { notion: NotionLink }), v: 1 },
    body,
  };
}

export function isNotionDoc(raw: string): boolean {
  return notionDocParts(raw) !== null;
}

/**
 * A Notion document in the shape the answer tools work on: one turn, no question, the body as its
 * answer. Editing, selection rewrite and the result card then need nothing new; saving turn 0 of a
 * document writes its body (`editConversationResponse`).
 */
export function notionConversation(raw: string): ConversationDoc | null {
  const parts = notionDocParts(raw);
  if (!parts) return null;
  return {
    title: parts.title,
    provider: 'Notion',
    time: null,
    thread: parts.thread,
    turns: [{ prompt: '', response: parts.body, meta: {} }],
  };
}

/** The file with a new body (spaced) and title, its marker kept; `at` moves to `at`. */
export function writeNotionDoc(raw: string, change: { body?: string; title?: string; at: string; notion?: Partial<NotionLink> }): string | null {
  const parts = notionDocParts(raw);
  if (!parts) return null;
  const notion: NotionLink = { ...parts.thread.notion, ...change.notion, at: change.at };
  const body = (change.body ?? parts.body).replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
  return `${titleLine(change.title ?? parts.title)}\n${markerLine({ ...parts.thread, notion })}\n${body ? `\n${body}\n` : ''}`;
}
