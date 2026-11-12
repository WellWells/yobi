import { engineLanguage } from '../../translate/engineLanguages';
import { createTranslator, TranslateFailure } from '../../translate/translateService';
import { FlowUserError } from '../userError';

const translate = createTranslator({ fetchFn: (url, init) => fetch(url, init) });

/** Plain text in and out; only a complete translation reaches the next step. */
export async function execTranslate(config: Record<string, string>, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const text = config.text ?? '';
  if (!text.trim()) {
    throw new FlowUserError('flow.error.translateText', {}, 'Enter the text to translate');
  }
  const to = engineLanguage(config.to ?? '');
  if (!to) {
    throw new FlowUserError('flow.error.translateTarget', {}, 'Choose a target language for machine translation');
  }
  const source = (config.from ?? '').trim();
  const from = source && source !== 'auto' ? engineLanguage(source) : null;
  if (source && source !== 'auto' && !from) {
    throw new FlowUserError('flow.error.translateSource', {}, 'Choose a source language or automatic detection');
  }
  const breaks = text.match(/\r\n|\r|\n/g) ?? [];
  try {
    const result = await translate({ lines: text.split(/\r\n|\r|\n/), to, from, signal });
    signal?.throwIfAborted();
    return result.lines.map((line, i) => `${line}${breaks[i] ?? ''}`).join('');
  } catch (err) {
    if (!(err instanceof TranslateFailure)) throw err;
    throw new FlowUserError('flow.error.translateFailed', {
      done: String(err.done), total: String(err.total),
    }, err.message);
  }
}
