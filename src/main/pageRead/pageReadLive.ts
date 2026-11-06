/**
 * `readPage` over the real network. Always public web only, on the desktop too: the link can come
 * from a model reading a page, and nothing here has a reason to reach the user's own network. Post
 * sites read as a visitor for the same reason: `x_thread` with no sign-in in its config.
 */
import { parseXMediaInput } from '../../shared/xMedia';
import { NAVIGATION_HEADERS } from '../flow/skills/siteFetch';
import { execXThread } from '../flow/skills/x';
import { pageFetchLane } from '../flow/lanes';
import { sendLog } from '../helpers';
import { withPublicWebOnly } from '../net/publicWebScope';
import { fetchRawResponse, loadPageHtml } from '../pageLoader';
import { userAgentForUrl } from '../userAgent';
import { createGoogleNewsResolver } from './googleNewsLink';
import { readPage, type PageRead, type PageReaderDeps } from './pageReader';

/** As many as a thread's page tends to hold; the text is capped after that like any other page. */
const POST_MAX_REPLIES = 100;
const POST_TITLE_MAX_CHARS = 100;

interface ThreadEnvelope {
  output: string;
  platform: string;
  text: string;
  author: string;
  name: string;
  date: string;
  link: string;
}

function headersFor(url: string): Record<string, string> {
  return { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS };
}

const resolveGoogleNews = createGoogleNewsResolver((url, options) => fetchRawResponse(url, { ...options, headers: headersFor(url) }));

async function readPublicPost(url: string, signal?: AbortSignal): Promise<PageRead | null> {
  if (!parseXMediaInput(url)) return null;
  const thread = JSON.parse(await execXThread({ url, maxReplies: String(POST_MAX_REPLIES) }, signal)) as ThreadEnvelope;
  return {
    title: thread.text.split('\n')[0]?.slice(0, POST_TITLE_MAX_CHARS) ?? '',
    author: thread.name || thread.author,
    publishedAt: thread.date,
    text: thread.output,
    preview: false,
    method: 'discussion',
    siteName: thread.platform,
    truncated: false,
    site: thread.platform,
    url: thread.link || url,
  };
}

const LIVE_DEPS: PageReaderDeps = {
  fetchPage: (url, signal) => fetchRawResponse(url, { headers: headersFor(url), signal }),
  renderPage: (url, signal) => pageFetchLane.runExclusive(() => loadPageHtml(url, undefined, signal)),
  resolveGoogleNews,
  readPost: readPublicPost,
  log: sendLog,
};

export function readPageLink(url: string, signal?: AbortSignal): Promise<PageRead> {
  return withPublicWebOnly(() => readPage(url, LIVE_DEPS, signal));
}
