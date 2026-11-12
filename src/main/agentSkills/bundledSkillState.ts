import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isValidSkillName } from '../../shared/agentSkills';
import type { BundledSkillRevision } from '../../shared/agentSkills';
import { writeFileAtomic } from '../atomicWrite';

export interface BundledRevision extends BundledSkillRevision {
  /** The shipped baseline of `version`: what "modified" is measured against once restored. */
  hash: string;
  /** The archived files themselves; an identical copy is not archived twice. Absent in early records. */
  content?: string;
}

/** Archived copies kept per skill, newest first; older ones are deleted. */
export const BUNDLED_REVISIONS_MAX = 5;

/** `mkdtemp` folders of a replacement: a fixed prefix and six random characters, unlike `.bundled-history`. */
export const BUNDLED_TEMP_PREFIX = '.bundled-';
export const BUNDLED_TEMP_DIR = /^\.bundled-[A-Za-z0-9]{6}$/;

export interface BundledRecord {
  version: string;
  hash: string;
  revisions: BundledRevision[];
}

export type BundledState = Record<string, BundledRecord>;
const STATE_FILE = '.bundled.json';
let queue: Promise<unknown> = Promise.resolve();

export function bundledLane<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action);
  queue = next.catch(() => undefined);
  return next;
}

export function revisionDir(root: string, name: string, id: string): string {
  if (!isValidSkillName(name) || !/^[a-f0-9]{16}$/.test(id)) throw new Error('Invalid bundled skill revision.');
  return path.join(root, '.bundled-history', name, id);
}

export async function readBundledState(root: string): Promise<BundledState> {
  let text: string;
  try {
    text = await fs.readFile(path.join(root, STATE_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const state = JSON.parse(text) as { version?: unknown; skills?: unknown } | null;
  if (state?.version !== 2 || !state.skills || typeof state.skills !== 'object' || Array.isArray(state.skills)) {
    throw new Error('Invalid bundled skill installation record.');
  }
  const records: BundledState = {};
  for (const [name, raw] of Object.entries(state.skills)) {
    const entry = raw as Partial<BundledRecord> | null;
    if (!isValidSkillName(name) || !entry || typeof entry.version !== 'string' || typeof entry.hash !== 'string' || !Array.isArray(entry.revisions)) {
      throw new Error('Invalid bundled skill version record.');
    }
    for (const revision of entry.revisions) {
      if (!revision || !/^[a-f0-9]{16}$/.test(revision.id) || typeof revision.version !== 'string' || typeof revision.hash !== 'string'
        || typeof revision.createdAt !== 'string' || (revision.content !== undefined && typeof revision.content !== 'string')) {
        throw new Error('Invalid bundled skill revision record.');
      }
    }
    records[name] = { version: entry.version, hash: entry.hash, revisions: entry.revisions };
  }
  return records;
}

export async function writeBundledState(root: string, skills: BundledState): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await writeFileAtomic(path.join(root, STATE_FILE), `${JSON.stringify({ version: 2, skills }, null, 2)}\n`);
}
