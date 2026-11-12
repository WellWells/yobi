import type { PageApiReader } from './api';
import { imagesOn, readerPage, type ReaderReply } from './readerPage';

const MEDIA_HOSTS = ['cdn.bsky.app'] as const;
const POST_PATH = /^\/profile\/([^/]+)\/post\/([^/]+)\/?$/;

interface Author {
  handle?: string;
  displayName?: string;
  labels?: Array<{ val?: string }>;
}

interface QuotedPost {
  author?: Author;
  value?: { text?: string };
}

interface PostView {
  author?: Author;
  record?: { text?: string; createdAt?: string };
  embed?: {
    images?: Array<{ fullsize?: string }>;
    media?: { images?: Array<{ fullsize?: string }> };
    /** The quoted post; with pictures beside it, one level further down. */
    record?: QuotedPost & { record?: QuotedPost };
  };
  replyCount?: number;
}

interface ThreadView {
  post?: PostView;
  replies?: ThreadView[];
}

function nameOf(post: PostView | QuotedPost): string {
  return post.author?.displayName || post.author?.handle || '';
}

/** The author asked not to be shown to people who are not signed in. */
function shutToVisitors(author: Author | undefined): boolean {
  return author?.labels?.some((label) => label.val === '!no-unauthenticated') ?? false;
}

function repliesOf(thread: ThreadView): ReaderReply[] {
  return (thread.replies ?? []).flatMap(({ post }) => {
    const text = post?.record?.text?.trim();
    if (!post || !text || shutToVisitors(post.author)) return [];
    return [{ author: nameOf(post), date: post.record?.createdAt?.slice(0, 10) ?? '', text }];
  });
}

/** What the post quotes, as text under it; `missing` when it quotes something that cannot be shown. */
function quoteIn(post: PostView): { text: string; missing: boolean } {
  const embedded = post.embed?.record;
  if (!embedded) return { text: '', missing: false };
  const quoted = embedded.record ?? embedded;
  const text = shutToVisitors(quoted.author) ? '' : quoted.value?.text?.trim() ?? '';
  return text ? { text: `${nameOf(quoted)}:\n${text}`, missing: false } : { text: '', missing: true };
}

/** The site is a script with nothing in its page; its public API is what its own pages read. */
export const blueskyReader: PageApiReader = {
  address(url) {
    const post = url.hostname === 'bsky.app' ? POST_PATH.exec(url.pathname) : null;
    if (!post) return null;
    const uri = `at://${decodeURIComponent(post[1])}/app.bsky.feed.post/${post[2]}`;
    return `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=1&parentHeight=0`;
  },
  read(answer, url) {
    const thread = (answer as { thread?: ThreadView }).thread;
    const post = thread?.post;
    const text = post?.record?.text?.trim();
    if (!thread || !post || !text) return null;
    if (shutToVisitors(post.author)) return null;
    const pictures = post.embed?.images ?? post.embed?.media?.images ?? [];
    const quote = quoteIn(post);
    const page = readerPage({
      title: nameOf(post),
      author: nameOf(post),
      publishedAt: post.record?.createdAt?.slice(0, 10) ?? '',
      siteName: 'Bluesky',
      url,
      text: [text, quote.text].filter(Boolean).join('\n\n'),
      replies: repliesOf(thread),
      ...(post.replyCount === undefined ? {} : { replyCount: post.replyCount }),
      images: imagesOn(MEDIA_HOSTS, pictures.map((picture) => picture.fullsize)),
    });
    // A remark on a post nobody can see is not the whole of it: the agent says what is missing.
    return quote.missing ? { ...page, complete: false } : page;
  },
};
