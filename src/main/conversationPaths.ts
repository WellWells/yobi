import * as path from 'node:path';

/** One spelling per conversation file, like the file system's: Windows and macOS file names ignore case. */
export function conversationPathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
}
