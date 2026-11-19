import * as fs from 'node:fs/promises';

const RENAME_LOCKED_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 3_000, 4_000, 5_000];

/**
 * `fs.rename`, waiting out Windows' hold on a file or folder whose program just ran: the exe stays
 * locked for a moment (antivirus scanning it, the image still mapped), and renaming then fails
 * with EPERM.
 */
export async function renameWhenUnlocked(
  from: string,
  to: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (!RENAME_LOCKED_CODES.has(code) || delay === undefined) throw err;
      await sleep(delay);
    }
  }
}
