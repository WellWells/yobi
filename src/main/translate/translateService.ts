/**
 * Translates a list of lines in batches. Every line comes back in its place, or the call fails and
 * says how far it got; nothing is ever filled in by position or left blank.
 */
import type { EngineLanguage } from './engineLanguages';
import { EngineFailure, MAX_BATCH_CHARS, MAX_BATCH_LINES, translateBatch, type TranslateFetch } from './microsoftEngine';

const RETRY_WAIT_MS = 1_500;
/** A call has a person waiting on it: past this, tell them rather than sit it out. */
const RETRY_WAIT_MAX_MS = 15_000;

export interface TranslateInput {
  lines: readonly string[];
  to: EngineLanguage;
  from: EngineLanguage | null;
  signal?: AbortSignal;
}

export interface TranslateOutput {
  lines: string[];
  /** Lines that came back different. */
  changed: number;
}

export type Translator = (input: TranslateInput) => Promise<TranslateOutput>;

export class TranslateFailure extends Error {
  constructor(readonly done: number, readonly total: number, reason: string) {
    super(`Stopped after ${done} of ${total} lines. ${reason}.`);
    this.name = 'TranslateFailure';
  }
}

export interface TranslatorDeps {
  fetchFn: TranslateFetch;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** One line: a line break would end a subtitle cue, and an empty line would erase one. */
function oneLine(text: string): string {
  const line = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (!line) throw new EngineFailure('Microsoft answered a blank line');
  return line;
}

/** The next run of waiting lines one request takes; a line longer than the limit goes alone. */
function nextBatch(waiting: readonly number[], at: number, lines: readonly string[]): number[] {
  const batch: number[] = [];
  let chars = 0;
  for (let i = at; i < waiting.length && batch.length < MAX_BATCH_LINES; i++) {
    chars += lines[waiting[i]].length;
    if (batch.length > 0 && chars > MAX_BATCH_CHARS) break;
    batch.push(waiting[i]);
  }
  return batch;
}

export function createTranslator({ fetchFn, wait = waitFor }: TranslatorDeps): Translator {
  async function ask(batch: readonly string[], input: TranslateInput): Promise<string[]> {
    const once = async (): Promise<string[]> => {
      const answer = await translateBatch(fetchFn, batch, input.to, input.from, input.signal);
      return answer.map(oneLine);
    };
    try {
      return await once();
    } catch (err) {
      if (!(err instanceof EngineFailure) || !err.retry) throw err;
      const afterMs = err.retry.afterMs ?? RETRY_WAIT_MS;
      if (afterMs > RETRY_WAIT_MAX_MS) throw err;
      await wait(afterMs, input.signal);
      return once();
    }
  }

  return async (input) => {
    const { lines, signal } = input;
    const result = [...lines];
    const waiting = lines.flatMap((line, i) => (/\p{L}/u.test(line) ? [i] : []));
    let at = 0;
    while (at < waiting.length) {
      signal?.throwIfAborted();
      const batch = nextBatch(waiting, at, lines);
      try {
        const answer = await ask(batch.map((i) => lines[i]), input);
        batch.forEach((lineIndex, i) => { result[lineIndex] = answer[i]; });
        at += batch.length;
      } catch (err) {
        if (!(err instanceof EngineFailure)) throw err;
        throw new TranslateFailure(at, waiting.length, err.message);
      }
    }
    return { lines: result, changed: result.filter((line, i) => line !== lines[i]).length };
  };
}
