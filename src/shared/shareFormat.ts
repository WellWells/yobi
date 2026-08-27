import type { CaptureFormat } from './types';

export const SHARE_FORMATS = ['png', 'webp', 'pdf', 'text'] as const;
export type ShareFormat = (typeof SHARE_FORMATS)[number];

export interface ShareFormatChoice {
  format: ShareFormat;
  zip: boolean;
}

export const DEFAULT_SHARE_FORMAT: ShareFormatChoice = { format: 'pdf', zip: false };

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

export function parseShareFormat(raw: string | undefined): ShareFormatChoice {
  const token = flatten(raw);
  if (!token) return { ...DEFAULT_SHARE_FORMAT };
  const zip = token.startsWith('zip');
  const base = zip ? token.slice(3) : token;
  if (zip && base === '') return { format: 'pdf', zip: true };
  const format = FORMAT_ALIASES[base];
  if (!format) return { ...DEFAULT_SHARE_FORMAT };
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

export function isShareLinkFormat(raw: string | undefined): boolean {
  return parseShareFormat(raw).format === 'text';
}

export function shareCaptureFormat(format: ShareFormat): CaptureFormat {
  return format === 'text' ? 'pdf' : format;
}

export function withoutZipPrefix(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!isShareFormatToken(value)) return value;
  return flatten(value).startsWith('zip') ? parseShareFormat(value).format : value;
}
