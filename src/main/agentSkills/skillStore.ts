import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeFileAtomic } from '../atomicWrite';
import { sendLog } from '../helpers';
import {
  SKILL_FILE, hasFatalIssue, isValidSkillName, parseSkillMarkdown, skillTriggerText, withSkillIdentity,
} from '../../shared/agentSkills';
import { skillOriginUrl } from '../../shared/agentSkills';
import type { AgentSkillView, SkillOrigin, SkillSaveResult } from '../../shared/agentSkills';
import { SKILL_STATE_FILE, skillsRoot } from './skillPaths';
import { copySkillFiles, findSkillFile, readSkillFolder } from './skillFiles';
import type { SkillFileScan } from './skillFiles';
import { bundledSkillStatuses, ensureBundledSkills, hiddenBundledSkills, isBundledSkill } from './bundledSkills';

export interface SkillState {
  enabled: boolean;
  source?: string;
  installedAt?: string;
  /** Set for a skill imported from GitHub: where an update check looks. */
  origin?: SkillOrigin;
  /** The source folder's git tree hash when the installed copy matched it (the first check after install). */
  tree?: string;
  /** The hash the latest check saw; differing from `tree` means the source changed. */
  latest?: string;
}

export type StateFile = Record<string, SkillState>;

let stateQueue: Promise<unknown> = Promise.resolve();

function readOrigin(raw: unknown): SkillOrigin | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const fields = [value.owner, value.repo, value.ref, value.path];
  if (!fields.every((field) => typeof field === 'string')) return null;
  const [owner, repo, ref, at] = fields as string[];
  return owner && repo && ref ? { owner, repo, ref, path: at } : null;
}

export async function readState(): Promise<StateFile> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(skillsRoot(), SKILL_STATE_FILE), 'utf8'));
    const skills = (parsed as { skills?: unknown } | null)?.skills;
    if (!skills || typeof skills !== 'object' || Array.isArray(skills)) return {};
    const out: StateFile = {};
    for (const [name, value] of Object.entries(skills as Record<string, unknown>)) {
      const entry = value as Partial<SkillState> | null;
      if (!isValidSkillName(name) || !entry || typeof entry !== 'object') continue;
      const origin = readOrigin(entry.origin);
      out[name] = {
        enabled: entry.enabled !== false,
        ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
        ...(typeof entry.installedAt === 'string' ? { installedAt: entry.installedAt } : {}),
        ...(origin ? { origin } : {}),
        ...(origin && typeof entry.tree === 'string' ? { tree: entry.tree } : {}),
        ...(origin && typeof entry.latest === 'string' ? { latest: entry.latest } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Read-modify-write of the state file, one at a time (Windows refuses two renames onto one file). */
export function updateState(change: (state: StateFile) => void): Promise<void> {
  const next = stateQueue.then(async () => {
    const state = await readState();
    change(state);
    await fs.mkdir(skillsRoot(), { recursive: true });
    await writeFileAtomic(path.join(skillsRoot(), SKILL_STATE_FILE), `${JSON.stringify({ version: 1, skills: state }, null, 2)}\n`);
  });
  stateQueue = next.catch(() => undefined);
  return next;
}

/** The folder of an installed skill, or null: a name that is not valid never reaches the file system. */
export async function installedSkillDir(name: string): Promise<string | null> {
  if (!isValidSkillName(name)) return null;
  const dir = path.join(skillsRoot(), name);
  return (await findSkillFile(dir)) ? dir : null;
}

async function skillFolders(): Promise<string[]> {
  const entries = await fs.readdir(skillsRoot(), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && isValidSkillName(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Every installed skill, for the settings page. */
export async function listSkills(): Promise<AgentSkillView[]> {
  await ensureBundledSkills();
  const state = await readState();
  const views: AgentSkillView[] = [];
  const bundles = await bundledSkillStatuses();
  const hidden = await hiddenBundledSkills();
  for (const folder of await skillFolders()) {
    if (hidden.has(folder)) continue;
    const read = await readSkillFolder(path.join(skillsRoot(), folder), folder).catch(() => null);
    if (!read) continue;
    const entry = state[folder];
    const bundled = bundles.find(({ bundle }) => bundle.name === folder)?.view;
    views.push({
      ...read.view,
      // The folder is the identity: it is what `use_skill` and the state file are keyed by.
      name: folder,
      enabled: entry?.enabled !== false,
      source: entry?.source ?? '',
      installedAt: entry?.installedAt ?? '',
      ...(entry?.origin && entry.tree && entry.latest && entry.tree !== entry.latest ? { update: skillOriginUrl(entry.origin) } : {}),
      ...(bundled ? { bundled } : {}),
    });
  }
  for (const { bundle, view } of bundles) {
    if (views.some((entry) => entry.name === bundle.name)) continue;
    views.push({ ...bundle.read.view, name: bundle.name, enabled: false, source: '', installedAt: '', bundled: view });
  }
  return views;
}

/** What one agent run is offered: an enabled, usable skill's name and when to use it. */
export interface AgentSkillEntry {
  name: string;
  trigger: string;
  modelInvocable: boolean;
}

/** Reads only each SKILL.md, not the whole folder: this runs at the start of every agent run. */
export async function listAgentSkills(): Promise<AgentSkillEntry[]> {
  await ensureBundledSkills();
  const state = await readState();
  const entries: AgentSkillEntry[] = [];
  const hidden = await hiddenBundledSkills();
  for (const folder of await skillFolders()) {
    if (state[folder]?.enabled === false || hidden.has(folder)) continue;
    const file = await findSkillFile(path.join(skillsRoot(), folder));
    if (!file) continue;
    try {
      const parsed = parseSkillMarkdown(await fs.readFile(file, 'utf8'), folder);
      if (hasFatalIssue(parsed.issues)) continue;
      entries.push({ name: folder, trigger: skillTriggerText(parsed), modelInvocable: parsed.modelInvocable });
    } catch {
      // An unreadable skill is left out of this run; the settings page shows why.
    }
  }
  return entries;
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<boolean> {
  if (!(await installedSkillDir(name))) return false;
  await updateState((state) => {
    state[name] = { ...(state[name] ?? {}), enabled };
  });
  return true;
}

function asideName(name: string): string {
  return path.join(skillsRoot(), `.${name}.${randomBytes(6).toString('hex')}`);
}

/**
 * Saves an edited SKILL.md. A changed `name` renames the folder, refused when the name is taken;
 * the state entry follows the folder. A file with a fatal issue is not saved. A built-in skill
 * keeps its folder (renamed, its card would show "missing" and the copy turn personal), and no
 * skill can take a built-in skill's name.
 */
export async function saveSkillDoc(name: string, text: string): Promise<SkillSaveResult> {
  const dir = await installedSkillDir(name);
  if (!dir) return { ok: false, issue: { code: 'notFound', detail: name } };
  const parsed = parseSkillMarkdown(text, '');
  const fatal = parsed.issues.find((issue) => hasFatalIssue([issue]));
  if (fatal) return { ok: false, issue: fatal };
  const target = parsed.name;
  if (target !== name && await isBundledSkill(name)) return { ok: false, issue: { code: 'bundledRename', detail: name } };
  if (target !== name && await isBundledSkill(target)) return { ok: false, issue: { code: 'bundledName', detail: target } };
  if (target !== name && (await installedSkillDir(target) || await fs.stat(path.join(skillsRoot(), target)).then(() => true, () => false))) {
    return { ok: false, issue: { code: 'nameTaken', detail: target } };
  }
  const file = await findSkillFile(dir);
  const next = withSkillIdentity(text, target, null);
  const before = file ? await fs.readFile(file, 'utf8').catch(() => '') : '';
  if (target === name && before === next) return { ok: true, name };
  // `skill.md` (Claude Code's spelling) is renamed, never written beside and then deleted: on a
  // case-blind disk (Windows, macOS) the two are one file, and the delete took the new text with it.
  if (file && path.basename(file) !== SKILL_FILE) await fs.rename(file, path.join(dir, SKILL_FILE));
  await writeFileAtomic(path.join(dir, SKILL_FILE), next);
  if (target !== name) await fs.rename(dir, path.join(skillsRoot(), target));
  await updateState((state) => {
    // Edited here, it is the user's own version now: an update from its source would undo the edit.
    const { origin: _origin, tree: _tree, latest: _latest, ...kept } = state[name] ?? { enabled: true };
    delete state[name];
    state[target] = kept;
  });
  if (target !== name) sendLog(`🧩 [Skills] renamed "${name}" → "${target}"`);
  return { ok: true, name: target };
}

/** A file of the skill changed here: it is the user's own version now, so its source no longer updates it. */
export function markSkillEdited(name: string): Promise<void> {
  return updateState((state) => {
    const { origin: _origin, tree: _tree, latest: _latest, ...kept } = state[name] ?? { enabled: true };
    state[name] = kept;
  });
}

export async function deleteSkill(name: string): Promise<boolean> {
  if (await isBundledSkill(name)) return false;
  const dir = await installedSkillDir(name);
  if (!dir) return false;
  // Moved aside first: a folder held open by an editor fails here rather than half-deleted.
  const aside = asideName(name);
  await fs.rename(dir, aside);
  await fs.rm(aside, { recursive: true, force: true });
  await updateState((state) => {
    delete state[name];
  });
  sendLog(`🧩 [Skills] deleted "${name}"`);
  return true;
}

/**
 * Installs a checked skill folder under `name`, replacing one of that name only once the copy is
 * complete: a failed copy leaves the installed skill as it was. `description` is written into the
 * frontmatter when the file had to borrow it from its body.
 */
export async function installSkillFiles(
  scan: SkillFileScan,
  name: string,
  options: { source: string; description: string | null; skillFile: string; origin?: SkillOrigin },
): Promise<void> {
  // Callers refuse it with `bundledName` first; replacing a built-in copy here would skip its version history.
  if (await isBundledSkill(name)) throw new Error(`"${name}" is a built-in skill`);
  const root = skillsRoot();
  await fs.mkdir(root, { recursive: true });
  const incoming = asideName(`install-${name}`);
  try {
    await copySkillFiles(scan, incoming);
    // The spec's file name and a name that matches the folder, whatever the source had.
    const copied = path.join(incoming, ...options.skillFile.split('/'));
    const text = await fs.readFile(copied, 'utf8');
    if (options.skillFile !== SKILL_FILE) await fs.rm(copied, { force: true });
    await writeFileAtomic(path.join(incoming, SKILL_FILE), withSkillIdentity(text, name, options.description));
    const dest = path.join(root, name);
    const old = await fs.stat(dest).then(() => asideName(`old-${name}`), () => null);
    if (old) await fs.rename(dest, old);
    try {
      await fs.rename(incoming, dest);
    } catch (err) {
      if (old) await fs.rename(old, dest).catch(() => undefined);
      throw err;
    }
    if (old) await fs.rm(old, { recursive: true, force: true }).catch(() => undefined);
  } catch (err) {
    await fs.rm(incoming, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  await updateState((state) => {
    // A fresh copy: the next update check takes its source's tree as the new baseline.
    state[name] = {
      enabled: state[name]?.enabled !== false,
      source: options.source,
      installedAt: new Date().toISOString(),
      ...(options.origin ? { origin: options.origin } : {}),
    };
  });
  sendLog(`🧩 [Skills] installed "${name}" (${scan.files.length} files) from ${options.source || 'a local folder'}`);
}
