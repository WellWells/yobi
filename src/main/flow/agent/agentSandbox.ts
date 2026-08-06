import * as path from 'node:path';
import { app } from 'electron';
import type { SkillType } from '../../../shared/types';
import { getOutputDir } from '../../files';
import { resolveUserPath } from '../skills/fileOps';

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

export function isWithinRoots(resolvedAbs: string, roots: string[]): boolean {
  const target = path.resolve(resolvedAbs);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function filePathField(tool: SkillType, config: Record<string, string>): string | undefined {
  if (tool === 'file_read') return config.path;
  if (tool === 'file_list') return config.directory;
  return undefined;
}

export async function denyReasonForFileTool(
  tool: SkillType,
  config: Record<string, string>,
  roots: string[],
): Promise<string | null> {
  const raw = filePathField(tool, config);
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const resolved = await resolveUserPath(trimmed);
  if (isWithinRoots(resolved, roots)) return null;
  return `access denied: "${trimmed}" is outside the folders this agent may read (the app output folder, Documents, Downloads, Desktop). Do not retry other local paths; ask the user to place the file in one of those folders, or use another tool.`;
}
