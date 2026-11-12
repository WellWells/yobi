import type { CaptureFormat, SkillType } from './types';
import { isShareLinkFormat } from './shareFormat';

export function isCaptureFormat(value: string | undefined): value is CaptureFormat {
  return value === 'png' || value === 'webp' || value === 'pdf';
}

export function parseLlmExportFormats(value: string | undefined): CaptureFormat[] {
  return [...new Set((value ?? '').split(',').map((format) => format.trim()).filter(isCaptureFormat))];
}

/**
 * A step whose output is a file this run made: the runner puts it in `{{file}}` (the latest such
 * step's) and lets it go out as an attachment; the editor lists `{{file}}` under that step.
 */
export function isFileOutputStep(type: SkillType, config: Record<string, string>): boolean {
  if (type === 'capture') return true;
  if (type === 'share') return !isShareLinkFormat(config.format);
  if (type === 'file_write') return true;
  if (type === 'file_download') return true;
  if (type === 'youtube_download') return true;
  if (type === 'x_media') return true;
  if (type === 'llm') return parseLlmExportFormats(config.exportFormat).length > 0;
  return false;
}
