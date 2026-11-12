import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { hasFatalIssue } from '../../shared/agentSkills';
import type { BundledSkillChange, SkillSaveResult } from '../../shared/agentSkills';
import { copySkillFiles, readSkillFolder, scanSkillFiles } from './skillFiles';
import type { SkillFileScan } from './skillFiles';
import { bundledSkillCatalog, skillHash } from './bundledSkillCatalog';
import {
  BUNDLED_REVISIONS_MAX, BUNDLED_TEMP_DIR, BUNDLED_TEMP_PREFIX, bundledLane, readBundledState, revisionDir, writeBundledState,
} from './bundledSkillState';
import type { BundledRecord, BundledRevision, BundledState } from './bundledSkillState';
import { skillsRoot } from './skillPaths';
import { sendLog } from '../helpers';

async function exists(target: string): Promise<boolean> {
  return fs.lstat(target).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}

async function contentHash(dir: string): Promise<string | null> {
  return skillHash(await scanSkillFiles(dir)).catch(() => null);
}

/** Temp folders of a replacement that never finished (the app quit mid-copy). Call inside `bundledLane`. */
export async function sweepBundledTemp(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && BUNDLED_TEMP_DIR.test(entry.name)) {
      await fs.rm(path.join(root, entry.name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * A complete new folder, the old folder archived, then the version record; failures restore the old
 * copy. An old copy identical to the incoming one or to an archived revision is not archived again,
 * and only the newest `BUNDLED_REVISIONS_MAX` revisions are kept.
 */
export async function replaceBundledSkill(root: string, name: string, scan: SkillFileScan, state: BundledState, version: string, hash: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const dest = path.join(root, name);
  const incoming = await fs.mkdtemp(path.join(root, BUNDLED_TEMP_PREFIX));
  const previous = state[name] ?? { version: '', hash: '', revisions: [] };
  let moved: string | null = null;
  let discard: string | null = null;
  let dropped: BundledRevision[] = [];
  let activated = false;
  try {
    await copySkillFiles(scan, incoming);
    let revisions = [...previous.revisions];
    if (await exists(dest)) {
      const content = await contentHash(dest);
      const duplicate = content !== null && (content === await skillHash(scan) || revisions.some((entry) => entry.content === content));
      if (duplicate) {
        // Inside a temp folder: a crash before the delete leaves something the startup sweep removes.
        discard = await fs.mkdtemp(path.join(root, BUNDLED_TEMP_PREFIX));
        moved = path.join(discard, name);
      } else {
        const id = randomBytes(8).toString('hex');
        moved = revisionDir(root, name, id);
        await fs.mkdir(path.dirname(moved), { recursive: true });
        revisions.unshift({ id, version: previous.version, hash: previous.hash, createdAt: new Date().toISOString(), ...(content ? { content } : {}) });
      }
      await fs.rename(dest, moved);
    }
    dropped = revisions.slice(BUNDLED_REVISIONS_MAX);
    revisions = revisions.slice(0, BUNDLED_REVISIONS_MAX);
    await fs.rename(incoming, dest);
    activated = true;
    const next: BundledRecord = { version, hash, revisions };
    await writeBundledState(root, { ...state, [name]: next });
    state[name] = next;
  } catch (error) {
    if (activated) await fs.rename(dest, incoming).catch(() => undefined);
    if (moved) await fs.rename(moved, dest).catch(() => undefined);
    if (discard) await fs.rm(discard, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(incoming, { recursive: true, force: true }).catch(() => undefined);
  }
  // Only once the record no longer lists them: a failure above must still find every archived copy.
  if (discard) await fs.rm(discard, { recursive: true, force: true }).catch(() => undefined);
  for (const revision of dropped) {
    await fs.rm(revisionDir(root, name, revision.id), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Only shipped skill names and recorded revisions can reach a restore; renderer paths are never accepted. */
export function restoreBundledSkill(change: BundledSkillChange): Promise<SkillSaveResult> {
  return bundledLane(async () => {
    try {
      const bundle = (await bundledSkillCatalog()).find((entry) => entry.name === change.name);
      if (!bundle) return { ok: false, issue: { code: 'notFound', detail: change.name } };
      const root = skillsRoot();
      const state = await readBundledState(root);
      if (!change.revision) {
        await replaceBundledSkill(root, bundle.name, bundle.read.scan, state, bundle.version, bundle.hash);
        return { ok: true, name: bundle.name };
      }
      const revision = state[bundle.name]?.revisions.find((entry) => entry.id === change.revision);
      if (!revision) return { ok: false, issue: { code: 'notFound', detail: change.name } };
      const read = await readSkillFolder(revisionDir(root, bundle.name, revision.id), bundle.name);
      if (!read || hasFatalIssue(read.view.issues)) return { ok: false, issue: { code: 'badFile', detail: change.name } };
      await replaceBundledSkill(root, bundle.name, read.scan, state, revision.version, revision.hash);
      return { ok: true, name: bundle.name };
    } catch (error) {
      sendLog(`⚠️ [Skills] bundled skill restore failed: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, issue: { code: 'badFile', detail: change.name } };
    }
  });
}
