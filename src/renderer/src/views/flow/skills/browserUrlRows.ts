import { looksLikeWebUrl, parseJsonStringArray, splitUrlListText } from '../../../../../shared/urlRows';
import { isFetchableWebUrl } from '../../../../../shared/webUrl';

/** Read older URL lists without rewriting the saved flow just by opening its editor. */
export function parseBrowserUrlRows(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const parsed = parseJsonStringArray(trimmed);
    if (!parsed) return [value];
    return parsed.length > 0 ? parsed : [''];
  }
  const rows = splitUrlListText(value);
  return rows.length > 0 ? rows : [''];
}

/**
 * JSON keeps commas inside an individual row's URL distinct from legacy list separators. A blank
 * row lives only in the editor (a row just added, not filled in yet): saved, it would be a page
 * every run fails to read.
 */
export function serializeBrowserUrlRows(rows: string[]): string {
  const filled = rows.filter((row) => row.trim() !== '');
  if (filled.length === 0) return '';
  if (filled.length === 1 && !/[,\r\n]/.test(filled[0]) && !filled[0].trim().startsWith('[')) return filled[0];
  return JSON.stringify(filled);
}

/**
 * `.pageN` only where the runtime puts page N: the editor's own rows (JSON) keep every position;
 * an older free-text list keeps only its web addresses, so it is listed only when all of them
 * are. A variable's list has a length nobody knows yet.
 */
export function browserPages(config: Record<string, string>): string[] {
  const url = config.url ?? '';
  const rows = parseBrowserUrlRows(url);
  if (rows.length < 2 || rows.some((row) => /\{\{/.test(row))) return [];
  if (!parseJsonStringArray(url.trim()) && !rows.every((row) => isFetchableWebUrl(row) && looksLikeWebUrl(row))) return [];
  return rows.map((_, index) => `page${index + 1}`);
}

/** A multi-URL paste replaces the selection, keeping text on either side of that selection. */
export function pasteBrowserUrlRows(value: string, start: number, end: number, pasted: string): string[] | null {
  const trimmed = pasted.trim();
  const lines = pasted.split(/\r\n|[\r\n]/).map((line) => line.trim()).filter(Boolean);
  const candidates = parseBrowserUrlRows(pasted);
  const rows = trimmed.startsWith('[') ? candidates : lines.length > 1 ? lines : candidates;
  if (!trimmed.startsWith('[') && lines.length < 2 && !rows.every((row) => /^https?:\/\//i.test(row) || /^\{\{[^}]+\}\}$/.test(row))) return null;
  if (rows.length < 2 && !pasted.trim().startsWith('[')) return null;
  if (rows.length === 1 && rows[0] === pasted) return null;
  rows[0] = `${value.slice(0, start)}${rows[0]}`;
  const last = rows.length - 1;
  rows[last] = `${rows[last]}${value.slice(end)}`;
  return rows;
}
