import { session } from 'electron';
import { coverForChat } from '../../chatMedia';
import { downloadStreams } from '../../downloader/streamDownload';
import { estimateBytes, renditionChoices, renditionFor } from '../../downloader/streamChoices';
import { fetchStreamText, hostAllowlist } from '../../downloader/streamFetch';
import type { StreamRequestOptions } from '../../downloader/streamFetch';
import { ProtectedStreamError, StreamFormatError } from '../../downloader/streamTypes';
import { sendLog } from '../../helpers';
import { fetchRawResponse } from '../../pageLoader';
import { SitePageTimeout, sitePagePartition, withSitePage } from '../../sitePage';
import { offerSiteVerification } from '../../siteVerification';
import { userAgentForUrl } from '../../userAgent';
import { YtdlError, ytdlFailureMessage } from '../../youtubeDownload/ytdlErrors';
import type { YtdlDownloadResult } from '../../youtubeDownload';
import { errorText } from '../../../shared/errorText';
import { MP3_BITRATE_KBPS } from '../../../shared/ytdl';
import { siteLabel } from '../../../shared/linkSites/rows';
import { isVimeoHost, parseVimeoUrl, vimeoPlayerUrl } from '../../../shared/linkSites/vimeoLinks';
import type { VimeoLink } from '../../../shared/linkSites/vimeoLinks';
import type { VideoRef } from '../../../shared/linkSites/types';
import { FlowUserError } from '../userError';
import { NAVIGATION_HEADERS, stayOnHosts } from './siteFetch';
import { cuesFromVtt } from './srt';
import type { SelfDownloadRequest, SelfDownloadVideoSite, TimedSubtitles, VideoInfo } from './videoSiteTypes';
import { pageFailure, pickTextTrack, playerConfigJson, readPlayerConfig } from './vimeoParse';
import type { VimeoConfig, VimeoPageFailure, VimeoTextTrack } from './vimeoParse';
import { SignedLinks, isVimeoMediaHost, readVimeoRenditions, soundPlan, videoPlans } from './vimeoStreams';
import type { VimeoRendition } from './vimeoStreams';

/*
 * Vimeo (signed out; private videos are out of scope): a pasted link gets the quality menu, the
 * MP3 and the subtitles (.srt) as YouTube's does, and Yobi downloads the streams itself
 * (`SelfDownloadVideoSite`; no yt-dlp).
 *
 * The configuration comes from the embed player's page, fetched with Electron's network stack in
 * an in-memory session (`vimeo-reader`); when a challenge stops that request, the same page is
 * read in a hidden window on that session. Refused before the menu: DRM (`request.drm`, a `/drm/`
 * path), a video that plays only where it is embedded, a live event.
 */

const READER_PARTITION = sitePagePartition('vimeo');
/** A challenge that does not pass in this long is given up (the window's own limit is longer). */
const CHALLENGE_WAIT_MS = 30_000;
/** The caption files: `captions.vimeo.com`, signed for an hour. */
const isCaptionHost = hostAllowlist(['vimeo.com', 'vimeocdn.com']);

/** A redirect off Vimeo's own hosts ends the read. */
function stayOnVimeo(host: string): void {
  stayOnHosts('Vimeo', isVimeoHost)(host);
}

function site(): string {
  return siteLabel('vimeo');
}

/**
 * The player page's own answer as the page sees it: its configuration, or — on a final error page
 * (not found, a privacy refusal) — its status and HTML. Null while a challenge is still running.
 * Runs in the page, so plain ES2017.
 */
const PLAYER_PROBE = `(() => {
  if (window.playerConfig) return JSON.stringify({ config: window.playerConfig });
  var nav = performance.getEntriesByType('navigation')[0];
  var status = nav && nav.responseStatus;
  var html = document.documentElement ? document.documentElement.outerHTML : '';
  if (status === 404 || (status === 403 && html.indexOf('PrivacyError') >= 0)) return JSON.stringify({ status: status, html: html.slice(0, 20000) });
  return null;
})()`;

function readerSession(): Electron.Session {
  return session.fromPartition(READER_PARTITION);
}

function pageError(failure: VimeoPageFailure, status: number, id: string): FlowUserError {
  if (failure === 'embedOnly') {
    return new FlowUserError('flow.error.videoEmbedOnly', { site: site() }, `The Vimeo video ${id} plays only on the site that embeds it`);
  }
  if (failure === 'unavailable') return new FlowUserError('flow.error.videoHidden', { site: site() }, `The Vimeo video ${id} is not public`);
  if (failure === 'notFound') return new FlowUserError('flow.error.videoNotFound', { site: site() }, `The Vimeo video ${id} does not exist`);
  return new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `The Vimeo player answered ${status} with no configuration`);
}

/** Whether the verification window's page is past the challenge: the player's configuration is there. */
async function playerShown(contents: Electron.WebContents): Promise<boolean> {
  return (await contents.executeJavaScript('Boolean(window.playerConfig)')) === true;
}

/**
 * The player page through the hidden window, past the challenge; every failure in the person's
 * words. A challenge the hidden window cannot pass silently is offered to the person (the shared
 * verification window, from a desktop notification): video menus are not started interactively.
 */
async function readInWindow(link: VimeoLink, signal: AbortSignal | undefined): Promise<VimeoConfig> {
  const url = vimeoPlayerUrl(link.id, link.hash);
  let answer: unknown;
  try {
    answer = await withSitePage('vimeo', url, signal, (page) => page.waitFor(PLAYER_PROBE, CHALLENGE_WAIT_MS));
  } catch (err) {
    if (signal?.aborted || err instanceof FlowUserError) throw err;
    if (err instanceof SitePageTimeout) {
      throw offerSiteVerification({ site: 'vimeo', partition: READER_PARTITION, url, isCleared: playerShown });
    }
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `Could not read the Vimeo player: ${errorText(err)}`);
  }
  let parsed: { config?: unknown; status?: number; html?: string };
  try {
    parsed = JSON.parse(String(answer)) as typeof parsed;
  } catch {
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, 'The Vimeo player page answered with something unreadable');
  }
  const config = readPlayerConfig(parsed.config);
  if (config) return config;
  const status = parsed.status ?? 0;
  throw pageError(pageFailure(status, parsed.html ?? ''), status, link.id);
}

/** The player's configuration: Yobi's own request first, the hidden window when a challenge stops it. */
async function readConfig(link: VimeoLink, signal: AbortSignal | undefined): Promise<VimeoConfig> {
  const url = vimeoPlayerUrl(link.id, link.hash);
  let page: { status: number; text: string };
  try {
    page = await fetchRawResponse(url, {
      headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
      validateRedirectHost: stayOnVimeo,
      cookiesFrom: readerSession(),
      signal,
    });
  } catch (err) {
    signal?.throwIfAborted();
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `Could not open the Vimeo player: ${errorText(err)}`);
  }
  const config = page.status === 200 ? readPlayerConfig(playerConfigJson(page.text)) : null;
  if (config) return config;
  const failure = pageFailure(page.status, page.text);
  if (failure !== 'challenge') throw pageError(failure, page.status, link.id);
  sendLog(`[Ytdl] Vimeo answered ${page.status} to Yobi's request; reading the player in a hidden window`);
  return readInWindow(link, signal);
}

/** Fresh signed links (`config_refresh_url`, the reader's session): null when there are none to have. */
async function refreshConfig(config: VimeoConfig, signal: AbortSignal | undefined): Promise<VimeoConfig | null> {
  if (!config.refreshUrl) return null;
  const answer = await fetchRawResponse(config.refreshUrl, {
    headers: { 'User-Agent': userAgentForUrl(config.refreshUrl), Accept: 'application/json' },
    validateRedirectHost: stayOnVimeo,
    cookiesFrom: readerSession(),
    signal,
  });
  if (answer.status !== 200) throw new Error(`the refresh answered ${answer.status}`);
  // It answers with the configuration's `request` part alone.
  const fresh = readPlayerConfig({ video: {}, request: JSON.parse(answer.text) as unknown });
  sendLog(`[Ytdl] Vimeo: signed links refreshed for a long download${fresh ? '' : ' (nothing readable)'}`);
  return fresh;
}

/** A failure while reading the streams for the menu, in the person's words. */
function infoFailure(err: unknown, signal: AbortSignal | undefined): unknown {
  if (signal?.aborted || err instanceof FlowUserError) return err;
  if (err instanceof ProtectedStreamError) {
    return new FlowUserError('flow.error.videoDrm', { site: site() }, `Vimeo protects this video (${err.scheme})`);
  }
  if (err instanceof StreamFormatError && err.live) return new FlowUserError('flow.error.ytdlLive', {}, 'The Vimeo video is live');
  return new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `Could not read the Vimeo streams: ${errorText(err)}`);
}

/** The chosen caption track as timed cues (a WebVTT file, fetched plainly). */
async function readSubtitles(track: VimeoTextTrack, signal?: AbortSignal): Promise<TimedSubtitles> {
  try {
    const { text } = await fetchStreamText(track.url, { isAllowedHost: isCaptionHost, ...(signal ? { signal } : {}) }, 5_000_000);
    return { language: track.language, auto: track.auto, cues: cuesFromVtt(text) };
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new FlowUserError('flow.error.subtitlesUnreadable', { site: site() }, `Could not read the Vimeo captions: ${errorText(err)}`);
  }
}

interface VimeoRead {
  config: VimeoConfig;
  renditions: VimeoRendition[];
}

/** What the menu's read found, for the download that follows it (`SelfDownloadRequest.info`). */
const reads = new WeakMap<VideoInfo, VimeoRead>();

async function vimeoInfo(ref: VideoRef, signal?: AbortSignal): Promise<VideoInfo> {
  const link = parseVimeoUrl(ref.url);
  if (!link) throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `${ref.url} is not a Vimeo video link`);
  const config = await readConfig(link, signal);
  if (config.drm) throw new FlowUserError('flow.error.videoDrm', { site: site() }, `Vimeo protects the video ${link.id} (DRM)`);
  if (config.live === 'live') throw new FlowUserError('flow.error.ytdlLive', {}, 'The Vimeo video is a live event');
  if (config.live === 'upcoming') throw new FlowUserError('flow.error.ytdlUpcoming', {}, 'The Vimeo live event has not started yet');
  let renditions: VimeoRendition[];
  try {
    renditions = await readVimeoRenditions(config, { isAllowedHost: isVimeoMediaHost, ...(signal ? { signal } : {}) });
  } catch (err) {
    throw infoFailure(err, signal);
  }
  if (renditions.length === 0) {
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `The Vimeo video ${link.id} has no H.264 stream`);
  }
  const track = pickTextTrack(config.textTracks);
  const { durationS } = config;
  const info: VideoInfo = {
    ref: { site: 'vimeo', shape: 'video', url: link.url, id: link.id, author: '' },
    title: config.title,
    channel: config.channel,
    durationS,
    cover: config.cover,
    summary: false,
    ...(track ? { subtitles: (subtitlesSignal?: AbortSignal) => readSubtitles(track, subtitlesSignal) } : {}),
    // Each variant's bandwidth covers its sound, so nothing is added for the separate track.
    choices: (_destination, includeSmall = false) => renditionChoices(renditions, 0, durationS, { includeSmall, aac: true }),
  };
  reads.set(info, { config, renditions });
  return info;
}

async function vimeoDownload(request: SelfDownloadRequest): Promise<YtdlDownloadResult> {
  const { info, pick, signal } = request;
  const read = reads.get(info) ?? reads.get(await vimeoInfo(info.ref, signal));
  if (!read) throw new Error('The Vimeo read went missing');
  const links = new SignedLinks(() => refreshConfig(read.config, signal));
  const streams: StreamRequestOptions = {
    isAllowedHost: isVimeoMediaHost,
    fetch: links.fetch((url, init) => fetch(url, init), isVimeoMediaHost),
    ...(signal ? { signal } : {}),
  };
  const common = {
    label: site(),
    jobDir: request.jobDir,
    request: streams,
    ...(request.fetchLimit ? { fetchLimit: request.fetchLimit } : {}),
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
    ...(request.onPostprocess ? { onPostprocess: request.onPostprocess } : {}),
    ...(request.onLog ? { onLog: request.onLog } : {}),
  };
  const { durationS } = info;
  if (pick === 'mp3') {
    const sound = await soundPlan(read.renditions, durationS, streams);
    if (!sound) throw new FlowUserError('flow.error.videoNoSound', { site: site() }, `The Vimeo video ${info.ref.id} has no sound`);
    return downloadStreams({
      ...common,
      ...sound,
      output: 'mp3',
      mp3: { bitrateKbps: MP3_BITRATE_KBPS[request.destination], title: info.title, artist: info.channel, ...(info.cover ? { coverUrl: info.cover } : {}) },
    });
  }
  const rendition = renditionFor(read.renditions, pick);
  if (!rendition) throw new YtdlError('formatMissing', ytdlFailureMessage('formatMissing', site()));
  const plans = await videoPlans(rendition, durationS, streams);
  return downloadStreams({ ...common, ...plans, output: 'mp4', estimateBytes: estimateBytes(rendition.bandwidth, durationS) });
}

export const vimeoVideo: SelfDownloadVideoSite = {
  info: vimeoInfo,
  download: vimeoDownload,
  chatCover: (info) => coverForChat({ prefix: 'vimeo', id: info.ref.id, url: info.cover, host: /(^|\.)vimeocdn\.com$/i }),
};
