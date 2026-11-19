/**
 * The text of a Word, Excel or PowerPoint file (OfficeCLI's `view text`), for `file_read`. The
 * Office connector need not be on: Yobi's managed copy or the one found on the computer reads it,
 * as `pdf/fileToPdf.ts` prints with it.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveTool, toolRunEnv, toolSpec } from '../managedTools';

const run = promisify(execFile);

const OFFICE_TEXT_TIMEOUT_MS = 60_000;
const OFFICE_TEXT_MAX_BUFFER = 32 * 1024 * 1024;
const OFFICE_TEXT_FILE = /\.(?:docx|xlsx|pptx)$/i;

/** Said to the model when OfficeCLI is nowhere on the computer. */
export const OFFICE_TOOL_NEEDED = 'Word, Excel and PowerPoint files need OfficeCLI, which is not on this computer. Tell the user to turn on the Office files connector in Settings > Connectors and download it there.';

export function isOfficeTextFile(file: string): boolean {
  return OFFICE_TEXT_FILE.test(file);
}

/**
 * Drops the element path OfficeCLI puts before each paragraph (`[/body/p[@paraId=…]] `,
 * `[/slide[1]/shape[@name=Title 1]] `): it is for editing, and costs a reader's budget on every line.
 */
export function withoutElementPaths(text: string): string {
  return text.replace(/^\[\/(?:[^[\]\r\n]|\[[^\]\r\n]*\])*\] ?/gm, '');
}

/** The file's text; the caller has checked it may be read. */
export async function readOfficeText(file: string, signal?: AbortSignal): Promise<string> {
  const copy = await resolveTool('officecli');
  if (!copy) throw new Error(OFFICE_TOOL_NEEDED);
  const { stdout } = await run(copy.path, ['view', file, 'text'], {
    env: toolRunEnv(toolSpec('officecli'), copy.source),
    timeout: OFFICE_TEXT_TIMEOUT_MS,
    maxBuffer: OFFICE_TEXT_MAX_BUFFER,
    windowsHide: true,
    encoding: 'utf8',
    ...(signal ? { signal } : {}),
  });
  return withoutElementPaths(stdout).trim();
}
