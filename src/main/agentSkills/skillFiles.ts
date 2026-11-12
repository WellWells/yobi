import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PROGRAM_EXTENSIONS, PROGRAM_SNIFF_BYTES, declaredExtension, looksLikeProgram } from '../executableFiles';
import {
  SKILL_FILE, SKILL_MAX_BYTES, SKILL_MAX_FILES, SKILL_MD_MAX_BYTES, parseSkillMarkdown, runtimeOf,
} from '../../shared/agentSkills';
import type { ParsedSkill, SkillIssue, SkillRuntime, SkillSummaryView } from '../../shared/agentSkills';

/** Never part of a skill: version control, caches, OS litter. Skipped on scan, copy and export alike. */
const SKIPPED_NAMES = new Set(['.git', '.hg', '.svn', '__pycache__', 'node_modules', '.venv', 'venv', '.DS_Store', 'Thumbs.db', 'desktop.ini', '.idea', '.vscode']);

/**
 * Archives are assets a skill's own script unpacks (anthropics/skills ships a .tar.gz of UI
 * components), so unlike a download they may come along; what the archive is wrapped around —
 * a program — is still refused, by name here and by its first bytes below (RAR and 7z included).
 */
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst']);

export function isSkippedName(name: string): boolean {
  return SKIPPED_NAMES.has(name) || name.endsWith('.pyc');
}

export interface SkillFile {
  /** `/`-separated, inside the skill folder. */
  rel: string;
  abs: string;
  size: number;
}

export interface SkillFileScan {
  files: SkillFile[];
  bytes: number;
  issues: SkillIssue[];
}

async function isProgramFile(file: SkillFile): Promise<boolean> {
  const ext = declaredExtension(file.rel);
  if (PROGRAM_EXTENSIONS.has(ext) && !ARCHIVE_EXTENSIONS.has(ext)) return true;
  const handle = await fs.open(file.abs, 'r');
  try {
    const head = Buffer.alloc(Math.min(PROGRAM_SNIFF_BYTES, file.size));
    await handle.read(head, 0, head.length, 0);
    return looksLikeProgram(head);
  } finally {
    await handle.close();
  }
}

/**
 * Every file of a skill folder, checked against what a skill may hold: no links (a link could point
 * anywhere on this computer), no programs, at most `SKILL_MAX_FILES` files and `SKILL_MAX_BYTES`.
 * Stops walking once a limit is passed: the answer is "too big" either way.
 */
export async function scanSkillFiles(dir: string): Promise<SkillFileScan> {
  const files: SkillFile[] = [];
  const issues: SkillIssue[] = [];
  let bytes = 0;
  const walk = async (folder: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (isSkippedName(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        issues.push({ code: 'symlink', detail: rel });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const { size } = await fs.stat(abs);
        files.push({ rel, abs, size });
        bytes += size;
      }
      if (files.length > SKILL_MAX_FILES || bytes > SKILL_MAX_BYTES) return;
    }
  };
  await walk(dir, '');
  if (files.length > SKILL_MAX_FILES) issues.push({ code: 'tooManyFiles', detail: String(SKILL_MAX_FILES) });
  else if (bytes > SKILL_MAX_BYTES) issues.push({ code: 'tooLarge', detail: String(Math.round(SKILL_MAX_BYTES / 1_048_576)) });
  else {
    for (const file of files) {
      if (await isProgramFile(file)) {
        issues.push({ code: 'programFile', detail: file.rel });
        break;
      }
    }
  }
  return { files, bytes, issues };
}

export interface ReadSkill {
  parsed: ParsedSkill;
  scan: SkillFileScan;
  view: SkillSummaryView;
}

/** The SKILL.md of a folder, or null when it has none (any letter case: `skill.md` loads in Claude Code on Windows). */
export async function findSkillFile(dir: string): Promise<string | null> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const exact = names.find((name) => name === SKILL_FILE);
  const any = exact ?? names.find((name) => name.toLowerCase() === SKILL_FILE.toLowerCase());
  return any ? path.join(dir, any) : null;
}

/** Reads and checks one skill folder; `folder` is the name the fallback rules use. */
export async function readSkillFolder(dir: string, folder = path.basename(dir)): Promise<ReadSkill | null> {
  const skillFile = await findSkillFile(dir);
  if (!skillFile) return null;
  const stat = await fs.stat(skillFile);
  const scan = await scanSkillFiles(dir);
  let parsed: ParsedSkill;
  if (stat.size > SKILL_MD_MAX_BYTES) {
    parsed = { ...parseSkillMarkdown('', folder), body: '' };
    parsed.issues = [{ code: 'skillMdTooLarge', detail: String(Math.round(SKILL_MD_MAX_BYTES / 1_024)) }];
  } else {
    parsed = parseSkillMarkdown(await fs.readFile(skillFile, 'utf8'), folder);
  }
  const scripts = scan.files.map((file) => file.rel).filter((rel) => runtimeOf(rel) !== null);
  const needs = [...new Set(scripts.map((rel) => runtimeOf(rel)).filter((r): r is SkillRuntime => r !== null))];
  const view: SkillSummaryView = {
    name: parsed.name,
    description: parsed.description,
    ...(parsed.version ? { version: parsed.version } : {}),
    files: scan.files.length,
    bytes: scan.bytes,
    scripts,
    needs,
    ignoredFields: parsed.ignoredFields,
    modelInvocable: parsed.modelInvocable,
    license: parsed.license,
    compatibility: parsed.compatibility,
    issues: [...parsed.issues, ...scan.issues],
  };
  return { parsed, scan, view };
}

/**
 * Copies a checked skill into `dest` (which must not exist), skipping what `scanSkillFiles`
 * skips. Copies the scanned list, not the folder: a file added after the check does not come along.
 */
export async function copySkillFiles(scan: SkillFileScan, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const file of scan.files) {
    // Checked again here: a file swapped for a link after the scan would otherwise be followed.
    const stat = await fs.lstat(file.abs);
    if (!stat.isFile()) throw new Error(`not a regular file: ${file.rel}`);
    const target = path.join(dest, ...file.rel.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file.abs, target);
  }
}
