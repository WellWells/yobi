import * as path from 'node:path';
import { config as appConfig } from '../../config';
import { getLangCache, t } from '../../i18n';
import { sendLog } from '../../helpers';
import { describeVideoFile } from '../../providers/geminiVideo';
import { cleanupYtdlJobs, createYtdlJobDir, removeYtdlJobDir } from '../../youtubeDownload';
import {
  autoGeminiReader,
  destinationLimitBytes,
  isAccountLink,
  isStoryLink,
  parseXMediaInput,
  photoUrl,
  resolveXMediaDestination,
  smallestReadable,
  splitCaption,
  xPostMessage,
} from '../../../shared/xMedia';
import type { XMediaDestination, XMediaInput } from '../../../shared/xMedia';
import { TELEGRAM_UPLOAD_LIMIT_BYTES, formatButtonImages, formatFlowButtons, formatMegabytes } from '../../../shared/ytdl';
import { postAudioInput, xAnalyzeInput } from '../../../shared/builtinFlows';
import { coverForChat, keepForChat } from '../../chatMedia';
import { countDownload } from '../../downloader/usage';
import { FlowUserError } from '../userError';
import { downloadsFolder } from './fileOps';
import { saveIntoFolder } from './savedDownloads';
import { postFileStem, readLinkedThread, siteName } from './postReader';
import { readAccessOf } from './readAccess';
import { formatPostTime } from './xReader';
import { pickCover, pickMenuButtons, pickThumb, pickWindow } from './postPickMenu';
import { chooseVariant, downloadTo, fetchVariantTo, isLocked, mediaFileName, saveFolder, sizedVariants } from './postMediaFetch';
import { postAudio, postHasSound } from './postAudio';
import { telegramLimitBytes, ytdlAccessFor } from './ytdlAccess';
import type { PostPicks, XMedia, XPost } from './xPosts';

/** One item to deliver: a local file for Telegram and the computer, a URL LINE fetches itself. */
interface Delivered {
  target: string;
  /** LINE shows this before a video plays; "" for a photo, which previews itself. */
  preview: string;
  kind: XMedia['kind'];
  /** What was downloaded; 0 for a URL handed on as it is. */
  bytes: number;
  /**
   * A video LINE cannot fetch from its URL (TikTok's answer only Yobi's session): downloaded here
   * and kept on the computer, while LINE gets its poster as `target`.
   */
  kept?: string;
}

async function fetchItems(
  stem: string,
  media: XMedia[],
  destination: XMediaDestination,
  jobDir: string,
  signal: AbortSignal | undefined,
  telegramLimitBytes: number,
): Promise<Delivered[]> {
  const out: Delivered[] = [];
  // A chat's limit is a hard stop; the desktop preview may fall back to a version over it.
  const cap = destination === 'preview' ? null : destinationLimitBytes(destination, telegramLimitBytes);
  for (const [index, item] of media.entries()) {
    if (item.kind === 'photo') {
      if (destination === 'line') {
        out.push({ target: photoUrl(item, 'medium'), preview: '', kind: 'photo', bytes: 0 });
        continue;
      }
      const url = photoUrl(item, destination === 'local' ? 'orig' : 'large');
      const ext = path.extname(new URL(url).pathname) || '.jpg';
      const file = path.join(jobDir, mediaFileName(stem, index, media.length, ext));
      const bytes = await downloadTo(url, file, cap, signal);
      out.push({ target: file, preview: '', kind: 'photo', bytes });
      continue;
    }
    const file = path.join(jobDir, mediaFileName(stem, index, media.length, '.mp4'));
    if (destination === 'line' && item.variants.some(isLocked)) {
      // LINE fetches a video's URL itself, and this one answers only Yobi: the best version is kept
      // on the computer, as a YouTube download is, and LINE gets the poster.
      const best = await chooseVariant(item, 'local', signal);
      const bytes = await fetchVariantTo(best, file, null, signal);
      sendLog(`⬇️ [Media] ${item.kind} ${best.height}p ${formatMegabytes(bytes)} → ${path.basename(file)} (kept on the computer: LINE cannot fetch it)`);
      out.push({ target: photoUrl(item, 'medium'), preview: '', kind: 'photo', bytes, kept: file });
      continue;
    }
    const variant = await chooseVariant(item, destination, signal, telegramLimitBytes);
    if (destination === 'line') {
      // LINE refuses a preview over 1 MB; the small size, where the site serves one, keeps well under it.
      out.push({ target: variant.url, preview: photoUrl(item, 'small'), kind: item.kind, bytes: 0 });
      continue;
    }
    const bytes = await fetchVariantTo(variant, file, cap, signal);
    sendLog(`⬇️ [Media] ${item.kind} ${variant.height}p ${formatMegabytes(bytes)} → ${path.basename(file)}`);
    out.push({ target: file, preview: item.image, kind: item.kind, bytes });
  }
  return out;
}

/** The step's reader, `auto` meaning the first Gemini API key; "" when none is set or found. */
function readerUrl(raw: string | undefined): string {
  const choice = (raw ?? '').trim();
  if (choice.toLowerCase() !== 'auto') return choice;
  return autoGeminiReader(appConfig.byokInstances, appConfig.byokGroups);
}

/**
 * What the first video says and shows, read by Gemini. Asked only for a question about the post:
 * a bare link is forwarded as it is, and costs no request.
 */
async function readVideoContent(media: XMedia[], reader: string, signal?: AbortSignal): Promise<string> {
  const video = media.find((m) => m.kind !== 'photo');
  if (!video) return '';
  if (!reader) {
    sendLog('🎞️ [Media] No Gemini API key to watch the video — answering from the post text');
    return '';
  }
  // Gemini fetches the URL itself: a version only Yobi's session can fetch is no use to it.
  const fetchable = (await sizedVariants(video, signal)).filter((v) => !isLocked(v));
  if (fetchable.length === 0) {
    sendLog('🎞️ [Media] The video answers only Yobi, not Gemini — answering from the post text');
    return '';
  }
  const readable = smallestReadable(fetchable, video.durationMs);
  if (!readable) {
    sendLog('🎞️ [Media] The video has no version under 15 MB for Gemini to fetch — answering from the post text');
    return '';
  }
  try {
    const reading = await describeVideoFile(reader, readable.url, signal);
    sendLog(`🎞️ [Media] Gemini read the video via "${reading.keyLabel}": ${reading.text.length} chars`);
    return reading.text;
  } catch (err) {
    if (signal?.aborted) throw err;
    sendLog(`⚠️ [Media] Gemini could not read the video: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

function mediaKind(items: readonly Delivered[]): string {
  if (items.length === 0) return '';
  const kinds = new Set(items.map((i) => (i.kind === 'photo' ? 'photo' : 'video')));
  return kinds.size > 1 ? 'mixed' : [...kinds][0];
}

/** The menu's picture in the desktop chat's cache, named after the picture: another item opened gets its own. */
function menuCoverForChat(post: XPost, cover: string): Promise<string> {
  let name = '';
  try {
    name = path.basename(new URL(cover).pathname).slice(0, 80);
  } catch {
    return Promise.resolve('');
  }
  return coverForChat({ prefix: 'pick', id: `${post.id}-${name}`, url: cover, host: /(^|\.)(?:fbcdn\.net|cdninstagram\.com)$/i });
}

/** What the menu sends besides its text and buttons. */
interface MenuPictures {
  /** The step's media: the album's files for Telegram, the picture's URL, or none. */
  media: string[];
  /** Each item's picture by its button's input (none for no picture): what the desktop chat and LINE draw them with. */
  itemImages: Map<string, string>;
  /** The album numbers the items it shows, from and to. */
  album?: { from: number; to: number };
  /** The desktop chat's one picture above the menu, from its cache: an account's profile picture. */
  shown?: string;
}

/**
 * The pictures of a menu's items (`postPickMenu.ts`). The desktop chat draws each button as its
 * item's picture, kept in its cache; a button whose picture cannot be fetched stays a word.
 * Telegram gets them as one album in the buttons' order, from the same cache, so a bot step can
 * send them after this step is done — every one or none, or the numbers would not match, else
 * the linked item's picture by URL. LINE fetches each URL itself, as a carousel to tap.
 * An account's menu (an Instagram profile) shows only its profile picture.
 */
async function menuPictures(post: XPost, picks: PostPicks, destination: XMediaDestination): Promise<MenuPictures> {
  if (picks.account) {
    const cover = pickCover(picks);
    if (destination !== 'preview') return { media: [cover].filter(Boolean), itemImages: new Map() };
    return { media: [], itemImages: new Map(), shown: cover ? await menuCoverForChat(post, cover) : '' };
  }
  const items = pickWindow(picks.items);
  const thumbs = items.map(pickThumb);
  const byInput = (images: string[]) => new Map(items.flatMap((item, index) => (images[index] ? [[item.link, images[index]] as const] : [])));
  // The carousel shows the linked item among the others: no picture of its own above them.
  if (destination === 'line') return { media: [], itemImages: byInput(thumbs) };
  const cached = await Promise.all(thumbs.map((thumb) => (thumb ? menuCoverForChat(post, thumb) : Promise.resolve(''))));
  if (destination === 'preview') return { media: [], itemImages: byInput(cached) };
  if (items.length > 1 && cached.every(Boolean)) {
    return { media: cached, itemImages: new Map(), album: { from: items[0].number, to: items[items.length - 1].number } };
  }
  return { media: [pickCover(picks)].filter(Boolean), itemImages: new Map() };
}

/**
 * The menu of a link offering several items: who and how many, each item's picture, and a button
 * per item plus "all" (`postPickMenu.ts`). Nothing is downloaded but the pictures, which the chat
 * only shows: no Downloader use.
 */
async function pickMenu(post: XPost, picks: PostPicks, destination: XMediaDestination): Promise<string> {
  const strings = getLangCache();
  const pictures = await menuPictures(post, picks, destination);
  const count = String(picks.items.length);
  // An account's menu (an Instagram profile) carries its bio above the choice.
  const text = picks.account
    ? [post.text, t(strings, 'xMedia.profile.menu')].filter(Boolean).join('\n\n')
    : pictures.album
      ? t(strings, 'xMedia.story.menuAlbum', { count, from: String(pictures.album.from), to: String(pictures.album.to) })
      : t(strings, 'xMedia.story.menu', { count });
  const message = xPostMessage({ name: post.name, author: post.author, text, link: post.link });
  // The desktop chat has its own "analyze" button under the turn; a bot chat's is in the menu.
  // Pictures follow the buttons' inputs, not their places: an account's starts with "analyze".
  const buttons = pickMenuButtons(picks, post.media.length, strings, destination !== 'preview').map((button) => {
    const image = pictures.itemImages.get(button.input);
    return image ? { ...button, image } : button;
  });
  const shown = pictures.shown ?? '';
  sendLog(`🐦 [Media] ${picks.items.length} items to choose from — menu sent with ${pictures.album ? `an album of ${pictures.media.length}` : `${pictures.itemImages.size || (shown ? 1 : 0)} pictures`}, nothing downloaded`);
  const photos = pictures.media;
  return JSON.stringify({
    // The desktop chat writes a turn only for a step with output: its menu is the text (an
    // account's, its profile picture), the pictures are its buttons. A bot step reads the fields
    // below, never a text as a file.
    output: destination === 'preview' ? shown || message : photos.join('\n'),
    previews: '',
    count: String(photos.length || (shown ? 1 : 0)),
    kind: photos.length > 0 || shown ? 'photo' : '',
    message,
    caption: message,
    overflow: '',
    text: '',
    author: post.author ? `@${post.author}` : '',
    name: post.name,
    date: formatPostTime(post.createdAt),
    link: post.link,
    prompt: '',
    videoText: '',
    savedLocally: '0',
    chatMedia: shown,
    summary: '',
    notice: '',
    analyze: '',
    mp3: '',
    buttons: formatFlowButtons(buttons),
    buttonImages: formatButtonImages(buttons),
    title: '',
    card: '',
  });
}

/**
 * The post's text and media, with no progress reported: unlike a YouTube download, a forwarded
 * post shows no status line — quality, percentage or time left — only the post itself.
 */
export async function execXMedia(config: Record<string, string>, signal?: AbortSignal): Promise<string> {
  const raw = (config.input ?? '').trim();
  const input = parseXMediaInput(raw);
  if (!input) throw new FlowUserError('flow.error.xPostUrl', { url: raw }, `X media: no X, Threads, Instagram, Facebook, TikTok, PTT, Dcard or Reddit post link in: ${raw}`);
  // The "MP3" built-ins: the post's videos as MP3s, one Downloader use as a video's MP3 is.
  if (config.audio === 'mp3') return countDownload(input.source, signal, () => postAudio(input, config, signal));
  // A question about the post is answered, not downloaded: no Downloader use. Nor is a menu of a
  // person's stories, which only offers the download a button then runs.
  const done = await countDownload(input.prompt === '' ? input.source : null, signal, () => postMedia(input, config, signal), (r) => !r.menu);
  return done.json;
}

async function postMedia(
  input: XMediaInput,
  config: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<{ json: string; menu: boolean }> {
  const destination = resolveXMediaDestination(config.destination, config.__triggerPlatform);
  const site = siteName(input.source);
  sendLog(`🐦 [${site}] Media of ${input.id} → ${destination}`);
  const { focal: post } = await readLinkedThread(input, 'media', signal, readAccessOf(config));
  // A post that only quotes a video: the video it quotes is what the person wants.
  const media = post.media.length > 0 ? post.media : post.quoteMedia;
  // Words besides the link ask about the post: that is answered, not forwarded, so nothing is
  // downloaded — a video too large to send must not stop the answer.
  const forwarding = input.prompt === '';
  const account = isAccountLink(input);
  // A link offering a choice (a person's stories): a chat gets the menu; a step saving to this
  // computer, which cannot ask, takes them all.
  if (forwarding && post.picks && destination !== 'local') return { json: await pickMenu(post, post.picks, destination), menu: true };

  void cleanupYtdlJobs().catch(() => {});
  const jobDir = await createYtdlJobDir();
  try {
    // A Telegram chat gets the best version under the person's limit: 100 MB without the admin
    // right, else what the bot can send now (`telegramLimitBytes`).
    const telegramLimit = destination === 'telegram' ? telegramLimitBytes(await ytdlAccessFor(config)) : TELEGRAM_UPLOAD_LIMIT_BYTES;
    const fetched = forwarding ? await fetchItems(postFileStem(input.source, post), media, destination, jobDir, signal, telegramLimit) : [];
    let saved = fetched;
    if (destination === 'preview' && fetched.length > 0) {
      saved = [];
      for (const item of fetched) saved.push({ ...item, target: await keepForChat(item.target, path.basename(item.target)) });
    }
    // Downloads go to the downloads folder, what a Telegram bot step sends too; the folder's
    // three-day cleanup removes them.
    if ((destination === 'local' || destination === 'telegram') && fetched.length > 0) {
      const folder = saveFolder(input, post, fetched.length, config.folder);
      saved = [];
      for (const item of fetched) saved.push({ ...item, target: await saveIntoFolder(item.target, folder, path.basename(item.target)) });
      sendLog(`💾 [${site}] Saved ${saved.length} file(s) to ${folder}`);
    }
    const kept: string[] = [];
    for (const item of fetched) {
      if (item.kept) kept.push(await saveIntoFolder(item.kept, downloadsFolder(config.folder), path.basename(item.kept)));
    }
    const videoText = forwarding ? '' : await readVideoContent(media, readerUrl(config.reader), signal);
    const parts = { name: post.name, author: post.author, text: post.text, link: post.link, heading: post.heading };
    const split = splitCaption(parts, destination, saved.length > 0);
    const strings = getLangCache();
    const keptLine = kept.length > 0
      ? t(strings, 'xMedia.notice.lineVideoKept', { site, file: kept.length === 1 ? kept[0] : path.dirname(kept[0]) })
      : '';
    const caption = [split.caption, keptLine].filter(Boolean).join('\n\n');
    const { overflow } = split;
    const summary = destination === 'local' && saved.length > 0
      ? t(strings, 'xMedia.summary.saved', { count: String(saved.length), folder: `\`${path.dirname(saved[0].target)}\`` })
      : '';
    const json = JSON.stringify({
      // One per line: a bot step sends several as one album.
      output: saved.map((i) => i.target).join('\n'),
      previews: saved.map((i) => i.preview).join('\n'),
      count: String(saved.length),
      kind: mediaKind(saved),
      message: xPostMessage(parts),
      caption,
      overflow,
      text: post.text,
      author: post.author ? `@${post.author}` : '',
      name: post.name,
      date: formatPostTime(post.createdAt),
      link: post.link,
      prompt: input.prompt,
      videoText,
      savedLocally: destination === 'local' && saved.length > 0 ? '1' : '0',
      // Shown in the desktop chat, not kept: the cache the chat reads from.
      chatMedia: destination === 'preview' ? saved.map((i) => i.target).join('\n') : '',
      summary,
      notice: media.length === 0 ? t(strings, 'xMedia.notice.none') : '',
      // The "analyze" button's line; a story has no caption or comments to analyze. An account's
      // (an Instagram profile's "all") is named for the account, so it rides in `buttons`.
      analyze: isStoryLink(input) || account ? '' : xAnalyzeInput(post.link),
      // The "MP3" button's line, for a forwarded post with a video. A story keeps its own link
      // (`?yobi=one` names the one story); an account's many posts get none.
      mp3: forwarding && !account && postHasSound(media) ? postAudioInput(isStoryLink(input) ? input.url : post.link) : '',
      // A menu's choices and their pictures (`pickMenu`); none here but an account's "analyze",
      // and the forward's bot step reads the fields.
      buttons: account && destination !== 'preview'
        ? formatFlowButtons([{ label: t(strings, 'x.analyze.account'), input: xAnalyzeInput(post.link) }])
        : '',
      buttonImages: '',
      // A forum article's title, which names the chat, and its header as a card for the desktop
      // chat to draw in place of the message's opening block (`h`).
      title: post.card?.title ?? '',
      card: post.card && post.heading ? JSON.stringify({ ...post.card, h: post.heading }) : '',
    });
    return { json, menu: false };
  } finally {
    await removeYtdlJobDir(jobDir).catch(() => {});
  }
}
