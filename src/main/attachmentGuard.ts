import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getOutputDir } from './files';

/* One field holding several paths, written the two ways a person actually writes a list. */
export function parseAttachmentList(raw: string | undefined): string[] {
  return (raw ?? '').split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean);
}

/*
 * The single gate every local file passes before it leaves the machine — as a Telegram
 * upload or as an attachment on an AI prompt. A path is allowed when it is one the running
 * flow produced itself, or when it lives inside the app's own output folder. Anything else
 * is refused, so an interpolated variable carrying "C:/Users/…/id_rsa" cannot be sent.
 *
 * Both checks compare realpath-resolved values: a symlink pointing out of the output folder
 * would otherwise walk straight through the prefix test.
 */
export async function resolveSafeLocalAttachment(
  filePath: string,
  authorizedPaths: string[] = [],
): Promise<string> {
  if (filePath.includes('\0')) {
    throw new Error('Attachment path is invalid (contains a NUL byte)');
  }
  /*
   * Before resolving, not after: realpath on a UNC path reaches out to the host, which both
   * stalls the step for the SMB timeout and offers the credentials of whoever is logged in to
   * a server named by an interpolated variable. A path this run produced itself is exempt —
   * the machine already wrote to that share, so resolving it reveals nothing new.
   */
  if (!authorizedPaths.includes(filePath) && /^[\\/]{2}/.test(filePath)) {
    throw new Error('Attachment must be a local file or an http(s) URL, not a network path');
  }
  const resolved = await fs.realpath(filePath).catch(() => path.resolve(filePath));

  for (const candidate of authorizedPaths) {
    const authResolved = await fs.realpath(candidate).catch(() => path.resolve(candidate));
    if (authResolved === resolved) return resolved;
  }

  const root = await fs.realpath(await getOutputDir()).catch(() => path.resolve('.'));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Attachment is outside the Yobi output folder and was blocked');
  }
  return resolved;
}
