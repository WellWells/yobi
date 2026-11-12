import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sendLog } from '../helpers';
import { bundledSkillCatalog, offeredIn, skillHash } from './bundledSkillCatalog';
import type { BundledSkill } from './bundledSkillCatalog';
import { bundledLane, readBundledState, writeBundledState } from './bundledSkillState';
import type { BundledState } from './bundledSkillState';
import { replaceBundledSkill, sweepBundledTemp } from './bundledSkillVersions';
import { readSkillFolder } from './skillFiles';
import type { BundledSkillView } from '../../shared/agentSkills';
import { skillsRoot } from './skillPaths';

export { bundledSkillsRoot } from './bundledSkillPaths';

let readLocale: () => string = () => '';

/** The interface language, read on every call: switching to it later makes its skills appear. */
export function setSkillLocale(read: () => string): void {
  readLocale = read;
}

/** Every shipped skill name, offered here or not: none can be taken by a personal skill. */
export async function isBundledSkill(name: string): Promise<boolean> {
  return (await bundledSkillCatalog()).some((entry) => entry.name === name);
}

/**
 * Shipped skills not offered in the current interface language. Their folders stay on disk (a
 * language switch deletes nothing); the settings page and `/agent` leave them out.
 */
export async function hiddenBundledSkills(): Promise<Set<string>> {
  const locale = readLocale();
  return new Set((await bundledSkillCatalog()).filter((entry) => !offeredIn(entry, locale)).map((entry) => entry.name));
}

/** The skills folder already swept this run: the first list or agent run after startup sweeps it. */
let swept = '';

/** New bundles install once; missing or edited copies remain visible for an explicit restore. */
export function ensureBundledSkills(source?: string): Promise<void> {
  const root = skillsRoot();
  return bundledLane(async () => {
    if (swept !== root) {
      swept = root;
      await sweepBundledTemp(root);
    }
    const locale = readLocale();
    const catalog = (await bundledSkillCatalog(source)).filter((entry) => offeredIn(entry, locale));
    if (catalog.length === 0) return;
    const state = await readBundledState(root);
    for (const bundle of catalog) {
      if (state[bundle.name]) continue;
      const existing = await fs.lstat(path.join(root, bundle.name)).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (existing) {
        // An earlier user copy has no trusted baseline; never silently overwrite or adopt its contents.
        state[bundle.name] = { version: '', hash: '', revisions: [] };
        await writeBundledState(root, state);
        continue;
      }
      await replaceBundledSkill(root, bundle.name, bundle.read.scan, state, bundle.version, bundle.hash);
    }
  }).catch((error) => {
    sendLog(`⚠️ [Skills] bundled skills unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export interface BundledSkillStatus {
  bundle: BundledSkill;
  view: BundledSkillView;
}

function newerVersion(available: string, current: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(current)) return true;
  const left = available.split('.').map(Number);
  const right = current.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

async function bundledStatus(root: string, bundle: BundledSkill, state: BundledState): Promise<BundledSkillStatus> {
  const record = state[bundle.name];
  const read = await readSkillFolder(path.join(root, bundle.name), bundle.name).catch(() => null);
  return {
    bundle,
    view: {
      interfaceId: bundle.interfaceId,
      installed: read !== null,
      currentVersion: record?.version ?? read?.parsed.version ?? '',
      availableVersion: bundle.version,
      updateAvailable: read !== null && (newerVersion(bundle.version, record?.version ?? '') || (record?.version === bundle.version && record.hash !== bundle.hash)),
      modified: read !== null && (!record?.hash || await skillHash(read.scan) !== record.hash),
      revisions: record?.revisions.map(({ id, version, createdAt }) => ({ id, version, createdAt })) ?? [],
    },
  };
}

/** The shipped catalog for this interface language, even when a previously installed copy was removed. */
export async function bundledSkillStatuses(): Promise<BundledSkillStatus[]> {
  const root = skillsRoot();
  const locale = readLocale();
  const catalog = (await bundledSkillCatalog()).filter((entry) => offeredIn(entry, locale));
  const state = await readBundledState(root).catch((): BundledState => ({}));
  const statuses: BundledSkillStatus[] = [];
  for (const bundle of catalog) {
    try {
      statuses.push(await bundledStatus(root, bundle, state));
    } catch (error) {
      // A file that vanished mid-read: this one card is left out, the page still lists.
      sendLog(`⚠️ [Skills] bundled skill "${bundle.name}" status unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return statuses;
}
