import type { PageApiReader } from './api';
import { htmlText, imagesOn, readerPage } from './readerPage';

/** Any server can run this software, so an address alone proves nothing: only servers named here. */
const SERVERS: Readonly<Record<string, readonly string[]>> = {
  'mastodon.social': ['files.mastodon.social'],
};
const POST_PATH = /^\/@[^/]+\/(\d+)\/?$/;

interface Status {
  content?: string;
  spoiler_text?: string;
  created_at?: string;
  replies_count?: number;
  account?: { acct?: string; display_name?: string };
  media_attachments?: Array<{ type?: string; url?: string }>;
}

/** The site is a script with nothing in its page; the server's public API is what its pages read. */
export const mastodonReader: PageApiReader = {
  address(url) {
    const post = SERVERS[url.hostname] ? POST_PATH.exec(url.pathname) : null;
    return post ? `https://${url.hostname}/api/v1/statuses/${post[1]}` : null;
  },
  read(answer, url) {
    const status = answer as Status;
    const said = status.content ? htmlText(status.content) : '';
    if (!said) return null;
    const author = status.account?.display_name || status.account?.acct || '';
    const pictures = (status.media_attachments ?? []).filter((media) => media.type === 'image');
    return readerPage({
      title: author,
      author,
      publishedAt: status.created_at?.slice(0, 10) ?? '',
      siteName: 'Mastodon',
      url,
      text: [status.spoiler_text?.trim(), said].filter(Boolean).join('\n\n'),
      ...(status.replies_count === undefined ? {} : { replyCount: status.replies_count }),
      images: imagesOn(SERVERS[new URL(url).hostname] ?? [], pictures.map((picture) => picture.url)),
    });
  },
};
