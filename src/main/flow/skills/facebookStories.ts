import { facebookStoryLink, type FacebookStoryRef } from '../../../shared/facebookLinks';
import { photoMedia, videoMedia, type FacebookPage } from './facebookMedia';
import { arr, num, obj, str, type Json } from './jsonPick';
import type { PostPicks, XMedia, XPost } from './xPosts';

/**
 * A person's Facebook stories, from the story viewer's page read signed in. The page also lists
 * other people's buckets without media, so the bucket is found by its id, then by the card the
 * link opens.
 */

/** "All" takes at most this many, the newest, as Instagram's stories do. */
export const MAX_STORY_ITEMS = 20;

export interface StoryItem {
  /** The card's id (base64), the last part of its link. */
  card: string;
  /** Epoch ms. */
  createdAt: number;
  media: XMedia;
}

export interface StoryBucket {
  id: string;
  owner: { id: string; name: string };
  /** Oldest first, as the viewer plays them; cards with nothing to download are left out. */
  items: StoryItem[];
}

function cardsOf(bucket: Json): Json[] {
  const stories = obj(bucket.unified_stories_with_notes) ?? obj(bucket.unified_stories);
  return arr(stories?.edges).map((edge) => obj(obj(edge)?.node)).filter((node): node is Json => node !== undefined);
}

function hasMedia(bucket: Json): boolean {
  return cardsOf(bucket).some((card) => obj(arr(card.attachments)[0]) !== undefined);
}

/** The bucket with its cards' media: the tray's copy of it has the cards alone. */
function bucketById(page: FacebookPage, id: string): Json | undefined {
  return (page.byId.get(id) ?? []).find((o) => hasMedia(o));
}

/**
 * A video's length from its DASH manifest (`mediaPresentationDuration="PT9.170431S"`): a story's
 * video names no length elsewhere. 0 when there is none.
 */
export function manifestDurationMs(media: Json): number {
  const result = obj(obj(media.videoDeliveryResponseFragment)?.videoDeliveryResponseResult);
  for (const manifest of arr(result?.dash_manifests)) {
    const xml = str(obj(manifest)?.manifest_xml);
    const match = /mediaPresentationDuration="PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?"/.exec(xml);
    if (!match) continue;
    const seconds = Number(match[1] ?? 0) * 3_600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    if (seconds > 0) return Math.round(seconds * 1_000);
  }
  return 0;
}

function itemMedia(page: FacebookPage, card: Json): XMedia | null {
  const media = obj(obj(arr(card.attachments)[0])?.media);
  const id = str(media?.id);
  if (!media || !id) return null;
  const type = str(media.__typename);
  if (type === 'Photo') return photoMedia(page, id);
  if (type !== 'Video') return null;
  const video = videoMedia(page, id);
  if (!video) return null;
  return video.durationMs > 0 ? video : { ...video, durationMs: manifestDurationMs(media) };
}

/** The person's stories the link names; null when the page holds no such bucket with media. */
export function readStoryBucket(page: FacebookPage, ref: Pick<FacebookStoryRef, 'bucket' | 'card'>): StoryBucket | null {
  let bucket = bucketById(page, ref.bucket);
  if (!bucket && ref.card) {
    // The card names its bucket: a link whose first part is not the bucket's id still finds it.
    for (const card of page.byId.get(ref.card) ?? []) {
      const owner = str(obj(obj(card.story_card_info)?.bucket)?.id);
      bucket = owner ? bucketById(page, owner) : undefined;
      if (bucket) break;
    }
  }
  if (!bucket) return null;
  const owner = obj(bucket.story_bucket_owner) ?? obj(bucket.owner);
  const items: StoryItem[] = [];
  for (const card of cardsOf(bucket)) {
    const id = str(card.id);
    const media = id ? itemMedia(page, card) : null;
    if (media) items.push({ card: id, createdAt: num(card.creation_time) * 1_000, media });
  }
  return { id: str(bucket.id), owner: { id: str(owner?.id), name: str(owner?.name) }, items };
}

function storyPost(bucket: StoryBucket, id: string, link: string, items: readonly StoryItem[]): XPost {
  return {
    id,
    author: '',
    name: bucket.owner.name,
    createdAt: items.at(-1)?.createdAt ?? 0,
    text: '',
    link,
    image: items[0]?.media.image ?? '',
    replyCount: 0,
    likeCount: 0,
    inReplyTo: '',
    isRepost: false,
    media: items.map((item) => item.media),
    quoteMedia: [],
  };
}

/** The card's own number, the digits behind `S:_ISC:`: a file name's id. The base64 when it is not one. */
function cardNumber(card: string): string {
  try {
    return /^S:_ISC:(\d+)$/.exec(atob(card))?.[1] ?? card;
  } catch {
    return card;
  }
}

/**
 * What a story link takes, as one post: `one` the card it names (null when that card is gone),
 * `all` the newest 20; the link alone all of them too, with a menu to choose from (`picks`) when
 * there is more than one.
 */
export function storyBucketPost(bucket: StoryBucket, ref: FacebookStoryRef): XPost | null {
  const linkOf = (card: string, pick: FacebookStoryRef['pick'] = ''): string => facebookStoryLink(bucket.id, card, pick);
  if (ref.pick === 'one') {
    const item = bucket.items.find((i) => i.card === ref.card);
    return item ? storyPost(bucket, cardNumber(item.card), linkOf(item.card), [item]) : null;
  }
  if (bucket.items.length === 0) return null;
  const newest = bucket.items.slice(-MAX_STORY_ITEMS);
  const linked = bucket.items.some((i) => i.card === ref.card) ? ref.card : '';
  const post = storyPost(bucket, bucket.id, linkOf(linked), newest);
  if (ref.pick === 'all' || bucket.items.length === 1) return post;
  const picks: PostPicks = {
    items: bucket.items.map((item, index) => ({
      link: linkOf(item.card, 'one'),
      number: index + 1,
      media: item.media,
      linked: item.card === linked,
    })),
    all: linkOf('', 'all'),
  };
  return { ...post, picks };
}
