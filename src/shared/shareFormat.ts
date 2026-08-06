import type { CaptureFormat } from './types';

/*
 * What a share step can produce, in the order the quick-export panel offers them — the skill's
 * picker and the Alt+H panel are the same question, so they must not read differently. The
 * first three are rendered artifacts; `text` uploads the markdown and hands back a link.
 * Order is presentation only: the fallback format is DEFAULT_SHARE_FORMAT, not the first entry.
 */
export const SHARE_FORMATS = ['png', 'webp', 'pdf', 'text'] as const;
export type ShareFormat = (typeof SHARE_FORMATS)[number];

export interface ShareFormatChoice {
  format: ShareFormat;
  zip: boolean;
}

export const DEFAULT_SHARE_FORMAT: ShareFormatChoice = { format: 'pdf', zip: false };

/* Spellings a hand-typed command argument may arrive as, mapped to the canonical format. */
const FORMAT_ALIASES: Record<string, ShareFormat> = {
  pdf: 'pdf',
  png: 'png',
  webp: 'webp',
  text: 'text',
  link: 'text',
  url: 'text',
  share: 'text',
};

function flatten(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/[\s\-_.]+/g, '');
}

/*
 * Deliberately permissive: the main source of this value is a command argument the user typed
 * (`/md ZipPng`) or an interpolated variable, not a picker. Anything unrecognised falls back to
 * PDF, which is the one format with no height ceiling.
 */
export function parseShareFormat(raw: string | undefined): ShareFormatChoice {
  const token = flatten(raw);
  if (!token) return { ...DEFAULT_SHARE_FORMAT };
  const zip = token.startsWith('zip');
  const base = zip ? token.slice(3) : token;
  if (zip && base === '') return { format: 'pdf', zip: true };
  const format = FORMAT_ALIASES[base];
  if (!format) return { ...DEFAULT_SHARE_FORMAT };
  /* Zipping a link is meaningless, so the prefix is simply dropped rather than rejected. */
  return { format, zip: format === 'text' ? false : zip };
}

export function isShareFormatToken(raw: string | undefined): boolean {
  const token = flatten(raw);
  if (!token) return false;
  const zip = token.startsWith('zip');
  const base = zip ? token.slice(3) : token;
  if (zip && base === '') return true;
  return base in FORMAT_ALIASES;
}

/*
 * Answers "does this step produce a link rather than a file?" for callers that must decide
 * before the step runs — {{file}} wiring and the import trust gate. An unresolved {{template}}
 * is not a link: guessing "link" there would strip {{file}} from a flow that does write one.
 */
export function isShareLinkFormat(raw: string | undefined): boolean {
  return parseShareFormat(raw).format === 'text';
}

export function shareCaptureFormat(format: ShareFormat): CaptureFormat {
  return format === 'text' ? 'pdf' : format;
}

/*
 * Drops a legacy `zip` prefix so the separate zip switch is the only thing that decides it.
 * Anything that is not a recognised token — most importantly an unresolved {{template}} —
 * comes back untouched: normalising there would silently pin a per-run format to one value.
 */
export function withoutZipPrefix(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!isShareFormatToken(value)) return value;
  return flatten(value).startsWith('zip') ? parseShareFormat(value).format : value;
}
