import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

/*
 * Write-to-temp-then-rename, so a store file is either the old content or the new content and
 * never the empty or half-written file an in-place write leaves when the process dies after its
 * O_TRUNC. Every store here reads an unparseable file as "nothing saved", so without this the next
 * save would persist that empty result over the only copy.
 *
 * Callers must serialize writes to the same target (a write chain, a mutex, or one synchronous
 * writer): overlapping renames onto one file fail with EPERM on Windows. There is deliberately no
 * retry — without per-target ordering a retried older write could land after a newer one.
 */

let seq = 0;

/**
 * Unique per call (a fixed per-process name would let two writes share one temp file), in the
 * target's own folder so the rename never crosses a volume, hidden, and never ending in .json or
 * .md: listings and prunes pick store files by those extensions.
 */
function tempPathFor(file: string): string {
  return path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}-${seq++}.tmp`);
}

export async function writeFileAtomic(file: string, content: string): Promise<void> {
  const tmp = tempPathFor(file);
  try {
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, file);
  } catch (err: unknown) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** For writers that cannot await, such as the flush on quit. */
export function writeFileAtomicSync(file: string, content: string): void {
  const tmp = tempPathFor(file);
  try {
    fsSync.writeFileSync(tmp, content, 'utf-8');
    fsSync.renameSync(tmp, file);
  } catch (err: unknown) {
    try {
      fsSync.rmSync(tmp, { force: true });
    } catch {
      // The original failure is the one worth reporting.
    }
    throw err;
  }
}
