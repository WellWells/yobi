import { isByokTargetUrl } from '../../shared/types';
import type { TranslateRequest, TranslateResult } from '../../shared/translate';
import type { TranslateLanguage } from '../../shared/translateLanguages';
import {
  maskTranslation, maskTranslationParts, unmaskTranslation, unmaskTranslationParts,
} from '../../shared/translateMask';
import { cleanOneShotReply, fitsProvider, restoreParagraphs, runOneShot, type OneShotIo } from './oneShot';
import { buildTranslatePrompt } from './translatePrompt';

/** The reply as text to unmask: one wrapping fence or pair of quotes off, paragraph marks back to blank lines. */
function finishReply(raw: string, sent: string, browser: boolean): string {
  const cleaned = cleanOneShotReply(raw, sent);
  return (browser ? restoreParagraphs(cleaned) : cleaned).trim();
}

/**
 * One answer translated whole: masked, sent once, unmasked. Too long for the provider is refused,
 * never cut. A reply that lost a placeholder comes back as written, flagged `unmatched`.
 */
export async function runTranslate(request: TranslateRequest, io: OneShotIo): Promise<TranslateResult> {
  const browser = !isByokTargetUrl(request.providerUrl);
  const masked = maskTranslation(request.text);
  const prompt = buildTranslatePrompt(masked.text, request.to, { markParagraphs: browser });
  if (!fitsProvider(request.providerUrl, prompt, io.byokBudgetChars)) return { ok: false, reason: 'tooLong' };

  const sent = await runOneShot(request.providerUrl, prompt, io);
  if (!sent.ok) return sent;
  const reply = finishReply(sent.reply, masked.text, browser);
  if (!reply) return { ok: false, reason: 'empty' };
  const unmasked = unmaskTranslation(reply, masked);
  return {
    ok: true,
    text: unmasked.text,
    providerUrl: request.providerUrl,
    ...(unmasked.ok ? {} : { unmatched: true as const }),
  };
}

export type TurnPairResult =
  | {
    ok: true;
    prompt: string;
    response: string;
    /** Parts left in the original language: the model lost a code block, formula or link there. */
    kept: number;
  }
  | { ok: false; reason: 'cancelled' | 'tooLong' | 'empty' | 'failed'; error?: string };

/** One part on its own; an unmatched reply keeps the original rather than a patched-together one. */
async function translatePart(
  text: string,
  to: TranslateLanguage,
  providerUrl: string,
  io: OneShotIo,
): Promise<{ ok: true; text: string; kept: number } | Exclude<TurnPairResult, { ok: true }>> {
  if (!text.trim()) return { ok: true, text, kept: 0 };
  const result = await runTranslate({ id: '', providerUrl, text, to }, io);
  if (!result.ok) {
    const reason = result.reason === 'invalid' ? 'failed' : result.reason;
    return { ok: false, reason, ...(result.error ? { error: result.error } : {}) };
  }
  return result.unmatched ? { ok: true, text, kept: 1 } : { ok: true, text: result.text, kept: 0 };
}

/**
 * A question and its answer in one request, divided by a placeholder line. When the two do not
 * fit together, or the reply loses the divider, each goes on its own.
 */
export async function translateTurnPair(
  prompt: string,
  response: string,
  to: TranslateLanguage,
  providerUrl: string,
  io: OneShotIo,
): Promise<TurnPairResult> {
  const separately = async (): Promise<TurnPairResult> => {
    const first = await translatePart(prompt, to, providerUrl, io);
    if (!first.ok) return first;
    const second = await translatePart(response, to, providerUrl, io);
    if (!second.ok) return second;
    return { ok: true, prompt: first.text, response: second.text, kept: first.kept + second.kept };
  };
  if (!prompt.trim() || !response.trim()) return separately();

  const browser = !isByokTargetUrl(providerUrl);
  const masked = maskTranslationParts([prompt, response]);
  const request = buildTranslatePrompt(masked.text, to, { markParagraphs: browser, separator: masked.separators[0] });
  if (!fitsProvider(providerUrl, request, io.byokBudgetChars)) return separately();

  const sent = await runOneShot(providerUrl, request, io);
  if (!sent.ok) return sent;
  const reply = finishReply(sent.reply, masked.text, browser);
  if (!reply) return { ok: false, reason: 'empty' };
  const parts = unmaskTranslationParts(reply, masked);
  if (!parts) return separately();
  const [ask, answer] = parts;
  return {
    ok: true,
    prompt: ask.ok && ask.text ? ask.text : prompt,
    response: answer.ok && answer.text ? answer.text : response,
    kept: (ask.ok && ask.text ? 0 : 1) + (answer.ok && answer.text ? 0 : 1),
  };
}
