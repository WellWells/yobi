import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import type { SkillType } from '../../../shared/types';
import { getOutputDir } from '../../files';
import { resolveUserPath, resolveWritePath } from '../skills/fileOps';
import { sensitivePathReason } from './sensitivePaths';

export async function getAgentFileRoots(): Promise<string[]> {
  const roots: string[] = [await getOutputDir()];
  for (const key of ['documents', 'downloads', 'desktop'] as const) {
    try {
      const dir = app.getPath(key);
      if (dir) roots.push(dir);
    } catch {
    }
  }
  return roots;
}

/**
 * Writes are confined to the app output folder, narrower than the read roots: Documents holds
 * auto-run files (e.g. the PowerShell profile), so writing there would bypass the shell
 * confirmation. That confinement is why `file_write` needs no per-call confirmation.
 */
export async function getAgentWriteRoots(): Promise<string[]> {
  return [await getOutputDir()];
}

export function isWithinRoots(resolvedAbs: string, roots: string[]): boolean {
  const target = path.resolve(resolvedAbs);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/**
 * Network (UNC) paths are refused before touching the filesystem: realpath can block on the SMB
 * timeout per segment, and nothing on a share is inside a local root.
 */
function isNonLocal(target: string): boolean {
  const abs = path.resolve(target);
  return abs.startsWith('\\\\') || abs.startsWith('//');
}

/**
 * Containment compares realpaths so a junction or symlink inside a root cannot reach outside it.
 * A write target may not exist yet, so the deepest existing ancestor is resolved and the tail
 * re-attached.
 */
async function resolveReal(target: string): Promise<string> {
  const abs = path.resolve(target);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(head);
      return tail.length > 0 ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return abs;
      tail.push(path.basename(head));
      head = parent;
    }
  }
}

/**
 * Where the agent's own path resolution starts, and the cwd every `shell` command is pinned to.
 * A relative path in a command therefore lands in the same folder `file_write` would use.
 */
export async function agentWorkspaceDir(): Promise<string> {
  return getOutputDir();
}

/**
 * The final on-disk path a tool would touch, resolved exactly as the executor does: an absolute
 * `filename` makes `resolveWritePath` drop `folder`, and its `..` filter never sees `folder`, so
 * checking `folder` alone is not enough.
 */
async function targetPathForTool(
  tool: SkillType,
  config: Record<string, string>,
): Promise<string | undefined> {
  if (tool === 'file_read') {
    const raw = (config.path ?? '').trim();
    return raw ? resolveUserPath(raw) : undefined;
  }
  if (tool === 'file_list') {
    const raw = (config.directory ?? '').trim();
    return raw ? resolveUserPath(raw) : undefined;
  }
  if (tool === 'file_write') {
    // No early-out on a blank field: blank `folder` + blank `filename` is a legitimate call that
    // still has to be checked, because `resolveWritePath` picks the destination itself.
    return resolveWritePath((config.folder ?? '').trim(), (config.filename ?? '').trim());
  }
  return undefined;
}

const READ_DENIAL = 'access denied: "%s" is outside the folders this agent may read (the app output folder, Documents, Downloads, Desktop). Do not retry it or a variation of it — ask the user to place the file in one of those folders, or use another tool.';
const WRITE_DENIAL = 'access denied: this would write to "%s". You may only write inside the app output folder — you can READ from Documents, Downloads and Desktop, but not write there. Do not retry it or a variation of it: leave "folder" blank to write to the output folder, and tell the user the path so they can move the file where they want it.';

export async function denyReasonForFileTool(
  tool: SkillType,
  config: Record<string, string>,
  roots: string[],
): Promise<string | null> {
  const resolved = await targetPathForTool(tool, config);
  if (resolved === undefined) return null;

  const write = tool === 'file_write';
  const template = write ? WRITE_DENIAL : READ_DENIAL;
  // What the MODEL asked for, never the resolved absolute path: the observation is sent verbatim
  // to a third-party web UI, and a resolved Windows path carries the account name with it.
  const asked = write
    ? [config.folder, config.filename].map((part) => (part ?? '').trim()).filter(Boolean).join(' / ')
    : (config.path ?? config.directory ?? '').trim();
  const shown = asked || '(the default location)';
  const deny = (): string => template.replace('%s', shown);

  if (isNonLocal(resolved)) return deny();

  // Deny is checked before allow: a credential inside an allowed folder (`Desktop/id_rsa`) stays
  // refused, and widening the allow list never opens a deny.
  const sensitive = sensitivePathReason(resolved, roots);
  if (sensitive) {
    return `access denied: ${sensitive}. Do not retry it or a variation of it — tell the user what you needed and let them handle it themselves.`;
  }

  // A write is confined to `getAgentWriteRoots()`, which is narrower than what may be read.
  const effectiveRoots = write ? await getAgentWriteRoots() : roots;
  const realTarget = await resolveReal(resolved);
  const realRoots = await Promise.all(effectiveRoots.map((root) => resolveReal(root)));
  return isWithinRoots(realTarget, realRoots) ? null : deny();
}
