import { coverForChat } from '../../chatMedia';
import { sendLog } from '../../helpers';
import { getSiteAccountStatus } from '../../siteAccounts';
import { SitePageTimeout, renewSitePageCookie, sitePagePartition, withAccountPage, withSitePage } from '../../sitePage';
import { classifySiteCheckFailure } from '../../youtubeDownload/ytdlErrors';
import type { SitePage } from '../../sitePage';
import { errorText } from '../../../shared/errorText';
import { bilibiliVideoUrl, parseResolvedBilibiliUrl } from '../../../shared/linkSites/bilibiliLinks';
import { siteLabel } from '../../../shared/linkSites/rows';
import type { VideoRef } from '../../../shared/linkSites/types';
import { FlowUserError } from '../userError';
import { BILIBILI_TOKEN_COOKIE, bilibiliSiteArgs } from './bilibiliDownload';
import { apiCode, bilibiliChoices, isPaidVideo, isPreviewPlayurl, missingReason, readVideoData } from './bilibiliParse';
import type { BilibiliVideoData } from './bilibiliParse';
import { pickSubtitle, playerInfoUrl, readSubtitleList, subtitleText, trackOwner, tracksOfVideo } from './bilibiliSubtitles';
import type { SubtitleList, SubtitleTrack } from './bilibiliSubtitles';
import { obj, str } from './jsonPick';
import { signedInOnlyError } from './readAccess';
import type { ReadAccess } from './readAccess';
import { resolveShortLink } from './siteFetch';
import { cuesFromBilibili } from './srt';
import type { SubtitleCue } from './srt';
import type { TimedSubtitles, VideoInfo, VideoSite } from './videoSiteTypes';

/*
 * A bilibili video, read the way its own page reads it: the page in a hidden window
 * (`sitePage.ts`), its `__INITIAL_STATE__.videoData` for the title and part, then the player's own
 * quality list and subtitle list from inside the page (`bilibiliSubtitles.ts`); no signing code.
 *
 * Two windows, two partitions: the quality list is read signed out in the reader's, the same one
 * yt-dlp downloads with, so the menu offers what yt-dlp can fetch; the subtitles in the sign-in's,
 * whose cookies never leave Yobi's own windows.
 */

/**
 * The page's video, or `{ missing }` once the page shows none: bilibili sends a gone video to
 * its home page (`selfDef.errorpage`). `{ notVideo }` (the path it went to) when the video link
 * turned out to be something else: the page moved off `/video/`, or its data points elsewhere
 * (`redirect_url`, a series episode the page is about to move to). While the page has not
 * opened or the script check runs there is no state yet: null, keep waiting.
 */
export const VIDEO_DATA_PROBE = `(() => {
  if (location.href.includes('selfDef.errorpage')) return { missing: true };
  if (!/(^|\\.)bilibili\\.com$/.test(location.hostname)) return null;
  if (!location.pathname.startsWith('/video/')) return { notVideo: location.pathname };
  const state = window.__INITIAL_STATE__;
  if (!state) return null;
  const data = state.videoData;
  if (data && data.redirect_url) return { notVideo: String(data.redirect_url).split('?')[0] };
  return data && data.bvid ? { videoData: JSON.stringify(data) } : { missing: true };
})()`;

/** Runs a GET on bilibili's API from inside the page (its cookies, its origin) and gives back the body. */
function apiScript(url: string): string {
  return `(async () => {
  const response = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
  return await response.text();
})()`;
}

/**
 * The same GET for a read the video does not depend on (subtitles): "" when it fails, so only a
 * Stop or the read's deadline ends the page. `withCookies` false for bilibili's file host, which
 * the player reads without them.
 */
function softApiScript(url: string, withCookies = true, fresh = false): string {
  const cache = fresh ? `, cache: 'no-store'` : '';
  return `(async () => {
  try {
    const response = await fetch(${JSON.stringify(url)}, { credentials: '${withCookies ? 'include' : 'omit'}'${cache} });
    return response.ok ? await response.text() : '';
  } catch {
    return '';
  }
})()`;
}

function parsedOrNull(body: unknown): unknown {
  try {
    return JSON.parse(String(body));
  } catch {
    return null;
  }
}

/**
 * The quality list the site's own player asks for, from the unsigned endpoint.
 */
export function playurlUrl(bvid: string, cid: number): string {
  return `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=4048&fourk=1&try_look=1&qn=80`;
}

/** Why a page showed no video: the unsigned video-info API says gone or hidden by its code. */
export function viewUrl(id: string): string {
  const query = id.startsWith('av') ? `aid=${id.slice(2)}` : `bvid=${id}`;
  return `https://api.bilibili.com/x/web-interface/wbi/view?${query}`;
}

function site(): string {
  return siteLabel('bilibili');
}

/** An address without its query: a share link's carries the sharer's ids. */
function withoutQuery(location: string): string {
  try {
    const url = new URL(location);
    return `${url.host}${url.pathname}`;
  } catch {
    return 'an unreadable address';
  }
}

/** The video a link names: a share link resolved first, then held to the same rules as a pasted one. */
async function resolveLink(ref: VideoRef, signal?: AbortSignal): Promise<{ id: string; part: number }> {
  if (ref.kind !== 'short') return { id: ref.id, part: Number(/^p=(\d+)$/.exec(ref.variant ?? '')?.[1] ?? 1) };
  let location: string | null;
  try {
    location = await resolveShortLink(ref.url, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `Could not open the bilibili short link: ${errorText(err)}`);
  }
  if (location === null) {
    throw new FlowUserError('flow.error.shortLinkExpired', { site: site() }, 'The bilibili short link has expired');
  }
  const link = parseResolvedBilibiliUrl(location);
  if (!link) {
    throw new FlowUserError('flow.error.linkNotVideo', { site: site() }, `The bilibili short link leads to ${withoutQuery(location)}, not a video`);
  }
  return { id: link.id, part: link.part };
}

async function missingError(page: SitePage, id: string): Promise<FlowUserError> {
  const body = await page.evaluate(apiScript(viewUrl(id))).catch(() => '');
  let code: number | null = null;
  try {
    code = apiCode(JSON.parse(String(body)));
  } catch {
  }
  const reason = missingReason(code);
  if (reason === 'hidden') {
    return new FlowUserError('flow.error.videoHidden', { site: site() }, `The bilibili video ${id} is not visible (${code})`);
  }
  if (reason === 'notFound') {
    return new FlowUserError('flow.error.videoNotFound', { site: site() }, `The bilibili video ${id} does not exist`);
  }
  return new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `The bilibili page showed no video (${code ?? 'no code'})`);
}

/** What a read asks of the page beyond the video itself. */
interface PageWants {
  /** The player's quality list (the menu, a download): the reader's window only. */
  qualities: boolean;
  /** The subtitle list (whether a summary can be made): the sign-in's window only. */
  subtitles: boolean;
  /** The chosen subtitle track's words (a summary, the connector); implies the list. */
  words: boolean;
}

/** No list read: says nothing about the account or the tracks. */
const NO_SUBTITLE_LIST: SubtitleList = { signedIn: null, tracks: [] };

/** The video's page as read: the qualities, subtitle list and words when asked for. */
export interface PageRead {
  data: BilibiliVideoData;
  playurl: unknown;
  /** `NO_SUBTITLE_LIST` when the list was not asked for. */
  subtitles: SubtitleList;
  /**
   * The track `words` read: its text ("" when the file was empty) and its timed cues (the .srt);
   * null when none was read.
   */
  words: { track: SubtitleTrack; text: string; cues: SubtitleCue[] } | null;
}

function paidError(id: string, what: string): FlowUserError {
  return new FlowUserError('flow.error.videoPaid', { site: site() }, `The bilibili video ${id} is for paying viewers only (${what})`);
}

/** How often the list is asked for while the track it would give is another video's. */
export const SUBTITLE_LIST_ATTEMPTS = 3;

/**
 * The subtitle list, and with `words` the chosen track's text. The list failing to read leaves the
 * menu without "summary"; asked for the words, a list or file that cannot be read is an error, not
 * "no subtitles". The list sometimes names another video's machine subtitles (`trackOwner`): while
 * the track it would give is one, it is asked again, uncached; such tracks are never read, and with
 * nothing of this video's left that is said rather than summing up someone else's words.
 */
async function readSubtitles(page: SitePage, data: BilibiliVideoData, words: boolean): Promise<Pick<PageRead, 'subtitles' | 'words'>> {
  const readList = async (fresh: boolean): Promise<SubtitleList> =>
    readSubtitleList(parsedOrNull(await page.evaluate(softApiScript(playerInfoUrl(data.bvid, data.cid), true, fresh))));
  const unreadable = (what: string): FlowUserError =>
    new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `Could not read the bilibili ${what} of ${data.bvid}`);
  let list = await readList(false);
  if (!words) return { subtitles: list, words: null };
  const wantsForeign = (tracks: readonly SubtitleTrack[]): boolean => {
    const wanted = pickSubtitle(tracks);
    return wanted !== null && trackOwner(wanted, data) === 'other';
  };
  for (let attempt = 1; attempt < SUBTITLE_LIST_ATTEMPTS && wantsForeign(list.tracks); attempt++) {
    sendLog(`[Ytdl] bilibili: the subtitle list of ${data.bvid} named another video's subtitles — asking again`);
    list = await readList(true);
  }
  if (list.signedIn === null) throw unreadable('subtitle list');
  const { own, foreign } = tracksOfVideo(list.tracks, data);
  const subtitles: SubtitleList = { ...list, tracks: own };
  const track = pickSubtitle(own);
  if (!track) {
    if (foreign.length === 0) return { subtitles, words: null };
    sendLog(`[Ytdl] bilibili: ${data.bvid} — every subtitle track named another video (${foreign.map((t) => t.lan).join(', ')})`);
    throw new FlowUserError('flow.error.videoSubtitlesMismatch', { site: site() }, `bilibili kept naming another video's subtitles for ${data.bvid}`);
  }
  sendLog(`[Ytdl] bilibili: subtitles of ${data.bvid}: ${track.lan} (${trackOwner(track, data) === 'match' ? 'aid/cid match' : 'no ids in the name'})`);
  const file = parsedOrNull(await page.evaluate(softApiScript(track.url, false)));
  if (file === null) throw unreadable(`${track.lan} subtitles`);
  return { subtitles, words: { track, text: subtitleText(file), cues: cuesFromBilibili(file) } };
}

async function readPage(page: SitePage, id: string, part: number, wants: PageWants): Promise<PageRead> {
  const probe = obj(await page.waitFor(VIDEO_DATA_PROBE));
  const elsewhere = str(probe?.notVideo);
  if (elsewhere) {
    throw new FlowUserError('flow.error.linkNotVideo', { site: site() }, `The bilibili video ${id} leads to ${elsewhere}, not a video`);
  }
  const videoData = str(probe?.videoData);
  if (!videoData) throw await missingError(page, id);
  const raw: unknown = JSON.parse(videoData);
  if (isPaidVideo(raw)) throw paidError(id, 'the page says so');
  const data = readVideoData(raw, part);
  if (!data) {
    throw new FlowUserError('flow.error.videoNotFound', { site: site() }, `The bilibili video ${id} has no part ${part}`);
  }
  let playurl: unknown = null;
  if (wants.qualities) {
    playurl = JSON.parse(String(await page.evaluate(apiScript(playurlUrl(data.bvid, data.cid)))));
    const code = apiCode(playurl);
    if (code !== 0) {
      throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `bilibili gave no quality list (code ${code})`);
    }
    // A trial clip in place of the video: never offered as the video's qualities.
    if (isPreviewPlayurl(playurl)) throw paidError(id, 'only a trial clip is streamed');
  }
  if (!wants.subtitles && !wants.words) return { data, playurl, subtitles: NO_SUBTITLE_LIST, words: null };
  return { data, playurl, ...(await readSubtitles(page, data, wants.words)) };
}

/**
 * The video's page read in one of the site's hidden windows (`withSitePage`, the reader's;
 * `withAccountPage`, the sign-in's); every failure in the person's words.
 */
async function readVideo(
  open: typeof withSitePage,
  id: string,
  part: number,
  wants: PageWants,
  signal?: AbortSignal,
): Promise<PageRead> {
  try {
    return await open('bilibili', bilibiliVideoUrl(id, part), signal, (page) => readPage(page, id, part, wants));
  } catch (err) {
    if (signal?.aborted || err instanceof FlowUserError) throw err;
    if (err instanceof SitePageTimeout) {
      throw new FlowUserError('flow.error.videoPageTimeout', { site: site() }, err.message);
    }
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `Could not read the bilibili video: ${errorText(err)}`);
  }
}

/**
 * The subtitle list for the menu's "summary", read in the sign-in's window. Signed out there is
 * none to read (subtitles are given only to an account), so no window opens. A read that fails
 * leaves the menu as an unreadable list does; a Stop goes up as it is. Not `allowed` the sign-in
 * (someone else's bot message): no list and no "sign in" note — nobody in that chat can sign in.
 */
async function menuSubtitles(id: string, part: number, signal: AbortSignal | undefined, allowed: boolean): Promise<SubtitleList> {
  if (!allowed) return NO_SUBTITLE_LIST;
  if (!(await getSiteAccountStatus('bilibili'))) return { signedIn: false, tracks: [] };
  try {
    return (await readVideo(withAccountPage, id, part, { qualities: false, subtitles: true, words: false }, signal)).subtitles;
  } catch (err) {
    if (signal?.aborted) throw err;
    sendLog(`[Ytdl] bilibili: could not read the subtitle list: ${errorText(err)}`);
    return NO_SUBTITLE_LIST;
  }
}

/**
 * A video's subtitles are the uploader's public text, so the owner's sign-in reads them for anyone
 * who may use the downloader. Absent access = the owner's own runs.
 */
function mayReadSubtitles(access?: Pick<ReadAccess, 'signIn'>): boolean {
  return (access?.signIn ?? 'full') !== 'none';
}

async function bilibiliInfo(ref: VideoRef, signal?: AbortSignal, access?: Pick<ReadAccess, 'signIn'>): Promise<VideoInfo> {
  const { id, part } = await resolveLink(ref, signal);
  const { data, playurl } = await readVideo(withSitePage, id, part, { qualities: true, subtitles: false, words: false }, signal);
  // The video itself is never the sign-in's (the reader's partition). Its subtitles are public text,
  // so every run reads them with the sign-in except one whose bot trigger could not be resolved.
  const subtitles = await menuSubtitles(data.bvid, part, signal, mayReadSubtitles(access));
  const video: VideoRef = {
    site: 'bilibili',
    shape: 'video',
    url: bilibiliVideoUrl(data.bvid, part),
    id: data.bvid,
    author: '',
    ...(part > 1 ? { variant: `p=${part}` } : {}),
  };
  // Subtitles are given only to a signed-in account: a summary and an .srt need one, and a track to read.
  const words = subtitles.signedIn === true && pickSubtitle(subtitles.tracks) !== null;
  return {
    ref: video,
    title: data.title,
    channel: data.owner,
    durationS: data.durationS,
    cover: data.cover,
    summary: words,
    summaryNeedsSignIn: subtitles.signedIn === false,
    ...(words ? { subtitles: (stop?: AbortSignal) => bilibiliSubtitles(video, stop) } : {}),
    // Every quality is H.264 with AAC; Telegram may price one with the low AAC so it fits whole.
    choices: (destination, includeSmall = false, limitBytes) => bilibiliChoices(playurl, includeSmall, data.durationS, destination, limitBytes),
  };
}

/**
 * A video's page read with its subtitle words in the sign-in's window, for the summary and the
 * connector: the link resolved as the menu resolves it, no quality list asked for.
 */
export async function readBilibiliWords(ref: VideoRef, signal?: AbortSignal): Promise<PageRead> {
  const { id, part } = await resolveLink(ref, signal);
  return readVideo(withAccountPage, id, part, { qualities: false, subtitles: true, words: true }, signal);
}

/**
 * The video's subtitle text for a summary, or null when it has none. Signed out bilibili gives
 * no subtitles at all, so that says why instead of "no subtitles". For a run whose bot trigger
 * could not be resolved (`none`): said so before any window opens.
 */
async function bilibiliTranscript(ref: VideoRef, signal?: AbortSignal, access?: Pick<ReadAccess, 'signIn'>): Promise<string | null> {
  if (!mayReadSubtitles(access)) throw signedInOnlyError('bilibili', ref.url);
  const { subtitles, words } = await readBilibiliWords(ref, signal);
  if (subtitles.signedIn === false) {
    throw new FlowUserError('flow.error.videoSummaryNeedsSignIn', { site: site() }, 'bilibili gives subtitles only to a signed-in account');
  }
  return words?.text || null;
}

/**
 * The chosen track's timed cues for an .srt, read as the summary reads its words (the sign-in's
 * window). Signed out since the menu: said so; no track any more: no cues.
 */
async function bilibiliSubtitles(ref: VideoRef, signal?: AbortSignal): Promise<TimedSubtitles> {
  const { subtitles, words } = await readBilibiliWords(ref, signal);
  if (subtitles.signedIn === false) {
    throw new FlowUserError('flow.error.videoSubtitlesNeedSignIn', { site: site() }, 'bilibili gives subtitles only to a signed-in account');
  }
  return { language: words?.track.lan ?? '', auto: words?.track.ai ?? false, cues: words?.cues ?? [] };
}

/**
 * yt-dlp was refused (HTTP 412): the video's own page is read again with its page token forgotten
 * so it earns a fresh one, and only a page that went on to show its video counts. A Stop ends it
 * at once; any other failure means no retry.
 */
async function refreshToken(ref: VideoRef, signal?: AbortSignal): Promise<boolean> {
  try {
    return await renewSitePageCookie('bilibili', ref.url, BILIBILI_TOKEN_COOKIE, signal, async (page) => {
      const probe = obj(await page.waitFor(VIDEO_DATA_PROBE));
      if (!str(probe?.videoData)) throw new Error('the page showed no video');
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    sendLog(`[Ytdl] bilibili: could not renew the page token: ${errorText(err)}`);
    return false;
  }
}

export const bilibiliVideo: VideoSite = {
  info: bilibiliInfo,
  // Every quality is H.264 with AAC: where it goes changes the MP3's bitrate and, for a Telegram
  // quality priced with the low AAC, the audio.
  downloadArgs: (ref, quality, destination, lowAudio) => bilibiliSiteArgs(ref, quality, destination, lowAudio),
  // The reader's partition, never the sign-in's: the page read just before the download left its
  // token there.
  cookies: { partition: sitePagePartition('bilibili') },
  classify: classifySiteCheckFailure,
  refreshBlocked: refreshToken,
  transcript: bilibiliTranscript,
  chatCover: (info) => coverForChat({ prefix: 'bili', id: info.ref.id, url: info.cover, host: /(^|\.)hdslb\.com$/i }),
};
