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

export function buildYoutubeEnvelope(result: YoutubeVideoResult, image = ''): string {
  return JSON.stringify({
    transcript: result.transcript,
    title: result.title,
    isFailed: result.ok ? '0' : '1',
    image,
  });
}

/**
 * The video's own words when YouTube has no captions for it — a brand-new upload, most often
 * (one measured 52 minutes after publishing still had none). Never throws: a video Gemini
 * cannot read either stays a failed step, exactly as it would have without the fallback.
 */
async function transcribeWithoutCaptions(
  fallbackUrl: string,
  videoId: string,
  captions: YoutubeVideoResult,
): Promise<YoutubeVideoResult | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const label = getByokLabel(fallbackUrl);
  sendLog(`🎞️ [Flow] YouTube: no captions — asking ${label} to transcribe the video itself: ${watchUrl}`);
  const startedAt = Date.now();
  try {
    const reading = await transcribeYoutubeVideo(fallbackUrl, watchUrl);
    const seconds = ((Date.now() - startedAt) / 1_000).toFixed(1);
    const tokens = reading.usage ? `, ${reading.usage.input} in / ${reading.usage.output} out tokens` : '';
    sendLog(`✅ [Flow] YouTube: Gemini transcript — ${reading.text.length} chars in ${seconds}s via "${reading.keyLabel}"${tokens} (isFailed=0)`);
    return { title: captions.title, transcript: reading.text, ok: true };
  } catch (err) {
    const seconds = ((Date.now() - startedAt) / 1_000).toFixed(1);
    const message = err instanceof Error ? err.message : String(err);
    sendLog(`❌ [Flow] YouTube: ${label} could not transcribe it either after ${seconds}s — ${message} (isFailed=1)`);
    return null;
  }
}

export async function execYoutube(config: Record<string, string>): Promise<string> {
  const url = ensureHttpScheme(config.url ?? '');
  if (!url) {
    sendLog('▶️ [Flow] YouTube: no URL provided (isFailed=1)');
    return buildYoutubeEnvelope({ title: '', transcript: '', ok: false });
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
    return buildYoutubeEnvelope(result, image);
  }

  const titleNote = result.title ? ` — "${result.title}"` : '';
  const fallbackUrl = config.fallbackProvider?.trim() ?? '';
  const videoId = extractYoutubeVideoId(url);
  if (!fallbackUrl || !videoId) {
    sendLog(`▶️ [Flow] YouTube: no transcript available${titleNote} (isFailed=1)`);
    return buildYoutubeEnvelope(result, image);
  }

  sendLog(`▶️ [Flow] YouTube: no captions${titleNote}`);
  const fromVideo = await transcribeWithoutCaptions(fallbackUrl, videoId, result);
  return buildYoutubeEnvelope(fromVideo ?? result, image);
}
