import { isGeminiApiBaseUrl } from '../../shared/types';
import { estimateTokens } from '../../shared/tokenEstimate';
import { meterReported } from '../tokenMeter';
import {
  BYOK_CONFIG_INCOMPLETE_PREFIX,
  BYOK_REQUEST_FAILED_PREFIX,
  ByokFailure,
  fetchWithByokTimeout,
  runOnByokKeys,
} from './byokClient';
import type { ByokEndpoint, ByokUsage } from './byokClient';

/**
 * Reading a whole video is not a chat reply: it can take minutes. The youtube step as a whole
 * gets 300 s, and the caption attempt before this already spent up to ~45 s of it.
 */
export const VIDEO_READ_TIMEOUT_MS = 180_000;

export const NO_GEMINI_KEY_ERROR =
  'No Gemini API key in this selection — only generativelanguage.googleapis.com reads YouTube videos';

const TRANSCRIBE_PROMPT = [
  'Transcribe everything that is said in this video.',
  '',
  'OUTPUT RULES (critical):',
  '- Write the words as they are spoken, in the language they are spoken. Do not translate, summarize or comment.',
  '- Plain text in paragraphs, no timestamps.',
  '- If the video has little or no speech, describe what happens on screen instead, in order.',
].join('\n');

export interface VideoReading {
  text: string;
  keyLabel: string;
  usage: ByokUsage | null;
}

/** Gemini's OpenAI-compatible base is `<origin>/v1beta/openai`; interactions sit beside it. */
export function interactionsUrl(baseUrl: string): string {
  return `${new URL(baseUrl.trim()).origin}/v1beta/interactions`;
}

export function buildVideoInteraction(model: string, videoUrl: string, prompt: string): Record<string, unknown> {
  return {
    model: model.trim().replace(/^models\//, ''),
    input: [
      { type: 'video', uri: videoUrl },
      { type: 'text', text: prompt },
    ],
  };
}

interface InteractionBody {
  status?: unknown;
  steps?: Array<{ type?: unknown; content?: Array<{ type?: unknown; text?: unknown }> }>;
  usage?: { total_input_tokens?: unknown; total_output_tokens?: unknown };
}

export function readInteraction(bodyText: string): { text: string; usage: ByokUsage | null; status: string } {
  let body: InteractionBody;
  try {
    body = JSON.parse(bodyText) as InteractionBody;
  } catch {
    return { text: '', usage: null, status: 'unparseable' };
  }
  const text = (Array.isArray(body.steps) ? body.steps : [])
    .filter((step) => step?.type === 'model_output')
    .flatMap((step) => (Array.isArray(step.content) ? step.content : []))
    .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();
  const input = Number(body.usage?.total_input_tokens);
  const output = Number(body.usage?.total_output_tokens);
  const usage = body.usage && Number.isFinite(input) && Number.isFinite(output) ? { input, output } : null;
  return { text, usage, status: typeof body.status === 'string' ? body.status : 'unknown' };
}

async function readVideoOnKey(endpoint: ByokEndpoint, videoUrl: string, signal?: AbortSignal): Promise<VideoReading> {
  if (!endpoint.apiKey || !endpoint.model) {
    throw new Error(`${BYOK_CONFIG_INCOMPLETE_PREFIX}API key and model are required`);
  }
  const bodyText = await fetchWithByokTimeout(
    interactionsUrl(endpoint.baseUrl),
    {
      method: 'POST',
      headers: { 'x-goog-api-key': endpoint.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildVideoInteraction(endpoint.model, videoUrl, TRANSCRIBE_PROMPT)),
    },
    VIDEO_READ_TIMEOUT_MS,
    signal,
  );
  const { text, usage, status } = readInteraction(bodyText);
  if (!text) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}Gemini returned no text (status: ${status})`);
  if (usage) meterReported(usage.input, usage.output);
  return { text, keyLabel: endpoint.label ?? 'key', usage };
}

/**
 * Has Gemini watch a public YouTube video and write down what is said. Gemini reads the audio
 * itself, so this works on a video YouTube has not captioned yet.
 */
export function transcribeYoutubeVideo(targetUrl: string, videoUrl: string, signal?: AbortSignal): Promise<VideoReading> {
  return runOnByokKeys(targetUrl, (endpoint) => readVideoOnKey(endpoint, videoUrl, signal), {
    signal,
    accept: (endpoint) => isGeminiApiBaseUrl(endpoint.baseUrl),
    noneAccepted: NO_GEMINI_KEY_ERROR,
    // Only an HTTP refusal (quota, bad key) can go better on another key. A timeout or an
    // empty answer would cost another key the same minutes on the same video.
    failOver: (err) => err instanceof ByokFailure,
    estimate: (result) => ({ input: 0, output: estimateTokens(result.text) }),
  });
}
