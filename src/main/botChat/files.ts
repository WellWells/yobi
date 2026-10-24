import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ChatUploadFile {
  name: string;
  data: Uint8Array;
}

/**
 * The files a chat app will take, read into memory: at most `max` of them, each within `maxBytes`.
 * The rest are logged and left out rather than failing the whole message. Paths come from the
 * flow's attachment guard or the agent's own drawn pictures, never from the chat.
 */
export async function readUploadFiles(
  paths: readonly string[],
  limits: { max: number; maxBytes: number },
  onLog: (message: string) => void,
  tag: string,
): Promise<ChatUploadFile[]> {
  const files: ChatUploadFile[] = [];
  for (const file of paths.slice(0, limits.max)) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > limits.maxBytes) {
        onLog(`${tag} ${path.basename(file)} is over the upload limit — left out`);
        continue;
      }
      files.push({ name: path.basename(file), data: await fs.readFile(file) });
    } catch (err: unknown) {
      onLog(`${tag} could not read ${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (paths.length > limits.max) onLog(`${tag} ${paths.length - limits.max} file(s) over the per-message count — left out`);
  return files;
}
