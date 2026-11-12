/**
 * A public page through a bot, read once inside the queued run so Stop reaches it and no other chat
 * waits on it. A link on its own that reads complete goes out as it is, with no model; anything else
 * goes to the agent with what was read, or why nothing was, so the page is never read twice.
 *
 * The reader is loaded on the first link, like `pageUrlPrompt.ts`: a chat run has no use for it.
 */
import { BUILTIN_PAGE_SERVER_ID } from '../../shared/builtinConnectors';
import { linksIn, asksAboutLink } from '../../shared/linkQuestion';
import type { LinkSiteFilter } from '../../shared/linkRecognition';
import { matchLink } from '../../shared/linkSites/rows';
import { pageAnalyzeLink } from '../../shared/pageAnalyzeLine';
import type { AgentLinkedPage, AgentRunState, BotPageForward } from '../../shared/types';
import { escapePostMarkdown } from '../../shared/xMedia';
import { linkRequestText } from '../botChat/wakeWord';
import { config } from '../config';
import { t } from '../i18n';
import { isMapsUrl } from '../mapReviews';
import { isSingleUrl } from '../urlParser';
import type { PageRead } from './pageReader';

/** Every picture is a message of its own on LINE, and rings every phone in a group. */
const PAGE_FORWARD_IMAGES_MAX = 4;

export type BotPageRead = { kind: 'forward'; page: PageRead } | { kind: 'agent'; linked: AgentLinkedPage };

/** A link with its own way in stays on it: Maps and videos have no page text, and a switched-off site is the user's call. */
function readsAsPage(link: string, allows: LinkSiteFilter): boolean {
  if (isMapsUrl(link)) return false;
  const match = matchLink(link);
  return !match || (match.ref.shape !== 'video' && allows(match.ref.site));
}

/** The link a message is made of, "Yobi" before it or not; null for anything else. */
export function botPageLinkOf(goal: string, allows: LinkSiteFilter): string | null {
  if (!config.pageConnectorEnabled) return null;
  const link = linkRequestText(goal).trim();
  return isSingleUrl(link) && readsAsPage(link, allows) ? link : null;
}

/** The link the analyze button's line is about; null once it would not be read as a page. */
export function botPageAnalyzeLinkOf(goal: string, allows: LinkSiteFilter): string | null {
  const link = pageAnalyzeLink(goal);
  return link ? botPageLinkOf(link, allows) : null;
}

/** The one link a message asks about, for a run with no tool that could read it. */
export function askedPageLinkOf(goal: string, allows: LinkSiteFilter): string | null {
  if (!config.pageConnectorEnabled || !asksAboutLink(goal)) return null;
  const [link, ...others] = linksIn(goal);
  return link && others.length === 0 && readsAsPage(link, allows) ? link : null;
}

function linkedPageOf(page: PageRead): AgentLinkedPage {
  return { url: page.url, title: page.title, text: page.text, truncated: page.truncated };
}

function forTheAgent(read: BotPageRead): BotPageRead {
  return read.kind === 'forward' ? { kind: 'agent', linked: linkedPageOf(read.page) } : read;
}

/** Reads the link once; only the user's Stop comes through as a failure. */
export async function readBotPageLink(url: string, signal?: AbortSignal): Promise<BotPageRead> {
  const { readPageLink } = await import('./pageReadLive');
  try {
    const page = await readPageLink(url, signal);
    signal?.throwIfAborted();
    return page.complete ? { kind: 'forward', page } : { kind: 'agent', linked: linkedPageOf(page) };
  } catch (err) {
    if (signal?.aborted) throw err;
    return { kind: 'agent', linked: { url, title: '', text: '', truncated: false, failure: err instanceof Error ? err.message : String(err) } };
  }
}

function canReadPagesItself(state: AgentRunState): boolean {
  const connectors = state.botGrants?.connectors;
  return state.web !== false || connectors === 'all' || (Array.isArray(connectors) && connectors.includes(BUILTIN_PAGE_SERVER_ID));
}

export interface BotRunPageScope {
  /** The connectors the message named: then they are what should answer. */
  named: readonly string[];
  allows: LinkSiteFilter;
  /** A model command: someone who names a model wants its answer, not the page forwarded. */
  modelNamed?: boolean;
}

/**
 * What a bot run reads before it starts: the link it is made of, or the one link it asks about when
 * it has no tool of its own to read that. Such a person gets that page and not `page_read`, which
 * reads any address: a page could talk a model into using it.
 */
export async function readBotRunPage(state: AgentRunState, scope: BotRunPageScope, signal?: AbortSignal): Promise<BotPageRead | null> {
  const bare = scope.named.length === 0 && !state.replyTo ? botPageLinkOf(state.goal, scope.allows) : null;
  if (bare) {
    const read = await readBotPageLink(bare, signal);
    return scope.modelNamed ? forTheAgent(read) : read;
  }
  const asked = canReadPagesItself(state) ? null : askedPageLinkOf(state.goal, scope.allows);
  return asked ? forTheAgent(await readBotPageLink(asked, signal)) : null;
}

/** The page as a message: its main text alone. Replies are for the analysis, and they run to thousands of characters. */
export function pageForwardOf(page: PageRead, strings: Record<string, string>): BotPageForward {
  const source = [page.site, page.publishedAt].filter(Boolean).join(' · ');
  const replies = page.replyCount ? t(strings, 'bot.page.replies', { count: String(page.replyCount) }) : '';
  const body = page.mainText ?? page.text;
  // A post's title is its own first line: who wrote it says more.
  const heading = body.startsWith(page.title) ? page.author : page.title;
  return {
    link: page.url,
    images: page.images.slice(0, PAGE_FORWARD_IMAGES_MAX),
    opening: [heading, source].filter(Boolean).map(escapePostMarkdown).join('\n'),
    body: escapePostMarkdown(body),
    closing: [replies, page.url].filter(Boolean).join('\n'),
  };
}
