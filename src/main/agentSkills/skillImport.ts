import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sendLog } from '../helpers';
import { SKILL_FILE, SKILL_MD_MAX_BYTES, hasFatalIssue, skillSlug } from '../../shared/agentSkills';
import type {
  SkillImportCandidate, SkillImportResult, SkillImportSource, SkillInstallResult, SkillOrigin,
} from '../../shared/agentSkills';
import { skillStagingRoot } from './skillPaths';
import { findSkillFile, isSkippedName, readSkillFolder } from './skillFiles';
import { installSkillFiles, installedSkillDir } from './skillStore';
import { isBundledSkill } from './bundledSkills';
import {
  SkillArchiveError, downloadSkillArchive, extractSkillArchive, githubArchiveUrl, githubRefCandidates, parseGithubSkillUrl,
} from './skillArchive';
import type { guardedFetch } from '../net/ssrfGuard';

/*
 * Import is two steps with the user in between: inspect (unpack, find every skill, check each) and
 * install (the ones they ticked). Nothing reaches the skills folder before they have seen the
 * preview — the preview is the trust gate, because a skill is instructions the agent will follow.
 */

/** A repository is searched this deep for SKILL.md files (plugin layouts nest skills two levels down). */
const DISCOVERY_DEPTH = 4;
const MAX_CANDIDATES = 200;
const SESSION_TTL_MS = 30 * 60_000;

interface Session {
  id: string;
  source: string;
  staging: string | null;
  createdAt: number;
  candidates: Map<string, { dir: string; folder: string; origin?: SkillOrigin }>;
}

const sessions = new Map<string, Session>();

/** The folders other agents keep personal skills in. Read only on request; never treated as installed. */
export function otherAgentSkillDirs(home = os.homedir()): { label: string; dir: string }[] {
  return [
    { label: '~/.claude/skills', dir: path.join(home, '.claude', 'skills') },
    { label: '~/.agents/skills', dir: path.join(home, '.agents', 'skills') },
    { label: '~/.codex/skills', dir: path.join(home, '.codex', 'skills') },
    { label: '~/.gemini/skills', dir: path.join(home, '.gemini', 'skills') },
  ];
}

/** Every folder under `root` holding a SKILL.md; a skill's own subfolders are not searched. */
export async function discoverSkillDirs(root: string, depth = DISCOVERY_DEPTH): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string, level: number): Promise<void> => {
    if (found.length >= MAX_CANDIDATES) return;
    if (await findSkillFile(dir)) {
      found.push(dir);
      return;
    }
    if (level >= depth) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      // Dot folders are searched: Codex's catalog keeps its skills in skills/.curated and .system, and
      // repos ship their own inside each agent's hidden project folder.
      if (!entry.isDirectory() || isSkippedName(entry.name)) continue;
      await visit(path.join(dir, entry.name), level + 1);
    }
  };
  await visit(root, 0);
  return found;
}

function newStaging(): string {
  return path.join(skillStagingRoot(), randomBytes(8).toString('hex'));
}

function sweepSessions(): void {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (now - session.createdAt > SESSION_TTL_MS) void discardSkillImport(session.id);
  }
}

/** Where to look for the source's skills, and the staging folder to remove afterwards. */
interface Located {
  dirs: { dir: string; origin: string }[];
  staging: string | null;
  source: string;
  /** A GitHub source: the repository, the ref that downloaded, and the folder the archive was cut to. */
  github?: SkillOrigin;
}

async function singleMarkdown(text: string, fileName: string): Promise<Located> {
  const staging = newStaging();
  const folder = skillSlug(fileName.replace(/\.md$/i, '')) || 'skill';
  const dir = path.join(staging, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, SKILL_FILE), text);
  return { dirs: [{ dir, origin: '' }], staging, source: fileName };
}

async function fromArchiveFile(file: string, source: string, options: { stripTop?: boolean; within?: string } = {}): Promise<Located> {
  const staging = newStaging();
  try {
    await extractSkillArchive(file, staging, options);
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  const dirs = await discoverSkillDirs(staging);
  return { dirs: dirs.map((dir) => ({ dir, origin: path.relative(staging, dir).split(path.sep).join('/') })), staging, source };
}

async function locatePath(target: string): Promise<Located | null> {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return null;
  const source = path.basename(target);
  if (stat.isDirectory()) {
    const dirs = await discoverSkillDirs(target);
    return { dirs: dirs.map((dir) => ({ dir, origin: path.relative(target, dir).split(path.sep).join('/') })), staging: null, source };
  }
  const lower = source.toLowerCase();
  if (lower.endsWith('.zip') || lower.endsWith('.skill')) return fromArchiveFile(target, source);
  // SKILL.md picked inside its folder: the folder is the skill, scripts and all.
  if (lower === SKILL_FILE.toLowerCase()) return { dirs: [{ dir: path.dirname(target), origin: '' }], staging: null, source: path.basename(path.dirname(target)) };
  if (lower.endsWith('.md')) {
    if (stat.size > SKILL_MD_MAX_BYTES) throw new SkillArchiveError('tooLarge', `${stat.size} bytes`);
    return singleMarkdown(await fs.readFile(target, 'utf8'), source);
  }
  return { dirs: [], staging: null, source };
}

async function locateUrl(raw: string, fetchImpl?: typeof guardedFetch): Promise<Located> {
  const github = parseGithubSkillUrl(raw);
  if (github) {
    for (const { ref, dir } of githubRefCandidates(github.rest, github.file)) {
      const staging = newStaging();
      const zipFile = `${staging}.zip`;
      try {
        if (!(await downloadSkillArchive(githubArchiveUrl(github.owner, github.repo, ref), zipFile, fetchImpl))) continue;
        sendLog(`🧩 [Skills] downloaded ${github.owner}/${github.repo}@${ref}${dir ? ` (${dir})` : ''}`);
        const located = await fromArchiveFile(zipFile, raw.trim(), { stripTop: true, within: dir });
        return { ...located, github: { owner: github.owner, repo: github.repo, ref, path: dir } };
      } finally {
        await fs.rm(zipFile, { force: true }).catch(() => undefined);
      }
    }
    throw new SkillArchiveError('notFound', raw);
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SkillArchiveError('notFound', 'badUrl');
  }
  if (url.protocol !== 'https:') throw new SkillArchiveError('notFound', 'badUrl');
  const lower = url.pathname.toLowerCase();
  const file = `${newStaging()}.download`;
  try {
    if (lower.endsWith('.zip') || lower.endsWith('.skill')) {
      if (!(await downloadSkillArchive(url.toString(), file, fetchImpl))) throw new SkillArchiveError('notFound', raw);
      return await fromArchiveFile(file, url.toString());
    }
    if (lower.endsWith('.md')) {
      if (!(await downloadSkillArchive(url.toString(), file, fetchImpl))) throw new SkillArchiveError('notFound', raw);
      const { size } = await fs.stat(file);
      if (size > SKILL_MD_MAX_BYTES) throw new SkillArchiveError('tooLarge', `${size} bytes`);
      const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-2) ?? 'skill');
      const located = await singleMarkdown(await fs.readFile(file, 'utf8'), lower.endsWith(`/${SKILL_FILE.toLowerCase()}`) ? `${name}.md` : path.basename(url.pathname));
      return { ...located, source: url.toString() };
    }
  } finally {
    await fs.rm(file, { force: true }).catch(() => undefined);
  }
  throw new SkillArchiveError('notFound', 'badUrl');
}

async function locateOtherAgents(): Promise<Located> {
  const dirs: { dir: string; origin: string }[] = [];
  for (const { label, dir } of otherAgentSkillDirs()) {
    for (const found of await discoverSkillDirs(dir, 2)) {
      dirs.push({ dir: found, origin: `${label}/${path.relative(dir, found).split(path.sep).join('/')}` });
    }
  }
  return { dirs, staging: null, source: '' };
}

/** Unpacks and checks a source; the preview is what the user decides on. */
export async function inspectSkillSource(source: SkillImportSource, fetchImpl?: typeof guardedFetch): Promise<SkillImportResult> {
  sweepSessions();
  let located: Located | null;
  try {
    if (source.kind === 'path') located = await locatePath(source.path);
    else if (source.kind === 'url') located = await locateUrl(source.url, fetchImpl);
    else located = await locateOtherAgents();
  } catch (err) {
    if (err instanceof SkillArchiveError) {
      sendLog(`⚠️ [Skills] import failed (${err.reason}): ${err.message}`);
      if (err.reason === 'notFound') return { ok: false, reason: err.message === 'badUrl' ? 'badUrl' : 'notFound' };
      return { ok: false, reason: err.reason, detail: err.message };
    }
    throw err;
  }
  if (!located) return { ok: false, reason: 'notFound' };

  const session: Session = { id: randomBytes(8).toString('hex'), source: located.source, staging: located.staging, createdAt: Date.now(), candidates: new Map() };
  const candidates: SkillImportCandidate[] = [];
  for (const { dir, origin } of located.dirs) {
    const read = await readSkillFolder(dir).catch(() => null);
    const key = String(candidates.length);
    if (!read) continue;
    const github = located.github;
    const repoPath = github ? [github.path, origin].filter(Boolean).join('/') : '';
    session.candidates.set(key, { dir, folder: path.basename(dir), ...(github ? { origin: { ...github, path: repoPath } } : {}) });
    candidates.push({ ...read.view, key, origin, exists: (await installedSkillDir(read.parsed.name)) !== null });
  }
  if (candidates.length === 0) {
    if (located.staging) await fs.rm(located.staging, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, reason: 'noSkills' };
  }
  sessions.set(session.id, session);
  return { ok: true, preview: { id: session.id, source: located.source, candidates } };
}

/**
 * Installs the ticked candidates. Each is read and checked again: a local folder may have changed
 * since the preview, and what is installed must be what passed the checks just now.
 */
export async function installImportedSkills(id: string, keys: readonly string[]): Promise<SkillInstallResult> {
  const session = sessions.get(id);
  const result: SkillInstallResult = { installed: [], failed: [] };
  if (!session) return result;
  try {
    for (const key of keys) {
      const candidate = session.candidates.get(key);
      if (!candidate) continue;
      const read = await readSkillFolder(candidate.dir, candidate.folder).catch(() => null);
      if (!read) {
        result.failed.push({ name: candidate.folder, issue: { code: 'unreadable' } });
        continue;
      }
      const fatal = read.view.issues.find((issue) => hasFatalIssue([issue]));
      if (fatal) {
        result.failed.push({ name: read.parsed.name, issue: fatal });
        continue;
      }
      // One source can hold two skills of one name (openai/skills: openai-docs in .curated and .system);
      // the first ticked wins rather than the second silently replacing it.
      if (result.installed.includes(read.parsed.name)) {
        result.failed.push({ name: read.parsed.name, issue: { code: 'nameTaken', detail: read.parsed.name } });
        continue;
      }
      // A built-in skill is updated and restored only with Yobi: an import would overwrite it unarchived.
      if (await isBundledSkill(read.parsed.name)) {
        result.failed.push({ name: read.parsed.name, issue: { code: 'bundledName', detail: read.parsed.name } });
        continue;
      }
      const skillFile = await findSkillFile(candidate.dir);
      const borrowed = read.parsed.issues.some((issue) => issue.code === 'descriptionFromBody');
      try {
        await installSkillFiles(read.scan, read.parsed.name, {
          source: session.source,
          description: borrowed ? read.parsed.description : null,
          skillFile: skillFile ? path.basename(skillFile) : SKILL_FILE,
          ...(candidate.origin ? { origin: candidate.origin } : {}),
        });
        result.installed.push(read.parsed.name);
      } catch (err) {
        sendLog(`⚠️ [Skills] could not install "${read.parsed.name}": ${err instanceof Error ? err.message : String(err)}`);
        result.failed.push({ name: read.parsed.name, issue: { code: 'unreadable', detail: read.parsed.name } });
      }
    }
  } finally {
    await discardSkillImport(id);
  }
  return result;
}

export async function discardSkillImport(id: string): Promise<void> {
  const session = sessions.get(id);
  sessions.delete(id);
  if (session?.staging) await fs.rm(session.staging, { recursive: true, force: true }).catch(() => undefined);
}

/** Start-up: previews die with the app, so whatever is still unpacked is garbage. */
export async function cleanupSkillStaging(): Promise<void> {
  await fs.rm(skillStagingRoot(), { recursive: true, force: true }).catch(() => undefined);
}
