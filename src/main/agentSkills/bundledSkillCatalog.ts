import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { hasFatalIssue, isValidSkillName } from '../../shared/agentSkills';
import { readSkillFolder } from './skillFiles';
import type { ReadSkill, SkillFileScan } from './skillFiles';
import { bundledSkillsRoot } from './bundledSkillPaths';
import { sendLog } from '../helpers';

export interface BundledSkill {
  name: string;
  version: string;
  interfaceId: string;
  /** Interface languages the skill is offered in; empty = every language. */
  locales: string[];
  hash: string;
  read: ReadSkill;
}

export async function skillHash(scan: SkillFileScan): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...scan.files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    const data = await fs.readFile(file.abs);
    hash.update(JSON.stringify([file.rel, data.length]));
    hash.update(data);
  }
  return hash.digest('hex');
}

/** A region-specific skill (Taiwan stores and prices) is offered only in that interface language. */
export function offeredIn(bundle: Pick<BundledSkill, 'locales'>, locale: string): boolean {
  return bundle.locales.length === 0 || bundle.locales.includes(locale);
}

interface HostMetadata {
  interface?: { id?: unknown };
  locales?: unknown;
}

async function readBundle(dir: string, name: string): Promise<BundledSkill> {
  const read = await readSkillFolder(dir, name);
  if (!read || hasFatalIssue(read.view.issues) || !/^\d+\.\d+\.\d+$/.test(read.parsed.version ?? '')) {
    throw new Error('needs a valid document and semantic version');
  }
  const config = JSON.parse(await fs.readFile(path.join(dir, 'agents/yobi.json'), 'utf8')) as HostMetadata | null;
  const interfaceId = config?.interface?.id;
  if (typeof interfaceId !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(interfaceId)) throw new Error('needs GUI metadata');
  const locales = config?.locales ?? [];
  if (!Array.isArray(locales) || !locales.every((locale) => typeof locale === 'string' && locale)) {
    throw new Error('has an unreadable locale list');
  }
  return { name, version: read.parsed.version!, interfaceId, locales: locales as string[], hash: await skillHash(read.scan), read };
}

/**
 * Standard SKILL.md metadata is for the agent; agents/yobi.json describes the host's interface.
 * An unreadable folder is left out with a log line: one bad entry must not take the skills page,
 * a delete or an agent run down with it.
 */
export async function bundledSkillCatalog(source = bundledSkillsRoot()): Promise<BundledSkill[]> {
  const folders = await fs.readdir(source, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') sendLog(`⚠️ [Skills] bundled skills folder unreadable: ${error.message}`);
    return [];
  });
  const catalog: BundledSkill[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || !isValidSkillName(folder.name)) continue;
    try {
      catalog.push(await readBundle(path.join(source, folder.name), folder.name));
    } catch (error) {
      sendLog(`⚠️ [Skills] bundled skill "${folder.name}" skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return catalog;
}
