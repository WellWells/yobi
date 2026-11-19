import { compactPreview } from '../../shared/textBudget';

/**
 * What every BYOK wire format shares: the errors a request ends in, the prompt and usage shapes,
 * and the contract a streamed reply is read through. `byokClient.ts` re-exports all of it; the
 * per-format readers (`byokAnthropic.ts`) import it from here so neither imports the other.
 */

export const BYOK_REQUEST_FAILED_PREFIX = 'BYOK request failed: ';
export const BYOK_REFUSED_PREFIX = 'BYOK refused: ';

export class ByokFailure extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, options: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'ByokFailure';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * The model or its provider's safety filter declined the request (`finish_reason` content_filter,
 * refusal or safety, a `refusal` text, or Anthropic's `stop_reason: "refusal"`). Never retried:
 * the same request is refused again.
 */
export class ByokRefusal extends ByokFailure {
  constructor(detail: string) {
    super(`${BYOK_REFUSED_PREFIX}${detail}`);
    this.name = 'ByokRefusal';
  }
}

const REFUSAL_FINISH_REASONS = new Set(['content_filter', 'refusal', 'safety']);

/** The refusal a finished reply carries, or null: its refusal text, else the finish reason. */
export function refusalOf(finishReason: string, refusalText: string): ByokRefusal | null {
  const text = refusalText.trim();
  if (text) return new ByokRefusal(text);
  return REFUSAL_FINISH_REASONS.has(finishReason) ? new ByokRefusal(finishReason) : null;
}

/** The `error.message` of an error body (OpenAI and Anthropic both use it), else a preview. */
export function extractApiErrorDetail(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: unknown } };
    if (typeof parsed?.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
  } catch {
  }
  return compactPreview(bodyText, 200);
}

export interface ByokUsage {
  /** Every input token of the request, cached ones included. */
  input: number;
  output: number;
  /** The part of `input` read back from the provider's prompt cache. */
  cachedInput?: number;
  /** The part of `input` written to the prompt cache (billed above the base input price). */
  cacheWriteInput?: number;
}

/** A picture ready to send: base64 bytes in one of the formats every image-taking preset reads. */
export interface ByokImage {
  mimeType: string;
  data: string;
}

/** One turn of a multi-turn request: what `/agent` sends once a BYOK run has a conversation. */
export interface ByokChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Pictures sent with a user message; only a key that takes them is ever given one. */
  images?: readonly ByokImage[];
}

/** A single prompt, or a whole conversation ending in the user's latest message. */
export type ByokPrompt = string | readonly ByokChatMessage[];

export function byokMessages(prompt: ByokPrompt): readonly ByokChatMessage[] {
  return typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt;
}

export interface ByokStreamResult {
  content: string;
  usage: ByokUsage | null;
}

/**
 * How one wire format's reply is read. The transport (timeouts, HTTP errors, cancel) is shared;
 * these say what a line means and when the reply is whole. Any method may throw a `ByokFailure`.
 */
export interface ByokChatStream {
  /** One line of the event stream; `'done'` once the reply says it is finished. */
  consumeLine(line: string): 'done' | undefined;
  /** The finished reply, after the stream ended or said it was done. */
  finish(rawBody: string): ByokStreamResult;
  /** What arrived before an idle or deadline cut, handed on when there is text. */
  partial(): ByokStreamResult;
  /** A reply that came back as one body instead of a stream. */
  whole(bodyText: string): ByokStreamResult;
}
