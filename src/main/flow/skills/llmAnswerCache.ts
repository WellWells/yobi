import { createHash } from 'node:crypto';

/**
 * Answers a built-in analysis already got, kept in memory so the same question is not put to the
 * model twice: a second person pressing "analyze" under the same post gets the answer the first
 * one did. The key is everything the model would be sent — the model, the whole prompt, the
 * pictures — so an answer only ever goes back to a request that would have asked exactly the
 * same thing: a post read again with new replies, or read with another person's access, asks anew.
 * Nothing is written to disk; a restart forgets it all.
 */
const ANSWER_TTL_MS = 6 * 60 * 60_000;
const MAX_ANSWERS = 100;

interface CachedAnswer {
  answer: string;
  expiresAt: number;
}

const answers = new Map<string, CachedAnswer>();

export function llmAnswerKey(providerUrl: string, prompt: string, imageUrls: string): string {
  return createHash('sha256').update(JSON.stringify([providerUrl, prompt, imageUrls])).digest('hex');
}

export function cachedLlmAnswer(key: string, now = Date.now()): string | null {
  const hit = answers.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    answers.delete(key);
    return null;
  }
  // Most recently used last: the oldest entry is the one dropped.
  answers.delete(key);
  answers.set(key, hit);
  return hit.answer;
}

/** An empty answer is never kept: the next press should ask again. */
export function rememberLlmAnswer(key: string, answer: string, now = Date.now()): void {
  if (!answer.trim()) return;
  answers.delete(key);
  answers.set(key, { answer, expiresAt: now + ANSWER_TTL_MS });
  while (answers.size > MAX_ANSWERS) {
    const oldest = answers.keys().next().value;
    if (oldest === undefined) break;
    answers.delete(oldest);
  }
}

export function clearLlmAnswers(): void {
  answers.clear();
}
