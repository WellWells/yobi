import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getOutputDir } from './files';

/** The guard's refusals, as logs and `localizeUserFacingError` read them. */
export const ATTACHMENT_HAS_NUL = 'Attachment path is invalid (contains a NUL byte)';
export const ATTACHMENT_NETWORK_PATH = 'Attachment must be a local file or an http(s) URL, not a network path';
export const ATTACHMENT_OUTSIDE_OUTPUT = 'Attachment is outside the Yobi output folder and was blocked';

export function parseAttachmentList(raw: string | undefined): string[] {
  return (raw ?? '').split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean);
}

// SECURITY: the single gate every local file passes before it leaves the machine.
// Allow only paths the running flow produced itself or files inside the app's own
// output folder; anything else must be refused, never corrected.
export async function resolveSafeLocalAttachment(
  filePath: string,
  authorizedPaths: string[] = [],
): Promise<string> {
  if (filePath.includes('\0')) {
    throw new Error(ATTACHMENT_HAS_NUL);
  }
  if (!authorizedPaths.includes(filePath) && /^[\\/]{2}/.test(filePath)) {
    throw new Error(ATTACHMENT_NETWORK_PATH);
  }
  const resolved = await fs.realpath(filePath).catch(() => path.resolve(filePath));

  for (const candidate of authorizedPaths) {
    const authResolved = await fs.realpath(candidate).catch(() => path.resolve(candidate));
    if (authResolved === resolved) return resolved;
  }

  const root = await fs.realpath(await getOutputDir()).catch(() => path.resolve('.'));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(ATTACHMENT_OUTSIDE_OUTPUT);
  }
  return resolved;
}
