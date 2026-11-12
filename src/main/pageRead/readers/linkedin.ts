import type { PageSiteReader } from './index';
import { imagesOn, jsonLdNodes, readerPage, type ReaderReply } from './readerPage';

const MEDIA_HOSTS = ['media.licdn.com'] as const;
const POST_TYPES: ReadonlySet<unknown> = new Set(['DiscussionForumPosting', 'SocialMediaPosting']);

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nameOf(person: unknown): string {
  return stringOf((person as { name?: unknown } | null)?.name);
}

function imageAddresses(image: unknown): unknown[] {
  return (Array.isArray(image) ? image : [image]).map((item) => (item as { url?: unknown } | null)?.url);
}

function repliesOf(comments: unknown): ReaderReply[] {
  if (!Array.isArray(comments)) return [];
  return comments.flatMap((comment: Record<string, unknown>) => {
    const text = stringOf(comment?.text).trim();
    return text ? [{ author: nameOf(comment.author), date: stringOf(comment.datePublished).slice(0, 10), text }] : [];
  });
}

/** A post's page says all of it in JSON-LD to a visitor, with the first few of its comments. */
export const linkedinReader: PageSiteReader = {
  // Pulse is an article, and the general reader's.
  matches: (url) => /(?:^|\.)linkedin\.com$/.test(url.hostname) && /^\/(?:posts|feed\/update)\//.test(url.pathname),
  read(html, url) {
    const post = jsonLdNodes(html).find((node) => POST_TYPES.has(node['@type']) && stringOf(node.articleBody).trim());
    if (!post) return null;
    const count = Number(post.commentCount);
    return readerPage({
      title: stringOf(post.headline),
      author: nameOf(post.author),
      publishedAt: stringOf(post.datePublished).slice(0, 10),
      siteName: 'LinkedIn',
      url,
      text: stringOf(post.articleBody).trim(),
      replies: repliesOf(post.comment),
      ...(Number.isFinite(count) ? { replyCount: count } : {}),
      images: imagesOn(MEDIA_HOSTS, imageAddresses(post.image)),
    });
  },
};
