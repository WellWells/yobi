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
 * WRITING IS NARROWER THAN READING, and the difference is the whole reason `file_write` needs no
 * per-call confirmation.
 *
 * The read roots are the four folders a user keeps documents in. Two of them are also auto-run
 * locations: on Windows the PowerShell profile lives at
 * `Documents\PowerShell\Microsoft.PowerShell_profile.ps1` (`WindowsPowerShell\` for 5.1), and
 * `ensureTxtExt` leaves a `.ps1`/`.bat` name untouched. So a write anywhere in Documents was
 * arbitrary code execution at the next shell launch — reached WITHOUT the shell confirmation
 * dialog, which is the one boundary this feature is built on. Reading a document the user already
 * has is not the same act as planting one, so they no longer share a root set.
 *
 * The app output folder holds only what the app itself produced, is not on any auto-run path, and
 * is where every other `/agent` artefact already lands.
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
 * `path.resolve` alone compares the name, not the destination: a junction inside Documents that
 * points at `%USERPROFILE%\.ssh` is "inside the roots" by string and is then followed by
 * `fs.readFile`. Writing makes that worse — the same trick becomes a write-anywhere primitive —
 * so read and write share one containment rule.
 *
 * A file_write target usually does not exist yet, so realpath the deepest ancestor that does and
 * re-attach the tail; that still resolves a symlinked parent directory.
 */
/**
 * A UNC path costs 42 SECONDS here, measured: `fs.realpath` walks it one segment at a time and
 * each hop waits on the SMB timeout, while the turn looks frozen, the wall clock keeps draining
 * and Stop cannot interrupt it. Nothing on a network share can be inside a local root anyway, so
 * it is refused before the filesystem is touched at all.
 */
function isNonLocal(target: string): boolean {
  const abs = path.resolve(target);
  return abs.startsWith('\\\\') || abs.startsWith('//');
}

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
 * The final on-disk path a tool would touch, resolved the SAME way the executor resolves it.
 * Reading `config.folder` on its own is bypassed by one JSON key: an absolute `filename` makes
 * `resolveWritePath` drop `folder` entirely, and the `..`-segment filter it applies never sees
 * `folder` at all. Both escapes were reachable before this function covered file_write.
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

  // DENY OUTRANKS ALLOW, and it is checked first so that widening the allow list can never
  // quietly open a deny. A credential can sit inside a folder the agent is allowed to use
  // (`Desktop/id_rsa`), and a system folder can be added to the allow list by someone who did
  // not think about System32.
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
