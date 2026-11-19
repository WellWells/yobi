import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomic } from '../atomicWrite';
import { getOutputDir } from '../files';
import { sendLog } from '../helpers';
import { agentReadPathFor } from '../flow/agent/agentSandbox';
import { reserveName } from '../flow/skills/savedDownloads';
import { isByokImageFile } from '../../shared/attachmentFormats';
import { isByokTargetUrl } from '../../shared/types';
import { TOOL_MEDIA_EXTENSIONS } from '../botChat/mediaTemp';

/*
 * The Office files a person attaches to an `/agent` request. The agent may only write in the output
 * folder, and an attachment lies in chat-media, so each gets a working copy there under its own name
 * (numbered when taken): the agent edits that copy and it goes back with the answer.
 */

/** What the Office connector edits; CSV/TSV come along to be imported into a workbook. */
const WORKING_EXT = /\.(?:docx|xlsx|pptx|csv|tsv)$/i;
const MAX_COPIES = 10;

export function isOfficeAttachment(file: string): boolean {
  return WORKING_EXT.test(file);
}

/**
 * Copies the Office attachments into the output folder; the names the agent's tools use, in the
 * attachments' order. One that cannot be copied is logged and left out.
 */
export async function officeWorkingCopies(attachments: readonly string[], outputDir?: string): Promise<string[]> {
  const files = attachments.filter(isOfficeAttachment).slice(0, MAX_COPIES);
  if (files.length === 0) return [];
  const dir = outputDir ?? await getOutputDir();
  const names: string[] = [];
  for (const file of files) {
    let target = '';
    try {
      await fs.mkdir(dir, { recursive: true });
      target = path.join(dir, await reserveName(dir, path.basename(file)));
      await writeFileAtomic(target, await fs.readFile(file));
      const name = await agentReadPathFor(target);
      if (name) names.push(name);
    } catch (err) {
      if (target) await fs.rm(target, { force: true }).catch(() => {});
      sendLog(`⚠️ [Agent] Attachment working copy not made: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return names;
}

/**
 * The attachments uploaded to the run's model. A BYOK key takes pictures only, and one deck it
 * cannot take (a .pptx, say) would fail the whole run: the
 * rest are listed under ATTACHED FILES and read with the file tools (OfficeCLI for Office files).
 */
export function modelUploads(providerUrl: string, attachments: readonly string[] | undefined): string[] | undefined {
  if (!attachments) return undefined;
  // A video or a recording a bot fetched for a conversion is for the tools (FFmpeg); no model is shown it.
  const shown = attachments.filter((file) => !isToolMediaFile(file));
  return isByokTargetUrl(providerUrl) ? shown.filter((file) => isByokImageFile(undefined, file)) : shown;
}

const TOOL_MEDIA = new Set(TOOL_MEDIA_EXTENSIONS);

/** A video or a recording: read by the run's tools only. */
export function isToolMediaFile(file: string): boolean {
  return TOOL_MEDIA.has(path.extname(file).slice(1).toLowerCase());
}

/**
 * What the run's prompt lists under ATTACHED FILES: the Office working copies (when the connector
 * made them), then every other attachment by the name the file tools read it at — so "make this a
 * PDF" or "read it" can name the file. One outside every folder the agent reads (a temporary
 * chat's paste) is left out: naming it would only earn a denial.
 */
export async function attachedFileNames(
  attachments: readonly string[] | undefined,
  workingCopies: readonly string[] | undefined,
): Promise<string[]> {
  const names = [...(workingCopies ?? [])];
  for (const file of attachments ?? []) {
    if (workingCopies !== undefined && isOfficeAttachment(file)) continue;
    const name = await agentReadPathFor(file);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
