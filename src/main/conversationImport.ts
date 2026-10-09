import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import dayjs from 'dayjs';
import type { ConversationImportResult } from '../shared/types';
import { writeFileAtomic } from './atomicWrite';
import { buildOutputFile, buildSafeFileNameFromTitle, getUniquePath } from './files';
import type { ConversationHeadingAliases } from '../shared/conversationDoc';

export const IMPORTABLE_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.markdown']);
/** A conversation this size is already thousands of turns; anything bigger is not one. */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** One drop; the renderer never sends more, so a longer list is not a user's drop. */
export const IMPORT_MAX_FILES = 200;

export type ConversationImportOutcome = Omit<ConversationImportResult, 'files'>;

function isInside(dir: string, target: string): boolean {
  const relative = path.relative(dir, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

const THREAD_MARKER_LINE = /^<!--\s*yobi:thread\b.*-->[ \t]*$/gm;

/**
 * Opening a conversation stamps its thread marker, with a blank line, under the title (the
 * composer remembers the conversation's modes in it), so a copy that has been opened once no
 * longer matches its source byte for byte.
 */
function withoutThreadMarker(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(THREAD_MARKER_LINE, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * An earlier import of the same file, under any name this module could have given it:
 * `stem.md`, `stem-<stamp>.md`, or either with getUniquePath's ` (2)`.
 */
async function findEarlierCopy(root: string, stem: string, content: string): Promise<string | null> {
  const wanted = withoutThreadMarker(content);
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return null;
  }
  const candidates = names.filter((name) => name.toLowerCase().endsWith('.md')
    && (name === `${stem}.md` || name.startsWith(`${stem}-`) || name.startsWith(`${stem} (`)));
  for (const name of candidates) {
    const candidate = path.join(root, name);
    try {
      if (withoutThreadMarker(await fs.readFile(candidate, 'utf-8')) === wanted) return candidate;
    } catch {
    }
  }
  return null;
}

function safeStem(sourcePath: string): string {
  return buildSafeFileNameFromTitle(path.basename(sourcePath, path.extname(sourcePath)));
}

/**
 * A note with no time of its own is stamped with the import moment (`-YYYY-MM-DD-HH-mm-ss`), or it
 * would sink below every dated conversation in the list.
 */
function targetFileName(
  sourcePath: string,
  content: string,
  outputDir: string,
  aliases: ConversationHeadingAliases,
): string {
  const stem = safeStem(sourcePath);
  const plain = `${stem}.md`;
  if (buildOutputFile(path.join(outputDir, plain), content, aliases).timestamp) return plain;
  return `${stem}-${dayjs().format('YYYY-MM-DD-HH-mm-ss')}.md`;
}

/**
 * Copies dropped Markdown files into the outputs folder, where the conversation list reads
 * them. Files already in that folder (a row dragged out and straight back in) and a file an
 * earlier drop already copied in, byte for byte, are reported as `existing` and opened instead,
 * so a second drop of the same note does not grow a twin.
 */
export async function importConversationFiles(
  sourcePaths: unknown,
  outputDir: string,
  aliases: ConversationHeadingAliases,
): Promise<ConversationImportOutcome> {
  const outcome: ConversationImportOutcome = { imported: [], existing: [], skipped: 0, failed: 0 };
  if (!Array.isArray(sourcePaths)) return outcome;
  const root = path.resolve(outputDir);
  const seen = new Set<string>();

  for (const raw of sourcePaths.slice(0, IMPORT_MAX_FILES)) {
    if (typeof raw !== 'string' || !path.isAbsolute(raw)) {
      outcome.failed += 1;
      continue;
    }
    const source = path.resolve(raw);
    const key = source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (!IMPORTABLE_EXTENSIONS.has(path.extname(source).toLowerCase())) {
      outcome.skipped += 1;
      continue;
    }
    try {
      const stat = await fs.stat(source);
      if (!stat.isFile() || stat.size > IMPORT_MAX_BYTES) {
        outcome.failed += 1;
        continue;
      }
      if (isInside(root, source)) {
        outcome.existing.push(source);
        continue;
      }
      const content = await fs.readFile(source, 'utf-8');
      const earlier = await findEarlierCopy(root, safeStem(source), content);
      if (earlier) {
        outcome.existing.push(earlier);
        continue;
      }
      await fs.mkdir(root, { recursive: true });
      const target = await getUniquePath(path.join(root, targetFileName(source, content, root, aliases)), '');
      await writeFileAtomic(target, content);
      outcome.imported.push(target);
    } catch {
      outcome.failed += 1;
    }
  }
  return outcome;
}
