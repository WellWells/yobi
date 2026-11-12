import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeFileAtomic } from '../atomicWrite';
import { sendLog } from '../helpers';
import {
  SKILL_FILE, SKILL_MD_MAX_BYTES, hasFatalIssue, parseSkillMarkdown, withSkillIdentity,
} from '../../shared/agentSkills';
import type { SkillSaveResult } from '../../shared/agentSkills';
import type { SkillFilesView, SkillTextFiles } from '../../shared/skillAuthoring';
import { skillStagingRoot, skillsRoot } from './skillPaths';
import { copySkillFiles, findSkillFile, scanSkillFiles } from './skillFiles';
import { installedSkillDir, markSkillEdited, saveSkillDoc, updateState } from './skillStore';
import { isBundledSkill } from './bundledSkills';

/*
 * A skill as the editor holds it: its text files (instructions, scripts, references, test cases)
 * by path, and the rest (a Python script, an image) listed but left alone. Saving writes only the
 * text files that changed and never deletes: a file the editor did not hold stays as it was.
 */

/** The files the editor opens and saves. Anything else in the folder is listed, not touched. */
// No backslash: path.join treats it as a separator on Windows, so `scripts/..\..\x.js` would leave the folder.
export const EDITABLE_SKILL_FILE = /^(SKILL\.md|scripts\/[^/\\]+\.(mjs|js|cjs)|references\/[^/\\]+\.md|evals\/evals\.json)$/;

function badFile(files: SkillTextFiles): string | null {
  return Object.keys(files).find((rel) => !EDITABLE_SKILL_FILE.test(rel) || files[rel].length > SKILL_MD_MAX_BYTES) ?? null;
}

export async function readSkillTextFiles(name: string): Promise<SkillFilesView | null> {
  const dir = await installedSkillDir(name);
  if (!dir) return null;
  const skillFile = await findSkillFile(dir);
  const { files } = await scanSkillFiles(dir);
  const view: SkillFilesView = { files: {}, others: [] };
  for (const file of files) {
    // Whatever case the instructions file has on disk, the editor calls it SKILL.md.
    const rel = skillFile && file.abs === skillFile ? SKILL_FILE : file.rel;
    if (EDITABLE_SKILL_FILE.test(rel) && file.size <= SKILL_MD_MAX_BYTES) view.files[rel] = await fs.readFile(file.abs, 'utf8');
    else view.others.push({ rel: file.rel, size: file.size });
  }
  return view;
}

/** Writes the files that differ from what is on disk; true when any did. */
async function writeChanged(dir: string, files: SkillTextFiles): Promise<boolean> {
  let changed = false;
  for (const [rel, text] of Object.entries(files)) {
    if (rel === SKILL_FILE) continue;
    const target = path.join(dir, ...rel.split('/'));
    const before = await fs.readFile(target, 'utf8').catch(() => null);
    if (before === text) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await writeFileAtomic(target, text);
    changed = true;
  }
  return changed;
}

/**
 * Saves the editor's files. The SKILL.md goes first through the same save as before (a new `name`
 * renames the folder, a fatal issue saves nothing); the other files then land in that folder.
 */
export async function saveSkillTextFiles(name: string, files: SkillTextFiles): Promise<SkillSaveResult> {
  const bad = badFile(files) ?? (files[SKILL_FILE] === undefined ? SKILL_FILE : null);
  if (bad) return { ok: false, issue: { code: 'badFile', detail: bad } };
  const saved = await saveSkillDoc(name, files[SKILL_FILE]);
  if (!saved.ok) return saved;
  const dir = path.join(skillsRoot(), saved.name);
  if (await writeChanged(dir, files)) {
    await markSkillEdited(saved.name);
    sendLog(`🧩 [Skills] saved the files of "${saved.name}"`);
  }
  return saved;
}

/** A new skill from the editor's files: written aside, then moved in whole, so a failure leaves nothing. */
export async function createSkillFromFiles(files: SkillTextFiles): Promise<SkillSaveResult> {
  const bad = badFile(files) ?? (files[SKILL_FILE] === undefined ? SKILL_FILE : null);
  if (bad) return { ok: false, issue: { code: 'badFile', detail: bad } };
  const parsed = parseSkillMarkdown(files[SKILL_FILE], '');
  const fatal = parsed.issues.find((entry) => hasFatalIssue([entry]));
  if (fatal) return { ok: false, issue: fatal };
  // A built-in skill's copy, even a missing one, comes only from Yobi.
  if (await isBundledSkill(parsed.name)) return { ok: false, issue: { code: 'bundledName', detail: parsed.name } };
  const root = skillsRoot();
  const dest = path.join(root, parsed.name);
  if (await fs.stat(dest).then(() => true, () => false)) return { ok: false, issue: { code: 'nameTaken', detail: parsed.name } };
  const aside = path.join(root, `.create-${parsed.name}.${randomBytes(6).toString('hex')}`);
  try {
    await fs.mkdir(aside, { recursive: true });
    await writeFileAtomic(path.join(aside, SKILL_FILE), withSkillIdentity(files[SKILL_FILE], parsed.name, null));
    await writeChanged(aside, files);
    await fs.rename(aside, dest);
  } catch (err) {
    await fs.rm(aside, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  await updateState((state) => {
    state[parsed.name] = { enabled: true, installedAt: new Date().toISOString() };
  });
  sendLog(`🧩 [Skills] created "${parsed.name}" (${Object.keys(files).length} files)`);
  return { ok: true, name: parsed.name };
}

export interface StagedDraft {
  dir: string;
  dispose: () => Promise<void>;
}

/**
 * A draft written to a folder of its own, for its scripts to run and a test run to load: the
 * installed skill `base` (its images, its other scripts) first, the editor's files over it. Not a
 * skill until saved; the staging folder is cleared at start-up too.
 */
export async function stageSkillDraft(files: SkillTextFiles, base?: string): Promise<StagedDraft> {
  const holder = path.join(skillStagingRoot(), `draft-${randomBytes(6).toString('hex')}`);
  const dir = path.join(holder, 'skill');
  const dispose = (): Promise<void> => fs.rm(holder, { recursive: true, force: true }).catch(() => undefined);
  try {
    const installed = base ? await installedSkillDir(base) : null;
    if (installed) await copySkillFiles(await scanSkillFiles(installed), dir);
    await fs.mkdir(dir, { recursive: true });
    for (const [rel, text] of Object.entries(files)) {
      if (!EDITABLE_SKILL_FILE.test(rel)) continue;
      const target = path.join(dir, ...rel.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, text);
    }
  } catch (err) {
    await dispose();
    throw err;
  }
  return { dir, dispose };
}
