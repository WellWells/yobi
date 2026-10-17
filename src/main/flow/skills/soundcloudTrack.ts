import { coverForChat } from '../../chatMedia';
import { userAgentForUrl } from '../../userAgent';
import { readHlsMedia } from '../../downloader/streamRead';
import { downloadStreams } from '../../downloader/streamDownload';
import { fetchStreamText, hostAllowlist } from '../../downloader/streamFetch';
import type { StreamRequestOptions } from '../../downloader/streamFetch';
import { streamFailure } from '../../downloader/streamFailure';
import { ProtectedStreamError, StreamHttpError, progressivePlan } from '../../downloader/streamTypes';
import type { SegmentPlan } from '../../downloader/streamTypes';
import type { YtdlDownloadResult } from '../../youtubeDownload';
import { MP3_BITRATE_KBPS } from '../../../shared/ytdl';
import { parseResolvedSoundcloudUrl, parseSoundcloudUrl } from '../../../shared/linkSites/soundcloudLinks';
import { siteLabel } from '../../../shared/linkSites/rows';
import type { VideoRef } from '../../../shared/linkSites/types';
import { FlowUserError } from '../userError';
import { resolveShortLink } from './siteFetch';
import { SOUNDCLOUD_HOSTS, findClientId, parseResolved, scriptAssets, signedStreamUrl } from './soundcloudParse';
import type { SoundcloudResolved, SoundcloudStream, SoundcloudTrack } from './soundcloudParse';
import type { SelfDownloadRequest, SelfDownloadVideoSite, VideoInfo } from './videoSiteTypes';

/*
 * A SoundCloud track, read signed out the way its own web player does, fetched through the shared
 * segmented downloader and turned into an MP3 with the title, artist and artwork. No cookie, no
 * sign-in, no yt-dlp; the menu is the MP3 alone, since SoundCloud is sound.
 */

const API = 'https://api-v2.soundcloud.com';
const HOME = 'https://soundcloud.com/';
/** The player's bundles are read last to first (the client id is in one of the last); at most this many. */
const MAX_BUNDLES = 12;

const isAllowedHost = hostAllowlist(SOUNDCLOUD_HOSTS);

function requestOptions(signal?: AbortSignal): StreamRequestOptions {
  return { isAllowedHost, headers: { 'User-Agent': userAgentForUrl(HOME) }, ...(signal ? { signal } : {}) };
}

/** Kept for the app's run: the player's public id, read again when the API turns it away (401). */
let clientIdCache: string | null = null;

/** Forgets the cached client id (the next read finds it again). */
export function resetSoundcloudClientId(): void {
  clientIdCache = null;
}

async function findPlayerClientId(signal?: AbortSignal): Promise<string> {
  const options = requestOptions(signal);
  const { text } = await fetchStreamText(HOME, options);
  const bundles = scriptAssets(text).reverse().slice(0, MAX_BUNDLES);
  for (const bundle of bundles) {
    const { text: js } = await fetchStreamText(bundle, options);
    const id = findClientId(js);
    if (id) return id;
  }
  throw new Error('No client id in SoundCloud\'s player scripts');
}

async function clientId(signal: AbortSignal | undefined, fresh: boolean): Promise<string> {
  if (!clientIdCache || fresh) clientIdCache = await findPlayerClientId(signal);
  return clientIdCache;
}

/**
 * A GET on SoundCloud's API with the client id (and `extra` query values); a 401 finds the id
 * again and asks once more. Rejects with the stream errors (`StreamHttpError` carries the status).
 */
async function apiJson(url: string, extra: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  for (const fresh of [false, true]) {
    const target = new URL(url);
    target.searchParams.set('client_id', await clientId(signal, fresh));
    for (const [key, value] of Object.entries(extra)) if (value) target.searchParams.set(key, value);
    try {
      const { text } = await fetchStreamText(target.toString(), requestOptions(signal));
      return JSON.parse(text) as unknown;
    } catch (err) {
      if (fresh || !(err instanceof StreamHttpError) || err.status !== 401) throw err;
    }
  }
  throw new StreamHttpError('SoundCloud refused the client id', 401);
}

/** An `on.soundcloud.com` code's track or playlist link, read from its redirect without following it. */
async function resolveShare(ref: VideoRef, signal?: AbortSignal): Promise<string> {
  const site = siteLabel('soundcloud');
  let location: string | null;
  try {
    location = await resolveShortLink(ref.url, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    // An unknown or expired code answers 404.
    if (/ answered 404$/.test(reason)) throw new FlowUserError('flow.error.shortLinkExpired', { site }, `The ${site} short link has expired: ${reason}`);
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site }, `Could not resolve the ${site} short link: ${reason}`);
  }
  if (!location) throw new FlowUserError('flow.error.shortLinkExpired', { site }, `The ${site} short link has expired`);
  const link = parseResolvedSoundcloudUrl(location);
  if (!link) throw notTrack(`The ${site} short link leads to ${new URL(location, ref.url).pathname}, not a track`);
  if (link.kind === 'set') throw notTrack(`The ${site} short link leads to a playlist`);
  return link.url;
}

function notTrack(english: string): FlowUserError {
  return new FlowUserError('flow.error.soundcloudNotTrack', {}, english);
}

/** The track behind a link, refused before the menu when Yobi would not get it whole. */
async function readTrack(ref: VideoRef, signal?: AbortSignal): Promise<SoundcloudTrack> {
  const site = siteLabel('soundcloud');
  if (ref.kind === 'set') throw notTrack(`${ref.url} is a ${site} playlist`);
  const link = ref.kind === 'short' ? await resolveShare(ref, signal) : ref.url;
  let resolved: SoundcloudResolved;
  try {
    resolved = parseResolved(await apiJson(`${API}/resolve`, { url: link }, signal));
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    if (err instanceof StreamHttpError && (err.status === 404 || err.status === 403)) {
      throw new FlowUserError('flow.error.trackNotFound', { site }, `${site} has no track at ${link}: ${reason}`);
    }
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site }, `Could not read the ${site} track: ${reason}`);
  }
  if (resolved.kind === 'playlist') throw notTrack(`${link} is a ${site} playlist`);
  if (resolved.kind === 'other') throw notTrack(`${link} is not a ${site} track`);
  const { track } = resolved;
  if (track.policy === 'preview') {
    throw new FlowUserError('flow.error.soundcloudPreviewOnly', {}, `${site} plays only a 30 s preview of "${track.title}" without Go+`);
  }
  if (track.policy === 'blocked') {
    throw new FlowUserError('flow.error.trackUnavailable', { site }, `${site} does not play "${track.title}" here`);
  }
  if (track.encryptedOnly) throw streamFailure(new ProtectedStreamError('SoundCloud encrypted HLS'), site);
  if (!track.stream) throw new FlowUserError('flow.error.trackUnavailable', { site }, `${site} offers no stream Yobi reads for "${track.title}"`);
  return track;
}

/** The read behind each menu: what the download needs again (its stream, its authorization). */
const TRACKS = new WeakMap<VideoInfo, SoundcloudTrack>();

async function soundcloudInfo(ref: VideoRef, signal?: AbortSignal): Promise<VideoInfo> {
  const track = await readTrack(ref, signal);
  // The track's own page is the link the menu's button carries; its number is the reuse key.
  const page = parseSoundcloudUrl(track.permalink);
  const url = page?.kind === 'track' ? page.url : ref.url;
  const info: VideoInfo = {
    ref: { site: 'soundcloud', shape: 'video', url, id: track.id || ref.id, author: page?.artist ?? ref.author, kind: 'track' },
    title: track.title,
    channel: track.artist,
    durationS: track.durationS,
    cover: track.cover,
    summary: false,
    // Sound only: the menu is the MP3 (`youtube_info` always offers it).
    choices: () => [],
  };
  TRACKS.set(info, track);
  return info;
}

/** The stream's file as a plan, its signed URL asked for now: a progressive one expires in minutes. */
async function streamPlan(track: SoundcloudTrack, stream: SoundcloudStream, signal?: AbortSignal): Promise<SegmentPlan> {
  const signed = signedStreamUrl(await apiJson(stream.url, { track_authorization: track.trackAuthorization }, signal));
  if (!signed) throw new StreamHttpError('SoundCloud gave no stream URL', 404);
  if (stream.protocol === 'progressive') return progressivePlan(signed, track.durationS);
  return readHlsMedia(signed, requestOptions(signal));
}

async function soundcloudDownload(request: SelfDownloadRequest): Promise<YtdlDownloadResult> {
  const { info, signal } = request;
  const label = siteLabel('soundcloud');
  const track = TRACKS.get(info) ?? await readTrack(info.ref, signal);
  const stream = track.stream as SoundcloudStream;
  request.onLog?.(`[${label}] ${stream.protocol} ${stream.preset} → MP3`);
  const audio = await streamPlan(track, stream, signal);
  const estimate = stream.kbps > 0 && track.durationS > 0 ? Math.round((track.durationS * stream.kbps * 1000) / 8) : null;
  return downloadStreams({
    label,
    jobDir: request.jobDir,
    audio,
    output: 'mp3',
    mp3: {
      bitrateKbps: MP3_BITRATE_KBPS[request.destination],
      title: track.title,
      artist: track.artist,
      ...(track.cover ? { coverUrl: track.cover } : {}),
    },
    request: requestOptions(signal),
    estimateBytes: estimate,
    ...(request.fetchLimit ? { fetchLimit: request.fetchLimit } : {}),
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
    ...(request.onPostprocess ? { onPostprocess: request.onPostprocess } : {}),
    ...(request.onLog ? { onLog: request.onLog } : {}),
  });
}

/** The artwork for the desktop chat's menu: only SoundCloud's own image host. */
function soundcloudCover(info: VideoInfo): Promise<string> {
  return coverForChat({ prefix: 'sc', id: info.ref.id, url: info.cover, host: /(^|\.)sndcdn\.com$/i });
}

/** The SoundCloud row's adapter: a site that downloads by itself (`VideoSite.download`). */
export const soundcloudTrack: SelfDownloadVideoSite = {
  info: soundcloudInfo,
  download: soundcloudDownload,
  chatCover: soundcloudCover,
};
