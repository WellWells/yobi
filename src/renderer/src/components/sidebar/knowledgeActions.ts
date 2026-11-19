import type { KnowledgeBase } from '../../../../shared/knowledgeBase';
import { KB_NAME_MAX } from '../../../../shared/knowledgeBase';
import type { KnowledgeSaveError, KnowledgeSaveRequest } from '../../../../shared/knowledgeStatus';

/** The folder's own name, as the base's name: the last part of the path, cut to the name limit. */
export function folderBaseName(folder: string): string {
  const parts = folder.replace(/[\\/]+$/, '').split(/[\\/]/);
  const name = (parts[parts.length - 1] ?? '').trim() || folder.trim();
  return name.slice(0, KB_NAME_MAX).trim();
}

function samePath(a: string, b: string): boolean {
  const norm = (value: string): string => value.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

export interface AddFromFolderDeps {
  bases: readonly KnowledgeBase[];
  pickFolder: () => Promise<string | null>;
  save: (request: KnowledgeSaveRequest) => Promise<{ bases: KnowledgeBase[] } | { error: KnowledgeSaveError }>;
}

export type AddFromFolderResult =
  | { kind: 'cancelled' }
  | { kind: 'added' | 'existing'; id: string }
  | { kind: 'error'; error: KnowledgeSaveError };

/**
 * The sidebar's 「＋」: pick a folder and it is a knowledge base — named after the folder, no form.
 * A folder that already is one opens that one; a name another base uses gets " 2", " 3"….
 */
export async function addKnowledgeFromFolder({ bases, pickFolder, save }: AddFromFolderDeps): Promise<AddFromFolderResult> {
  const folder = await pickFolder();
  if (!folder) return { kind: 'cancelled' };
  const existing = bases.find((kb) => samePath(kb.folder, folder));
  if (existing) return { kind: 'existing', id: existing.id };
  const base = folderBaseName(folder);
  let last: KnowledgeSaveError = 'name';
  for (let n = 1; n <= 20; n += 1) {
    const suffix = n === 1 ? '' : ` ${n}`;
    const name = `${base.slice(0, KB_NAME_MAX - suffix.length).trim()}${suffix}`;
    const result = await save({ name, folder, aliases: [] });
    if ('bases' in result) {
      const added = result.bases.find((kb) => samePath(kb.folder, folder) && kb.name === name);
      return added ? { kind: 'added', id: added.id } : { kind: 'error', error: 'name' };
    }
    last = result.error;
    if (result.error !== 'nameTaken') break;
  }
  return { kind: 'error', error: last };
}
