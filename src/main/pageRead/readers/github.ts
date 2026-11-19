import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { MAX_CONTENT_CHARS } from '../../urlParser';
import { textOf } from '../pageExtract';
import type { PageRead } from '../pageReader';
import type { PageSiteReader } from './index';
import { jsonLdNodes, readerPage, type ReaderReply } from './readerPage';

/** `/<owner>/<repo>` and what follows; GitHub's own first segments are never an owner. */
const REPO_PATH = /^\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(\/.*)?$/;
const NOT_OWNERS = new Set([
  'orgs', 'settings', 'topics', 'marketplace', 'features', 'explore', 'sponsors', 'login', 'apps', 'collections',
  'trending', 'about', 'pricing', 'enterprise', 'security', 'customer-stories', 'readme', 'site', 'notifications', 'search',
]);

interface Repo {
  owner: string;
  name: string;
  rest: string;
}

function repoOf(url: URL): Repo | null {
  if (url.hostname !== 'github.com') return null;
  const match = REPO_PATH.exec(url.pathname);
  if (!match || NOT_OWNERS.has(match[1].toLowerCase())) return null;
  return { owner: match[1], name: match[2], rest: (match[3] ?? '').replace(/\/$/, '') };
}

function textIn($: CheerioAPI, node: Cheerio<Element>): string {
  const element = node.get(0);
  return element ? textOf($, element).trim() : '';
}

/** The page's own title without the site's name after it. */
function pageTitle($: CheerioAPI): string {
  return $('title').first().text().trim().replace(/^GitHub - /, '').replace(/ · GitHub$/, '');
}

function dateOf(node: Cheerio<AnyNode>): string {
  return node.find('relative-time[datetime]').first().attr('datetime')?.slice(0, 10) ?? '';
}

interface Found {
  title: string;
  author?: string;
  publishedAt?: string;
  text: string;
  replies?: readonly ReaderReply[];
}

/** A repository's front page: what it says it is, then its README. A repository without one is the general reader's. */
function readRepo($: CheerioAPI, repo: Repo): Found | null {
  const readme = textIn($, $('article.markdown-body').first());
  if (!readme) return null;
  const slug = `${repo.owner}/${repo.name}`;
  const about = ($('meta[name="description"]').attr('content') ?? '').trim().replace(new RegExp(`\\s*-\\s*${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
  return { title: slug, author: repo.owner, text: [about, readme].filter(Boolean).join('\n\n') };
}

/** A release, or the newest one on the releases page: its name, its date and its notes. */
function readRelease($: CheerioAPI, repo: Repo, listing: boolean): Found | null {
  const body = $('[data-test-selector="body-content"]').first();
  const notes = textIn($, body);
  if (!notes) return null;
  const section = body.closest('section');
  const name = section.find('h2').first().text().trim();
  return {
    title: listing && name ? `${repo.owner}/${repo.name} ${name}` : pageTitle($),
    author: repo.owner,
    publishedAt: dateOf(section.length > 0 ? section : $('body')),
    text: notes,
  };
}

/** An issue: its own words, who opened it, and the comments under it. */
function readIssue($: CheerioAPI, html: string): Found | null {
  const text = textIn($, $('[data-testid="issue-body-viewer"] [data-testid="markdown-body"]').first());
  if (!text) return null;
  const posted = jsonLdNodes(html).find((node) => node['@type'] === 'DiscussionForumPosting');
  const replies = $('[data-testid^="comment-viewer-outer-box-"]').toArray().map((node) => {
    const comment = $(node);
    return {
      author: comment.find('[data-testid="avatar-link"]').first().attr('href')?.replace(/^\//, '') ?? '',
      date: dateOf(comment),
      text: textIn($, comment.find('[data-testid="markdown-body"]').first()),
    };
  }).filter((reply) => reply.text);
  return {
    title: $('[data-testid="issue-title"]').first().text().trim() || pageTitle($),
    author: $('[data-testid="issue-body-header-author"]').first().text().trim(),
    publishedAt: typeof posted?.datePublished === 'string' ? posted.datePublished.slice(0, 10) : '',
    text,
    replies,
  };
}

/** A pull request: the first comment is what it says it does, the rest its review talk. */
function readPull($: CheerioAPI): Found | null {
  const comments = $('.js-comment-container').toArray().map((node) => {
    const comment = $(node);
    return { author: comment.find('.author').first().text().trim(), date: dateOf(comment), text: textIn($, comment.find('.comment-body').first()) };
  }).filter((comment) => comment.text);
  const [first, ...rest] = comments;
  if (!first) return null;
  return {
    title: $('h1 .markdown-title').first().text().trim() || pageTitle($),
    author: first.author,
    publishedAt: first.date,
    text: first.text,
    replies: rest,
  };
}

/** A Markdown file or a wiki page, as GitHub renders it; a wiki page says when it was last edited. */
function readDocument($: CheerioAPI, repo: Repo): Found | null {
  const text = textIn($, $('#wiki-body .markdown-body, article.markdown-body').first());
  return text ? { title: pageTitle($), author: repo.owner, publishedAt: dateOf($('.gh-header-meta')), text } : null;
}

/** The first list of lines anywhere in the page's data, however deep its route keeps it. */
function rawLinesIn(value: unknown, depth = 0): string[] | null {
  if (!value || typeof value !== 'object' || depth > 6) return null;
  const lines = (value as Record<string, unknown>).rawLines;
  if (Array.isArray(lines) && lines.every((line) => typeof line === 'string')) return lines as string[];
  for (const inner of Object.values(value)) {
    const found = rawLinesIn(inner, depth + 1);
    if (found) return found;
  }
  return null;
}

/** A code file: its page draws the code from the lines in the page's data, not from its HTML. */
function readCode($: CheerioAPI, repo: Repo): Found | null {
  let data: unknown;
  try {
    data = JSON.parse($('script[data-target="react-app.embeddedData"]').first().text());
  } catch {
    return null;
  }
  const text = (rawLinesIn(data) ?? []).join('\n').trim();
  return text ? { title: pageTitle($), author: repo.owner, text } : null;
}

function found($: CheerioAPI, html: string, repo: Repo): Found | null {
  const { rest } = repo;
  if (!rest) return readRepo($, repo);
  if (/^\/releases(?:\/tag\/[^/]+|\/latest)?$/.test(rest)) return readRelease($, repo, rest === '/releases');
  if (/^\/issues\/\d+$/.test(rest)) return readIssue($, html);
  if (/^\/pull\/\d+$/.test(rest)) return readPull($);
  if (/^\/(?:blob\/.+\.(?:md|markdown|mdx)|wiki(?:\/.+)?|tree\/[^/]+)$/i.test(rest)) return readDocument($, repo);
  if (/^\/blob\/[^/]+\/.+$/.test(rest)) return readCode($, repo);
  return null;
}

/**
 * A GitHub page whose words are one body: a repository's README, a release's notes, an issue or a
 * pull request with its comments, a rendered Markdown file, a wiki page, a code file. Everything is
 * read from the page as GitHub serves it to a visitor, by its own hooks (`data-testid`,
 * `data-test-selector`, `itemprop`, the page data's `rawLines`); a page they are missing from is
 * the general reader's.
 */
export const githubReader: PageSiteReader = {
  matches: (url) => repoOf(url) !== null,
  read(html, url): PageRead | null {
    const repo = repoOf(new URL(url));
    if (!repo) return null;
    const $ = load(html);
    const page = found($, html, repo);
    if (!page) return null;
    const read = readerPage({ author: '', publishedAt: '', ...page, siteName: 'GitHub', url });
    // A README past the length cap is not whole; comments past it only shorten the analysis.
    return page.text.length > MAX_CONTENT_CHARS ? { ...read, complete: false } : read;
  },
};
