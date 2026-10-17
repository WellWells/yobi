import { ensureHttpScheme } from '../../urlParser';
import {
  extractYoutubeVideoId,
  fetchYoutubeVideo,
  youtubeThumbnailUrl,
  type YoutubeVideoResult,
} from '../../youtubeTranscript';
import { sendLog } from '../../helpers';
import { getByokLabel } from '../../providers/byokClient';
import { transcribeYoutubeVideo } from '../../providers/geminiVideo';
import { matchVideoRef, siteLabel } from '../../../shared/linkSites/rows';
import type { VideoRef } from '../../../shared/linkSites/types';
import { FlowUserError } from '../userError';
import { readAccessOf } from './readAccess';
import type { SignInUse } from './readAccess';
import { VIDEO_SITES } from './videoSites';

export function buildYoutubeEnvelope(result: YoutubeVideoResult, image = ''): string {
  return JSON.stringify({
    transcript: result.transcript,
    title: result.title,
    isFailed: result.ok ? '0' : '1',
    image,
  });
}

/**
 * The video's own words when YouTube has no captions for it, most often a brand-new upload.
 * A video Gemini cannot read either stays a failed step; only a stop throws.
 */
async function transcribeWithoutCaptions(
  fallbackUrl: string,
  videoId: string,
  captions: YoutubeVideoResult,
  signal: AbortSignal | undefined,
): Promise<YoutubeVideoResult | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const label = getByokLabel(fallbackUrl);
  sendLog(`🎞️ [Flow] YouTube: no captions — asking ${label} to transcribe the video itself: ${watchUrl}`);
  const startedAt = Date.now();
  try {
    const reading = await transcribeYoutubeVideo(fallbackUrl, watchUrl, signal);
    const seconds = ((Date.now() - startedAt) / 1_000).toFixed(1);
    const tokens = reading.usage ? `, ${reading.usage.input} in / ${reading.usage.output} out tokens` : '';
    sendLog(`✅ [Flow] YouTube: Gemini transcript — ${reading.text.length} chars in ${seconds}s via "${reading.keyLabel}"${tokens} (isFailed=0)`);
    return { title: captions.title, transcript: reading.text, ok: true };
  } catch (err) {
    signal?.throwIfAborted();
    const seconds = ((Date.now() - startedAt) / 1_000).toFixed(1);
    const message = err instanceof Error ? err.message : String(err);
    sendLog(`❌ [Flow] YouTube: ${label} could not transcribe it either after ${seconds}s — ${message} (isFailed=1)`);
    return null;
  }
}

/** A link another video row takes (not YouTube's, which this skill reads itself), or null. */
function otherVideoSite(url: string): VideoRef | null {
  const ref = matchVideoRef(url);
  return ref && ref.site !== 'youtube' ? ref : null;
}

/**
 * Another video site's words, through its adapter; a site with no transcript has none. `signIn`:
 * how far the run may use the site's sign-in (`readAccessOf`).
 */
async function siteTranscript(ref: VideoRef, signal: AbortSignal | undefined, signIn: SignInUse): Promise<YoutubeVideoResult> {
  const site = VIDEO_SITES[ref.site];
  const transcript = site.transcript ? await site.transcript(ref, signal, { signIn }) : null;
  signal?.throwIfAborted();
  sendLog(`▶️ [Flow] ${siteLabel(ref.site)}: ${transcript ? `transcript fetched — ${transcript.length} chars` : 'no transcript available'}`);
  return { title: '', transcript: transcript ?? '', ok: Boolean(transcript) };
}

/**
 * The words of a video, as `{ transcript, title, isFailed, image }`. A YouTube link is read here
 * (captions, then the step's Gemini key if one is set); a link of another video row through its
 * site's `transcript`. With `requireTranscript` (the built-in summary), no words at all is not a
 * failed result but the error the person reads: there is nothing to sum up.
 */
export async function execYoutube(config: Record<string, string>, signal?: AbortSignal): Promise<string> {
  const other = otherVideoSite(ensureHttpScheme(config.url ?? ''));
  const { result, image } = other
    ? { result: await siteTranscript(other, signal, readAccessOf(config).signIn), image: '' }
    : await youtubeTranscript(config, signal);
  if (config.requireTranscript === 'true' && !(result.ok && result.transcript.trim())) {
    throw new FlowUserError('flow.error.videoNoCaptions', {}, 'The video has no captions or transcript to summarize');
  }
  return buildYoutubeEnvelope(result, image);
}

async function youtubeTranscript(
  config: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<{ result: YoutubeVideoResult; image: string }> {
  const url = ensureHttpScheme(config.url ?? '');
  if (!url) {
    sendLog('▶️ [Flow] YouTube: no URL provided (isFailed=1)');
    return { result: { title: '', transcript: '', ok: false }, image: '' };
  }

  const image = youtubeThumbnailUrl(url);

  sendLog(`▶️ [Flow] YouTube step — fetching transcript: ${url}`);
  const result = await fetchYoutubeVideo(url, {
    onLog: (message) => sendLog(`📺 [Flow] ${message}`),
    show: process.env.YOBI_YT_DEBUG === '1',
  }).catch(
    (): YoutubeVideoResult => ({ title: '', transcript: '', ok: false }),
  );

  if (result.ok) {
    sendLog(`✅ [Flow] YouTube: transcript fetched — ${result.transcript.length} chars (${result.title || 'untitled'}, isFailed=0)`);
    return { result, image };
  }

  const titleNote = result.title ? ` — "${result.title}"` : '';
  const fallbackUrl = config.fallbackProvider?.trim() ?? '';
  const videoId = extractYoutubeVideoId(url);
  if (!fallbackUrl || !videoId) {
    sendLog(`▶️ [Flow] YouTube: no transcript available${titleNote} (isFailed=1)`);
    return { result, image };
  }

  sendLog(`▶️ [Flow] YouTube: no captions${titleNote}`);
  const fromVideo = await transcribeWithoutCaptions(fallbackUrl, videoId, result, signal);
  return { result: fromVideo ?? result, image };
}
