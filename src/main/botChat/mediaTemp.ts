/**
 * The scratch copies of pictures and files people hand a bot (Telegram, LINE PC): one folder in the
 * system temp, names that never keep a sender's runnable extension, deleted when the request is
 * done and swept at start-up when a run was cut short. Never Downloads/Yobi: these are not the
 * user's downloads, and the conversation keeps its own copy in chat-media (`keptAttachmentPaths`).
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UPLOADABLE_EXTENSIONS } from '../../shared/attachmentFormats';

/** Telegram's name, kept so copies an older version left are still swept. */
const TEMP_DIR_NAME = 'yobi-telegram-media';
const ORPHAN_MAX_AGE_MS = 6 * 60 * 60 * 1_000;

export function botMediaTempDir(): string {
  return path.join(os.tmpdir(), TEMP_DIR_NAME);
}

// SECURITY: the incoming name is attacker-controlled. Always generate the stem, and keep the
// sender's extension only when it is a picture or document type: traversal and control characters
// stay impossible, and nothing a double-click would run (.exe, .bat, .lnk…) is ever written.
const KEPT_EXTENSIONS: ReadonlySet<string> = new Set([...UPLOADABLE_EXTENSIONS, 'txt']);

export function safeLocalFileName(originalName: string | undefined, fallbackExt: string): string {
  const raw = (originalName ?? '').trim().toLowerCase();
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const candidate = dot > 0 ? base.slice(dot + 1) : '';
  const ext = KEPT_EXTENSIONS.has(candidate) ? candidate : fallbackExt;
  return `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
}

export async function readTextAttachment(filePath: string): Promise<string | null> {
  const bytes = await fs.readFile(filePath);
  const head = bytes.subarray(0, 8_192);
  if (head.includes(0)) return null;
  return bytes.toString('utf8');
}

/** Deletes scratch copies; a path outside the folder (a file the user picked) is left alone. */
export async function deleteTempAttachments(paths: readonly string[], dir: string = botMediaTempDir()): Promise<void> {
  await Promise.all(paths.map(async (target) => {
    const resolved = path.resolve(target);
    if (path.dirname(resolved) !== path.resolve(dir)) return;
    await fs.rm(resolved, { force: true }).catch(() => {});
  }));
}

export async function sweepOrphanTempAttachments(dir: string = botMediaTempDir()): Promise<number> {
  let removed = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const cutoff = Date.now() - ORPHAN_MAX_AGE_MS;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || stat.mtimeMs > cutoff) continue;
      await fs.rm(full, { force: true }).catch(() => {});
      removed += 1;
    }
  } catch {
  }
  return removed;
}
