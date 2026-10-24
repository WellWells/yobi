import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { fdir } from 'fdir';
import type { CategoryDef } from './manifest';

/** Deeper than this many folders is not something Yobi or a person filing conversations makes. */
export const OUTPUTS_MAX_FOLDER_DEPTH = 8;

/**
 * A conversation file the outputs category carries, by its path inside outputs: a `.md` whose
 * folders and name do not start with a dot (not conversations: `.git`, editors' settings, temp
 * files), at most OUTPUTS_MAX_FOLDER_DEPTH folders deep, with no `..`, empty segment or drive colon.
 * One folder level is what the sidebar has; a file deeper belongs to its top folder there.
 */
export function isBackupConversationPath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/);
  if (segments.length === 0 || segments.length > OUTPUTS_MAX_FOLDER_DEPTH + 1) return false;
  if (segments.some((segment) => !segment || segment.startsWith('.') || segment.includes(':'))) return false;
  return (segments.at(-1) ?? '').toLowerCase().endsWith('.md');
}

export interface WalkedFile {
  abs: string;
  rel: string;
}

/** Every file under `dir`; `filter` gets each one's `/`-separated path inside it. */
export function walkDirFiles(dir: string, filter?: (relativePath: string) => boolean): WalkedFile[] {
  if (!existsSync(dir)) return [];
  const rels = new fdir().withRelativePaths().crawl(dir).sync();
  const out: WalkedFile[] = [];
  for (const rawRel of rels) {
    const rel = rawRel.replace(/\\/g, '/');
    if (filter && !filter(rel)) continue;
    out.push({ abs: path.join(dir, rel), rel });
  }
  return out;
}

export async function countCategoryItems(def: CategoryDef): Promise<number> {
  const source = await def.resolveSource();
  if (def.kind === 'file') return existsSync(source) ? 1 : 0;
  return walkDirFiles(source, def.fileFilter).length;
}

export function safeResolveWithin(rootDir: string, rel: string): string | null {
  const root = path.resolve(rootDir);
  const dest = path.resolve(root, rel);
  if (dest !== root && !dest.startsWith(root + path.sep)) return null;
  return dest;
}
