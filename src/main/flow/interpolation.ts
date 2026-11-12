import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { extractTemplateVariables } from '../../shared/templateVariables';
import { looksLikeWebUrl, parseJsonStringArray, splitUrlListText } from '../../shared/urlRows';

export { isFileOutputStep } from '../../shared/fileOutputStep';
export { interpolateCode } from './codeInterpolation';

export function interpolate(template: string, context: Map<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, varName: string) => {
    return context.get(varName.trim()) ?? '';
  });
}

export function interpolateConfig(
  config: Record<string, string>,
  context: Map<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    result[key] = interpolate(value, context);
  }
  return result;
}

/**
 * URL rows keep their JSON structure; a whole-row variable may expand into several sources. A JSON
 * array value is taken as it is; a newline or comma list is split like a whole-field list and
 * keeps only the addresses (a model's "Here are the URLs:" is not a source). A list with nothing
 * usable, or an empty array, still holds its row's place, so `requireAll` sees the gap.
 */
export function interpolateBrowserUrls(template: string, context: Map<string, string>): string {
  const rows = parseJsonStringArray(template);
  if (!rows) return interpolate(template, context);
  const resolved = rows.flatMap((row) => {
    const value = interpolate(row, context);
    if (!/^\s*\{\{[^{}]+\}\}\s*$/.test(row)) return [value];
    const expanded = parseJsonStringArray(value);
    if (expanded) return expanded.length > 0 ? expanded : [''];
    const pieces = splitUrlListText(value);
    if (pieces.length < 2) return [value];
    const urls = pieces.filter(looksLikeWebUrl);
    return urls.length > 0 ? urls : [''];
  });
  return JSON.stringify(resolved);
}

export function inferTelegramSendAs(filePath: string): 'photo' | 'video' | 'audio' | 'document' | 'auto' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.gif') {
    return 'photo';
  }
  // Played in the chat rather than handed over as a file.
  if (ext === '.mp4') return 'video';
  // In Telegram's music player, with its title and length.
  if (ext === '.mp3' || ext === '.m4a') return 'audio';
  if (ext === '') return 'auto';
  return 'document';
}

export const PRODUCED_FILES_KEY = '__producedFiles';

/** One path per line: a post's several files are named each, and each is this run's file. */
export function recordProducedFile(context: Map<string, string>, filePath: string): void {
  const paths = filePath.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
  if (paths.length === 0) return;
  const list = getProducedFiles(context);
  const added = paths.filter((p) => !list.includes(p));
  if (added.length === 0) return;
  context.set(PRODUCED_FILES_KEY, JSON.stringify([...list, ...added]));
}

export function getProducedFiles(context: Map<string, string>): string[] {
  const prev = context.get(PRODUCED_FILES_KEY);
  if (!prev) return [];
  try {
    const parsed: unknown = JSON.parse(prev);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export { extractTemplateVariables };

async function isExistingFilePath(value: string): Promise<boolean> {
  const filePath = value.trim();
  if (!filePath) return false;
  if (/^[\\/]{2}/.test(filePath)) return false;
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function resolveMagicUploadFile(
  template: string,
  context: Map<string, string>,
): Promise<{ variable: string; filePath: string } | null> {
  const variables = extractTemplateVariables(template);
  for (const variable of variables) {
    const value = context.get(variable)?.trim() ?? '';
    if (!value) continue;
    if (await isExistingFilePath(value)) {
      return { variable, filePath: value };
    }
  }
  return null;
}
