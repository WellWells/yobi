import { maskTranslation, unmaskTranslation } from '../../../shared/translateMask';

type Converter = (text: string) => string;

let loading: Promise<Converter> | null = null;

/** The OpenCC converter, loaded on first use; a failed load is retried on the next call. */
export function loadOpencc(): Promise<Converter> {
  loading ??= import('./openccBundle')
    .then((bundle) => bundle.convertCnToTaiwan)
    .catch((err: unknown) => {
      loading = null;
      throw err;
    });
  return loading;
}

/**
 * Simplified Chinese to Taiwan Traditional, on this computer. Only the prose is converted: code,
 * formulas and addresses are masked first, so `$\sum$` or a URL with `zh-cn` in it stay as written.
 */
export async function convertToTraditional(text: string): Promise<string> {
  const convert = await loadOpencc();
  const masked = maskTranslation(text);
  const result = unmaskTranslation(convert(masked.text), masked);
  // OpenCC leaves ASCII alone, so a placeholder never goes missing; if one did, nothing is changed.
  return result.ok ? result.text : text;
}
