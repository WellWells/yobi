import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { fdir } from 'fdir';
import type { CategoryDef } from './manifest';

export interface WalkedFile {
  abs: string;
  rel: string;
}

export function walkDirFiles(dir: string, filter?: (fileName: string) => boolean): WalkedFile[] {
  if (!existsSync(dir)) return [];
  const rels = new fdir().withRelativePaths().crawl(dir).sync();
  const out: WalkedFile[] = [];
  for (const rawRel of rels) {
    const rel = rawRel.replace(/\\/g, '/');
    if (filter && !filter(path.basename(rel))) continue;
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
