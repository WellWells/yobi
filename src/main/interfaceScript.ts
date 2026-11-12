/**
 * Short model text (a name, a title) in the Chinese script of the interface language. Asking for
 * Traditional Chinese is not enough: a web model given Chinese material still answers in
 * Simplified now and then. Characters only (`tw`), not Taiwan phrases (`twp`): a name keeps the
 * words it was given. The dictionaries load on first use, never at startup.
 */

import { responseLanguage } from '../shared/promptLanguage';

/** The rule every naming prompt carries: a name is read in the app, so it is in the app's language. */
export function nameLanguageRule(locale: string, what: string): string {
  return `- Write it in ${responseLanguage(locale)}, whatever language the ${what} is in. Keep proper names (people, products, places) as written.`;
}

type Convert = (text: string) => string;

let toTraditional: Promise<Convert> | null = null;
let toSimplified: Promise<Convert> | null = null;

function traditional(): Promise<Convert> {
  toTraditional ??= import('opencc-js/cn2t').then(({ default: OpenCC }) => OpenCC.Converter({ from: 'cn', to: 'tw' }));
  return toTraditional;
}

function simplified(): Promise<Convert> {
  toSimplified ??= import('opencc-js/t2cn').then(({ default: OpenCC }) => OpenCC.Converter({ from: 'tw', to: 'cn' }));
  return toSimplified;
}

const HAN = /\p{Script=Han}/u;

export async function inInterfaceScript(text: string, locale: string): Promise<string> {
  if (!HAN.test(text)) return text;
  if (locale === 'zh-TW') return (await traditional())(text);
  if (locale === 'zh-CN') return (await simplified())(text);
  return text;
}
