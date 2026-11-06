/**
 * What Microsoft calls a language, from the one tag the tools take. Chinese is told apart by script;
 * a region on anything else is dropped, since the service offers none.
 */
import { uiTargetLanguage } from '../../shared/translateLanguages';

export interface EngineLanguage {
  /** The tag the tools report and the saved file is named after: zh-TW, ja. */
  tag: string;
  /** The code the request carries: zh-Hant, ja. */
  code: string;
}

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
/** Azure's codes, where they are not the plain tag. */
const MICROSOFT_CODES: Readonly<Record<string, string>> = { 'zh-TW': 'zh-Hant', 'zh-CN': 'zh-Hans', no: 'nb' };

/** The language a tag names, or null for what is not a tag or could mean two scripts. */
export function engineLanguage(raw: string): EngineLanguage | null {
  const value = raw.trim().replace(/_/g, '-');
  if (!LANGUAGE_TAG.test(value)) return null;
  const lower = value.toLowerCase();
  if (lower === 'zh') return null;
  const tag = lower.startsWith('zh-') ? uiTargetLanguage(lower) : lower.split('-')[0];
  return { tag, code: MICROSOFT_CODES[tag] ?? tag };
}
