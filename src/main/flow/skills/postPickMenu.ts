import { t } from '../../i18n';
import type { FlowButton } from '../../../shared/types';
import { photoUrl } from '../../../shared/xMedia';
import { formatDuration } from '../../../shared/ytdl';
import type { PostPick, PostPicks } from './xPosts';

/**
 * The menu a link offering several items gets (a person's Facebook stories), so the person picks
 * what to download: one button per item — its number, photo or video and the video's length, a
 * star on the one the link opened at — and "all" last. Each button's input is the item's own link,
 * so pressing it (or, on LINE, sending that line) is pasting that link.
 *
 * Each item also has its picture: the desktop chat draws the buttons as those pictures, Telegram
 * gets them as an album in the buttons' order, LINE as a carousel to tap.
 */

/**
 * Items with a button: a Telegram album holds at most 10 pictures, and the album has to number the
 * same items the buttons do. "All" makes 11, under the 12 a chat takes.
 */
const MAX_PICK_ITEMS = 10;

/**
 * The items that get a button when there are more than there is room for: the run around the one
 * the link opened at, else the newest. Their numbers stay their places among them all.
 */
export function pickWindow(items: readonly PostPick[], size = MAX_PICK_ITEMS): PostPick[] {
  if (items.length <= size) return [...items];
  const linked = items.findIndex((item) => item.linked);
  const at = linked >= 0 ? linked : items.length - 1;
  const start = Math.min(Math.max(0, at - Math.floor(size / 2)), items.length - size);
  return items.slice(start, start + size);
}

function pickLabel(item: PostPick, strings: Record<string, string>): string {
  const number = String(item.number);
  const duration = formatDuration(item.media.durationMs / 1_000);
  const label = item.media.kind === 'photo'
    ? t(strings, 'xMedia.story.photo', { number })
    : duration ? t(strings, 'xMedia.story.video', { number, duration }) : t(strings, 'xMedia.story.videoUntimed', { number });
  return item.linked ? t(strings, 'xMedia.story.linked', { label }) : label;
}

/** An item's picture, small: a photo's smallest copy that still fills a tile, a video's poster. */
export function pickThumb(item: PostPick): string {
  return photoUrl(item.media, 'small');
}

/**
 * The menu's buttons: the items' (at most 10), then "all". An account's (an Instagram profile)
 * starts with "analyze the account" where the chat has no button of its own for it (`analyze`),
 * and offers its stories before "all".
 */
export function pickMenuButtons(picks: PostPicks, allCount: number, strings: Record<string, string>, analyze = true): FlowButton[] {
  const items = pickWindow(picks.items).map((item) => ({ label: pickLabel(item, strings), input: item.link }));
  const { account } = picks;
  if (!account) return [...items, { label: t(strings, 'xMedia.story.all', { count: String(allCount) }), input: picks.all }];
  return [
    ...(analyze ? [{ label: t(strings, 'x.analyze.account'), input: account.analyze }] : []),
    ...items,
    ...(account.stories ? [{ label: t(strings, 'xMedia.profile.stories', { count: String(account.stories.count) }), input: account.stories.link }] : []),
    { label: t(strings, 'xMedia.profile.all', { count: String(account.allCount) }), input: picks.all },
  ];
}

/** The picture the menu shows: an account's profile picture; else the item the link opened at, else the newest. */
export function pickCover(picks: PostPicks): string {
  if (picks.account?.cover) return picks.account.cover;
  return (picks.items.find((item) => item.linked) ?? picks.items.at(-1))?.media.image ?? '';
}
