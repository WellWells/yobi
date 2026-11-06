/**
 * Reads one link's text. A Google News link goes to its article, a post site to its own reader, any
 * other page takes the plain request first and a hidden window when that one is refused or holds
 * next to nothing. Takes its network as parameters; the real ones are in pageReadLive.ts.
 *
 * Sites change, so not finding the text is an ordinary outcome, not a fault: a layout that moved
 * falls through to the next way of reading and is logged by name, and when nothing works the caller
 * gets a `PageReadError` that says so. Nothing that goes wrong on a page may end the run. Only the
 * user's Stop travels through unchanged.
 */
import { matchLink, siteLabel } from '../../shared/linkSites/rows';
import { findPageSite, googleNewsArticleId, isWebLink, type PageSite } from '../../shared/pageSites';
import { PrivateAddressRefusedError } from '../net/publicWebScope';
import { isVerificationWall, verificationWallMessage } from '../net/verificationWall';
import { MIN_ARTICLE_CHARS } from '../search/pageText';
import { GoogleNewsLinkError } from './googleNewsLink';
import { extractPageText, extractPlainText, type PageText } from './pageExtract';

export type PageFailure = 'not-a-page' | 'video' | 'private' | 'missing' | 'walled' | 'sign-in' | 'refused' | 'no-text' | 'unreachable' | 'post';

export class PageReadError extends Error {
  constructor(readonly reason: PageFailure, message: string) {
    super(message);
    this.name = 'PageReadError';
  }
}

export interface PageRead extends PageText {
  /** The site, as the table or the page names it. */
  site: string;
  /** Where the text was read, after Google News and any redirect. */
  url: string;
}

interface RawAnswer {
  status: number;
  text: string;
  finalUrl: string;
  headers?: Readonly<Record<string, string>>;
}

export interface PageReaderDeps {
  fetchPage: (url: string, signal?: AbortSignal) => Promise<RawAnswer>;
  renderPage: (url: string, signal?: AbortSignal) => Promise<string>;
  resolveGoogleNews: (id: string, signal?: AbortSignal) => Promise<string>;
  /** A post site's own reader, signed out; null when the link is no post of one. */
  readPost: (url: string, signal?: AbortSignal) => Promise<PageRead | null>;
  log: (line: string) => void;
}

/** A redirect here means the page is for signed-in people. Only a redirect: a page may be about signing in. */
const SIGN_IN_ADDRESS = /\/\/[^\s'"]*\/(?:sign[-_]?in|log[-_]?in|authwall)\b/i;
const HTML_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i;
const TEXT_TYPE = /^text\/(?:plain|markdown)\b/i;

function reasonText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nameOf(url: string): string {
  return findPageSite(url)?.name ?? new URL(url).hostname;
}

/** Stop travels through; a refused private address is an answer, not a page that failed to load. */
function rethrowFinal(err: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw err;
  if (err instanceof PrivateAddressRefusedError) throw new PageReadError('private', err.message);
}

function signInFailure(url: string): PageReadError {
  return new PageReadError('sign-in', `${nameOf(url)} shows this page to signed-in people only, and this tool reads signed out. Use another source.`);
}

async function articleAddress(url: string, deps: PageReaderDeps, signal?: AbortSignal): Promise<string> {
  const id = googleNewsArticleId(url);
  if (!id) return url;
  try {
    return await deps.resolveGoogleNews(id, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof GoogleNewsLinkError && err.reason === 'missing') throw new PageReadError('missing', err.message);
    throw new PageReadError('unreachable', `Cannot open this Google News link: ${reasonText(err)}`);
  }
}

/** A page that cannot be parsed is a page without text, whatever the parser tripped on. */
function tryExtract(html: string, url: string, site: PageSite | null, deps: PageReaderDeps): PageText | null {
  try {
    return extractPageText(html, url, site);
  } catch (err) {
    deps.log(`📄 [PageRead] ${site?.name ?? url} could not be parsed: ${reasonText(err)}`);
    return null;
  }
}

interface WindowRead {
  page: PageText | null;
  walled: boolean;
  /** The window got as far as a page. */
  reached: boolean;
  signIn: boolean;
}

interface FirstRead {
  page: PageText | null;
  walled: boolean;
  url: string;
  /** What the site answered; 0 when the request itself failed. */
  status: number;
}

function readBody(answer: RawAnswer, url: string, deps: PageReaderDeps): PageText | null {
  const type = answer.headers?.['content-type']?.trim() ?? '';
  if (TEXT_TYPE.test(type)) return extractPlainText(answer.text, url);
  if (type && !HTML_TYPE.test(type)) {
    throw new PageReadError('not-a-page', `This link is a file (${type.split(';')[0]}), not a web page, so this tool cannot read it.`);
  }
  return tryExtract(answer.text, url, findPageSite(url), deps);
}

async function readPlain(url: string, deps: PageReaderDeps, signal?: AbortSignal): Promise<FirstRead> {
  let answer: RawAnswer;
  try {
    answer = await deps.fetchPage(url, signal);
  } catch (err) {
    rethrowFinal(err, signal);
    deps.log(`📄 [PageRead] plain read failed, ${reasonText(err)}`);
    return { page: null, url, walled: false, status: 0 };
  }
  if (answer.status === 404 || answer.status === 410) throw new PageReadError('missing', 'This page no longer exists on the site.');
  const finalUrl = answer.finalUrl || url;
  if (SIGN_IN_ADDRESS.test(finalUrl) && !SIGN_IN_ADDRESS.test(url)) throw signInFailure(url);
  const page = answer.status < 400 ? readBody(answer, finalUrl, deps) : null;
  const walled = isVerificationWall(answer.text, page?.text.length ?? 0);
  if (!page || walled) deps.log(`📄 [PageRead] plain read of ${finalUrl} answered ${answer.status} with ${walled ? 'a verification wall' : 'no text'}`);
  // A wall's text is not the page, however the reader view scores it.
  return { page: walled ? null : page, url: finalUrl, walled, status: answer.status };
}

async function readRendered(url: string, deps: PageReaderDeps, signal?: AbortSignal): Promise<WindowRead> {
  try {
    const html = await deps.renderPage(url, signal);
    const page = tryExtract(html, url, findPageSite(url), deps);
    const walled = isVerificationWall(html, page?.text.length ?? 0);
    return { page: walled ? null : page, walled, reached: true, signIn: false };
  } catch (err) {
    rethrowFinal(err, signal);
    const reason = reasonText(err);
    deps.log(`📄 [PageRead] window read failed, ${reason}`);
    return { page: null, walled: false, reached: false, signIn: SIGN_IN_ADDRESS.test(reason) };
  }
}

function noteStaleLayout(site: PageSite | null, page: PageText, url: string, deps: PageReaderDeps): void {
  if (site?.body && page.method !== 'site') {
    deps.log(`⚠️ [PageRead] ${site.name}: no article container at ${url}, read by ${page.method} instead — its layout may have changed (src/shared/pageSites.ts)`);
  }
}

/**
 * Why neither read found any text. Only the last answer blames the page: LTN answers 403 for
 * articles it served in other runs, and "the layout may have changed" would send the reader after a
 * problem that is not there.
 */
function readFailure(plain: FirstRead, rendered: WindowRead | null): PageReadError {
  const name = nameOf(plain.url);
  if (plain.walled || rendered?.walled) return new PageReadError('walled', verificationWallMessage(name));
  if (rendered?.signIn) return signInFailure(plain.url);
  if (plain.status >= 400) return new PageReadError('refused', `${name} answered ${plain.status} instead of the page. Try again later or use another source.`);
  if (plain.status === 0 && !rendered?.reached) return new PageReadError('unreachable', `${name} could not be reached just now. Try again later or use another source.`);
  return new PageReadError('no-text', `No text found at ${plain.url}. It may be an app that needs a browser, or the site's layout may have changed. Try the browser tool or another source.`);
}

function refuseVideo(url: string): void {
  const match = matchLink(url);
  if (match?.ref.shape !== 'video') return;
  throw new PageReadError('video', `${siteLabel(match.ref.site)} is a video or audio link with no page text: read it with the youtube tool instead.`);
}

async function readPost(url: string, deps: PageReaderDeps, signal?: AbortSignal): Promise<PageRead | null> {
  try {
    return await deps.readPost(url, signal);
  } catch (err) {
    rethrowFinal(err, signal);
    throw new PageReadError('post', reasonText(err));
  }
}

/** One link's text; `PageReadError` when it cannot be read. */
export async function readPage(link: string, deps: PageReaderDeps, signal?: AbortSignal): Promise<PageRead> {
  const given = link.trim();
  if (!isWebLink(given)) throw new PageReadError('not-a-page', 'Not a web address: give an http or https link.');
  const url = await articleAddress(given, deps, signal);
  refuseVideo(url);
  const post = await readPost(url, deps, signal);
  if (post) return post;
  const plain = await readPlain(url, deps, signal);
  const site = findPageSite(plain.url);
  if (plain.status >= 400 && site?.signedInOnly) throw signInFailure(plain.url);
  // The window is slow (up to 35 s on a page that never settles), so it is for a read that came
  // back with nothing, or with the little an app's shell holds before its script runs. A site whose
  // selector went stale still has its text from the plain read.
  const thin = plain.page?.method === 'whole page' && plain.page.text.length < MIN_ARTICLE_CHARS;
  const rendered = !plain.page || thin ? await readRendered(plain.url, deps, signal) : null;
  const shut = rendered?.walled === true || rendered?.signIn === true;
  const page = shut ? null : [plain.page, rendered?.page].reduce((best, next) => (next && next.text.length > (best?.text.length ?? 0) ? next : best), null);
  if (!page) throw readFailure(plain, rendered);
  noteStaleLayout(site, page, plain.url, deps);
  return { ...page, site: site?.name || page.siteName || new URL(plain.url).hostname, url: plain.url };
}
