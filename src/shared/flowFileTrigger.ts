import type { TriggerConfig } from './types';

/**
 * A "file" trigger runs its flow once for each file that appears in a watched folder. The run is
 * seeded with the new file's absolute path as {{file}} (the same magic variable a file-producing
 * step sets, so a later step that writes a file moves it on) and its name as {{file.name}}.
 */
export const FILE_TRIGGER_PATH_VAR = 'file';
export const FILE_TRIGGER_NAME_VAR = 'file.name';

/** Pattern separators: names may contain spaces ("Invoice *.pdf"), so only these split. */
const PATTERN_SPLIT_RE = /[;,\n]+/;

/** "*.pdf; *.png" → ['*.pdf', '*.png']; blank → [] (any file). */
export function parseWatchPatterns(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(PATTERN_SPLIT_RE)
    .map((p) => p.trim())
    .filter(Boolean);
}

function globToRegExp(glob: string): RegExp {
  let source = '';
  for (const ch of glob) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // Case-insensitive: Windows and macOS file names are, and "INVOICE.PDF" is still a PDF.
  return new RegExp(`^${source}$`, 'i');
}

/** Whether a file name (not a path) matches any pattern; no patterns = every name matches. */
export function matchesWatchPattern(name: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(name));
}

/** Endings of a file a browser or editor is still writing, renamed to the real name when done. */
const PARTIAL_SUFFIXES = ['.crdownload', '.part', '.partial', '.tmp', '.download'] as const;

/** What a browser writes next to the final name while the bytes are still coming in. */
export const PARTIAL_SIBLING_SUFFIXES: readonly string[] = ['.crdownload', '.part', '.download'];

/** Files the system drops into any folder a person opens; never something they put there. */
const SYSTEM_FILE_NAMES = new Set(['thumbs.db', 'desktop.ini']);

/**
 * A name that is never the finished file: a download or save in progress, an Office lock file
 * (`~$Report.docx`), a hidden file, or a file the system writes into folders by itself.
 */
export function isTemporaryFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower || lower.startsWith('.') || lower.startsWith('~$')) return true;
  if (SYSTEM_FILE_NAMES.has(lower)) return true;
  return PARTIAL_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * A folder whose contents are not files a person put there: a hidden one (.git, .cache), or a
 * download still in progress — Safari writes "report.pdf.download/" holding the half-written
 * "report.pdf" and moves the finished file out of it.
 */
export function isTemporaryFolderName(name: string): boolean {
  return isTemporaryFileName(name);
}

/**
 * A folder the trigger can watch: an absolute path (Windows drive or UNC, or POSIX) or one under
 * the home folder (`~`, `~/Downloads`). A relative path has nothing to be relative to.
 */
export function isUsableWatchFolder(raw: string | undefined): boolean {
  const folder = (raw ?? '').trim();
  if (!folder) return false;
  if (folder === '~' || folder.startsWith('~/') || folder.startsWith('~\\')) return true;
  return /^[a-z]:[\\/]/i.test(folder) || folder.startsWith('\\\\') || folder.startsWith('/');
}

export function hasFileTrigger(triggers: readonly TriggerConfig[]): boolean {
  return triggers.some((trigger) => trigger.type === 'file');
}
