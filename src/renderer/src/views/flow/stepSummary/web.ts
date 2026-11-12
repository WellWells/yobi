import type { SkillInstance } from '../../../../../shared/types';
import { codeComment, codeSize, urlList } from './ai';
import {
  cut, flagged, hostOf, isHttpUrl, isNamed, list, middle, num, ok, outputPart, parts, shortUrl, t, unset, value, wholeRef,
} from './core';
import { describeRef, scopeAt, sourceOf } from './refs';
import type { StepSummary, StepSummaryContext, Summarizer } from './types';

/** A URL field as the row shows it: a reference as written, an address without its scheme. */
export function target(raw: string, max = 40): string {
  return wholeRef(raw) ? raw.trim() : shortUrl(raw, max);
}

/** A named step keeps its name on the first line; what it does moves to the second. */
export function named(step: SkillInstance, ctx: StepSummaryContext, primary: string, secondary?: string, extra: Partial<StepSummary> = {}): StepSummary {
  if (isNamed(step, ctx.t)) return ok(step.label.trim(), parts(primary, secondary), { secondaryCode: extra.code });
  return ok(primary, secondary, extra);
}

function badUrl(url: string): boolean {
  return url !== '' && !wholeRef(url) && !url.includes('{{') && !isHttpUrl(url);
}

const browser: Summarizer = (step, ctx) => {
  const urls = urlList(value(step, 'url'));
  if (urls.length === 0) return unset(ctx, 'browser', ['url']);
  const first = target(urls[0]);
  const what = urls.length === 1
    ? t(ctx, 'flow.summary.browser.one', { url: first })
    : t(ctx, 'flow.summary.browser.many', { url: first, count: urls.length });
  const flag = step.config.requireAll === 'true'
    ? t(ctx, 'flow.summary.browser.requireAll')
    // The runner reads the cover for a single page only.
    : step.config.includeImage === 'true' && urls.length === 1
      ? t(ctx, 'flow.summary.browser.image')
      : step.config.emitFailFlag === 'true' ? t(ctx, 'flow.summary.failSoft') : undefined;
  const summary = named(step, ctx, what, parts(sourceOf(ctx, ...urls), flag ?? outputPart(ctx, step)));
  const bad = urls.findIndex(badUrl);
  return bad >= 0 ? flagged(summary, 'error', t(ctx, 'flow.summary.browser.badUrl', { row: bad + 1 })) : summary;
};

const search: Summarizer = (step, ctx) => {
  const query = value(step, 'query');
  if (!query) return unset(ctx, 'search', ['query']);
  const limit = Number(value(step, 'limit') || '10');
  const what = t(ctx, 'flow.summary.search.query', { query: cut(query.replace(/\s+/g, ' '), 40) });
  return named(step, ctx, what, parts(t(ctx, 'flow.summary.search.limit', { count: num(ctx, limit) }), sourceOf(ctx, query) ?? outputPart(ctx, step)));
};

const scraper: Summarizer = (step, ctx) => {
  const url = value(step, 'url');
  if (!url) return unset(ctx, 'scraper', ['url']);
  const max = Number(value(step, 'maxItems') || '5');
  const summary = named(step, ctx, t(ctx, 'flow.summary.scraper.track', { url: target(url) }), parts(
    t(ctx, 'flow.summary.scraper.max', { count: num(ctx, max) }), sourceOf(ctx, url) ?? outputPart(ctx, step),
  ));
  if (badUrl(url)) return flagged(summary, 'error', t(ctx, 'flow.summary.issue.badUrl'));
  if (!value(step, 'titleSelector') && !value(step, 'linkSelector')) return flagged(summary, 'warning', t(ctx, 'flow.summary.scraper.noSelectors'));
  return summary;
};

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** Method and address only: headers and body carry tokens, and a webhook path can be one. */
const http: Summarizer = (step, ctx) => {
  const url = value(step, 'url');
  if (!url) return unset(ctx, 'http', ['url']);
  const method = value(step, 'method').toUpperCase() || 'GET';
  // The query string is dropped: `?key=…` is where an API key usually rides.
  const path = url.replace(/^[a-z]+:\/\/[^/?#]+/i, '').split(/[?#]/, 1)[0];
  const shown = wholeRef(url) ? url : `${hostOf(url) ?? ''}${cut(path, 32)}` || shortUrl(url);
  const sent = parts(
    value(step, 'headers') ? t(ctx, 'flow.summary.http.headers') : undefined,
    value(step, 'body') ? t(ctx, 'flow.summary.http.body') : undefined,
  );
  const summary = named(step, ctx, `${HTTP_METHODS.has(method) ? method : 'GET'} ${shown}`, sent ?? outputPart(ctx, step), { code: true });
  const headers = value(step, 'headers');
  if (headers && !headers.includes('{{')) {
    try {
      const parsed: unknown = JSON.parse(headers);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    } catch {
      return flagged(summary, 'error', t(ctx, 'flow.summary.http.badHeaders'));
    }
  }
  return badUrl(url) ? flagged(summary, 'error', t(ctx, 'flow.summary.issue.badUrl')) : summary;
};

/** The tab a browser step works on: the opening step it names, everything, or something unknowable. */
interface TabLink {
  open: number | null;
  all: boolean;
  /** It names a tab, but no opening step before it in scope makes that tab. */
  broken: boolean;
}

function tabLink(ctx: StepSummaryContext, page: string): TabLink {
  if (page === 'all') return { open: null, all: true, broken: false };
  const ref = wholeRef(page);
  if (!ref || ref.includes('.') || describeRef(ref, ctx).kind === 'variable') return { open: null, all: false, broken: false };
  const at = scopeAt(ctx.steps, ctx.index).outputs.get(ref);
  const opener = at !== undefined && ctx.steps[at].type === 'browser_open' ? at : null;
  return { open: opener, all: false, broken: opener === null };
}

/** Whether a close step closes this tab: it names it, or closes them all. */
function closes(step: SkillInstance, tabKey: string): boolean {
  if (step.type !== 'browser_close') return false;
  const page = value(step, 'page');
  return page === 'all' || wholeRef(page) === tabKey;
}

function closedAt(ctx: StepSummaryContext, open: number): number | null {
  const key = ctx.steps[open].outputKey;
  for (let i = open + 1; i < ctx.index; i++) if (closes(ctx.steps[i], key)) return i;
  return null;
}

function tabHost(ctx: StepSummaryContext, open: number): string {
  const url = value(ctx.steps[open], 'url');
  return wholeRef(url) ? url : hostOf(url) ?? shortUrl(url, 32);
}

const browserOpen: Summarizer = (step, ctx) => {
  const url = value(step, 'url');
  const tab = step.outputKey || undefined;
  if (!url) return unset(ctx, 'browser_open', ['url'], tab);
  const users: number[] = [];
  const closers: number[] = [];
  ctx.steps.forEach((other, i) => {
    if (i <= ctx.index || !tab) return;
    if (other.type === 'browser_js' && wholeRef(value(other, 'page')) === tab) users.push(i + 1);
    if (closes(other, tab)) closers.push(i + 1);
  });
  const chain = parts(
    tab,
    users.length > 0 ? t(ctx, 'flow.summary.tab.used', { steps: list(ctx, users.map((n) => `#${n}`)) }) : undefined,
    closers.length > 0
      ? t(ctx, 'flow.summary.tab.closedBy', { steps: list(ctx, closers.map((n) => `#${n}`)) })
      : t(ctx, 'flow.summary.tab.autoClose'),
  );
  const what = t(ctx, step.config.show === 'true' ? 'flow.summary.browserOpen.shown' : 'flow.summary.browserOpen.open', { url: target(url) });
  const summary = named(step, ctx, what, chain);
  return badUrl(url) ? flagged(summary, 'error', t(ctx, 'flow.summary.issue.badUrl')) : summary;
};

function tabIssue(ctx: StepSummaryContext, link: TabLink, summary: StepSummary): StepSummary {
  if (link.broken) return flagged(summary, 'error', t(ctx, 'flow.summary.tab.noOpener'));
  if (link.open === null) return summary;
  const closed = closedAt(ctx, link.open);
  return closed === null ? summary : flagged(summary, 'warning', t(ctx, 'flow.summary.tab.alreadyClosed', { step: `#${closed + 1}` }));
}

function tabLine(ctx: StepSummaryContext, link: TabLink, page: string): string | undefined {
  if (link.open !== null) return parts(ctx.steps[link.open].outputKey, t(ctx, 'flow.summary.tab.from', { step: `#${link.open + 1}` }));
  return parts(page, t(ctx, 'flow.summary.tab.unknown'));
}

/** What it does to which tab, never the code: page scripts log in with real passwords. */
const browserJs: Summarizer = (step, ctx) => {
  const page = value(step, 'page');
  const code = step.config.code ?? '';
  const absent = [page ? '' : 'page', code.trim() ? '' : 'code'].filter(Boolean);
  const link = tabLink(ctx, page);
  if (absent.length > 0) return unset(ctx, 'browser_js', absent, page ? tabLine(ctx, link, page) : undefined);
  const comment = codeComment(code);
  const host = link.open !== null ? tabHost(ctx, link.open) : null;
  const what = comment ?? (host
    ? t(ctx, 'flow.summary.browserJs.on', { host: middle(host, 32), code: codeSize(ctx, code) })
    : t(ctx, 'flow.summary.browserJs.unknownTab', { code: codeSize(ctx, code) }));
  const second = comment && host ? parts(tabLine(ctx, link, page), host) : tabLine(ctx, link, page);
  return tabIssue(ctx, link, named(step, ctx, what, second));
};

const browserClose: Summarizer = (step, ctx) => {
  const page = value(step, 'page');
  if (!page) return unset(ctx, 'browser_close', ['page']);
  const link = tabLink(ctx, page);
  if (link.all) {
    const opened = ctx.steps.slice(0, ctx.index).flatMap((other, i) => (other.type === 'browser_open' ? [`#${i + 1}`] : []));
    return named(step, ctx, t(ctx, 'flow.summary.browserClose.all'), opened.length > 0
      ? t(ctx, 'flow.summary.browserClose.opened', { steps: list(ctx, opened) })
      : undefined);
  }
  const what = link.open !== null
    ? t(ctx, 'flow.summary.browserClose.one', { host: middle(tabHost(ctx, link.open), 32) })
    : t(ctx, 'flow.summary.browserClose.ref', { page });
  return tabIssue(ctx, link, named(step, ctx, what, tabLine(ctx, link, page)));
};

export const WEB_SUMMARIES = {
  browser, search, scraper, http, browser_open: browserOpen, browser_js: browserJs, browser_close: browserClose,
} as const;
