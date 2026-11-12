import { fieldFlag, fieldText, parseFrontmatter } from './skillFrontmatter';
import type { FrontmatterValue } from './skillFrontmatter';

/*
 * Agent Skills: the open SKILL.md folder format (agentskills.io) that Claude, Gemini CLI and Codex
 * all load. Read leniently, written strictly: a skill made for any of them installs here, and what
 * Yobi writes back loads in all of them.
 */

export const SKILL_FILE = 'SKILL.md';
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1_024;
/** Claude Code's cap on description + when_to_use in its listing. */
export const SKILL_TRIGGER_TEXT_MAX = 1_536;
export const SKILL_MD_MAX_BYTES = 256 * 1_024;
export const SKILL_MAX_BYTES = 30 * 1_024 * 1_024;
export const SKILL_MAX_FILES = 1_000;

/** The spec's six keys plus the two Claude Code keys Yobi acts on. Every other key is kept on disk, unused. */
const USED_FIELDS = new Set(['name', 'description', 'when_to_use', 'disable-model-invocation', 'license', 'compatibility', 'metadata']);

const NAME_RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= SKILL_NAME_MAX && NAME_RULE.test(name);
}

/** The nearest valid name: lower case, every run of other characters one hyphen. '' when nothing is left. */
export function skillSlug(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SKILL_NAME_MAX)
    .replace(/-+$/, '');
}

export type SkillIssueCode =
  | 'noFrontmatter'
  | 'yamlUnreadable'
  | 'nameFromFolder'
  | 'nameSlugged'
  | 'descriptionFromBody'
  | 'descriptionTruncated'
  | 'preprocessCommands'
  // Fatal: the skill cannot be installed.
  | 'noName'
  | 'noDescription'
  | 'skillMdTooLarge'
  | 'tooManyFiles'
  | 'tooLarge'
  | 'programFile'
  | 'symlink'
  | 'unreadable';

export const FATAL_SKILL_ISSUES: ReadonlySet<SkillIssueCode> = new Set<SkillIssueCode>([
  'noName', 'noDescription', 'skillMdTooLarge', 'tooManyFiles', 'tooLarge', 'programFile', 'symlink', 'unreadable',
]);

export interface SkillIssue {
  code: SkillIssueCode;
  /** A name, a path or a number the message shows, never prose. */
  detail?: string;
}

export interface ParsedSkill {
  name: string;
  description: string;
  /** Optional version from the Agent Skills standard's metadata map. */
  version?: string;
  /** Claude Code's extra trigger text, shown to the model after the description. */
  whenToUse: string;
  /** `disable-model-invocation`: listed only when the user names the skill. */
  modelInvocable: boolean;
  license: string;
  compatibility: string;
  /** Keys present but not acted on here (allowed-tools, hooks, model…), in file order. */
  ignoredFields: string[];
  body: string;
  issues: SkillIssue[];
}

function firstParagraph(body: string): string {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '' && !block.startsWith('#') && !block.startsWith('```'));
  return (paragraph ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Reads one SKILL.md. `folder` is the directory it sits in, the name of last resort. Never throws:
 * what is wrong is in `issues`, and a fatal one (`FATAL_SKILL_ISSUES`) means it cannot be installed.
 */
export function parseSkillMarkdown(source: string, folder: string): ParsedSkill {
  const issues: SkillIssue[] = [];
  const { fields, body, unreadable } = parseFrontmatter(source);
  const read = (key: string): FrontmatterValue | undefined => fields?.[key];
  const metadata = read('metadata');
  const version = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata.version?.trim() : '';
  if (!fields) issues.push({ code: 'noFrontmatter' });
  else if (unreadable > 0) issues.push({ code: 'yamlUnreadable', detail: String(unreadable) });

  const declared = fieldText(read('name'));
  let name = declared;
  if (!isValidSkillName(name)) {
    if (isValidSkillName(folder)) {
      name = folder;
      // No name at all is Claude Code's default (the folder name), not a problem with the file.
      if (declared) issues.push({ code: 'nameFromFolder', detail: declared });
    } else {
      name = skillSlug(declared || folder);
      if (name) issues.push({ code: 'nameSlugged', detail: declared || folder });
      else issues.push({ code: 'noName' });
    }
  }

  let description = fieldText(read('description')).replace(/\s+/g, ' ');
  if (!description) {
    description = firstParagraph(body);
    if (description) issues.push({ code: 'descriptionFromBody' });
    else issues.push({ code: 'noDescription' });
  }
  if (description.length > SKILL_DESCRIPTION_MAX) {
    description = `${description.slice(0, SKILL_DESCRIPTION_MAX - 1).trimEnd()}…`;
    issues.push({ code: 'descriptionTruncated', detail: String(SKILL_DESCRIPTION_MAX) });
  }
  // Claude Code runs these before the model sees the text. Yobi never does: it says so up front.
  if (/(^|\s)!`[^`\n]+`/m.test(body) || /^```!/m.test(body)) issues.push({ code: 'preprocessCommands' });

  return {
    name,
    description,
    ...(version ? { version } : {}),
    whenToUse: fieldText(read('when_to_use')).replace(/\s+/g, ' '),
    modelInvocable: !fieldFlag(read('disable-model-invocation')),
    license: fieldText(read('license')),
    compatibility: fieldText(read('compatibility')),
    ignoredFields: Object.keys(fields ?? {}).filter((key) => !USED_FIELDS.has(key)),
    body,
    issues,
  };
}

export function hasFatalIssue(issues: readonly SkillIssue[]): boolean {
  return issues.some((issue) => FATAL_SKILL_ISSUES.has(issue.code));
}

/** What the model is told the skill is for: the description, then Claude Code's when_to_use. */
export function skillTriggerText(skill: Pick<ParsedSkill, 'description' | 'whenToUse'>): string {
  const text = skill.whenToUse ? `${skill.description} ${skill.whenToUse}` : skill.description;
  return text.length > SKILL_TRIGGER_TEXT_MAX ? `${text.slice(0, SKILL_TRIGGER_TEXT_MAX - 1).trimEnd()}…` : text;
}

/**
 * Rewrites what only Claude Code fills in. The skill folder becomes `SKILL_DIR`, the environment
 * variable a shell call gets (an absolute path would carry the account name to a web AI), and the
 * slash-command arguments become the user's request, which the model already has.
 */
export function skillBodyForAgent(body: string): string {
  return body
    .replace(/\$\{(?:CLAUDE_SKILL_DIR|SKILL_DIR)\}|\$CLAUDE_SKILL_DIR\b/g, 'SKILL_DIR')
    .replace(/\$ARGUMENTS(?:\[\d+\])?/g, "the user's request");
}

/** Interpreters a skill's scripts need, read off their extensions. */
export type SkillRuntime = 'python' | 'node' | 'shell' | 'powershell' | 'batch';

const RUNTIME_BY_EXT: Readonly<Record<string, SkillRuntime>> = {
  py: 'python', js: 'node', mjs: 'node', cjs: 'node', ts: 'node',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', bat: 'batch', cmd: 'batch',
};

export function runtimeOf(file: string): SkillRuntime | null {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return file.includes('.') ? RUNTIME_BY_EXT[ext] ?? null : null;
}

/** What the settings list and the import preview show about one skill. */
export interface SkillSummaryView {
  name: string;
  description: string;
  version?: string;
  files: number;
  bytes: number;
  /** `/`-separated paths of the script files, for the preview. */
  scripts: string[];
  needs: SkillRuntime[];
  ignoredFields: string[];
  modelInvocable: boolean;
  license: string;
  compatibility: string;
  issues: SkillIssue[];
}

export interface AgentSkillView extends SkillSummaryView {
  enabled: boolean;
  /** Where it was imported from (a URL or a folder name), '' for one written here. */
  source: string;
  installedAt: string;
  /** The link a newer version imports from: present only once a check has seen the skill change at its source. */
  update?: string;
  bundled?: BundledSkillView;
}

export interface BundledSkillRevision {
  id: string;
  version: string;
  createdAt: string;
}

export interface BundledSkillView {
  interfaceId: string;
  installed: boolean;
  currentVersion: string;
  availableVersion: string;
  updateAvailable: boolean;
  modified: boolean;
  revisions: BundledSkillRevision[];
}

export interface BundledSkillChange {
  name: string;
  /** No revision restores the version shipped with this installation of Yobi. */
  revision?: string;
}

/** Where on GitHub an installed skill came from: what an update check compares against. */
export interface SkillOrigin {
  owner: string;
  repo: string;
  ref: string;
  /** The skill's folder in the repository, '' for its root. */
  path: string;
}

/** The address that imports just this skill again. */
export function skillOriginUrl(origin: SkillOrigin): string {
  const repo = `https://github.com/${origin.owner}/${origin.repo}`;
  if (!origin.path && origin.ref === 'HEAD') return repo;
  return `${repo}/tree/${origin.ref}${origin.path ? `/${origin.path}` : ''}`;
}

export interface SkillImportCandidate extends SkillSummaryView {
  /** Stable within one preview: what the install request names. */
  key: string;
  /** Its folder inside the source, '' for the source root. */
  origin: string;
  /** A skill of this name is installed and would be replaced. */
  exists: boolean;
}

export interface SkillImportPreview {
  id: string;
  /** What the user picked: a URL, or a file or folder name (never a full path with the account name). */
  source: string;
  candidates: SkillImportCandidate[];
}

export type SkillImportSource =
  | { kind: 'path'; path: string }
  | { kind: 'url'; url: string }
  /** Skills other agents keep on this computer (~/.claude/skills, ~/.agents/skills…). */
  | { kind: 'agents' };

export type SkillImportFailure = 'notFound' | 'noSkills' | 'badUrl' | 'download' | 'tooLarge' | 'badArchive';

export type SkillImportResult = { ok: true; preview: SkillImportPreview } | { ok: false; reason: SkillImportFailure; detail?: string };

export interface SkillInstallResult {
  installed: string[];
  failed: { name: string; issue: SkillIssue | { code: 'nameTaken' | 'bundledName'; detail?: string } }[];
}

/** `bundledName`: the name belongs to a Yobi built-in skill; `bundledRename`: a built-in skill keeps its name. */
export type SkillSaveResult = {
  ok: true; name: string;
} | { ok: false; issue: SkillIssue | { code: 'nameTaken' | 'notFound' | 'badFile' | 'bundledName' | 'bundledRename'; detail?: string } };

/**
 * The SKILL.md text with `name:` set to the folder name it is installed under, and `description:`
 * written when the file had to borrow one from its body. Every other line stays as it was, so a
 * Claude Code key or a comment survives; the result loads in every tool that reads the spec.
 */
export function withSkillIdentity(source: string, name: string, description: string | null): string {
  const text = source.replace(/^﻿/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const end = lines[0]?.trim() === '---' ? lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line)) : -1;
  const describe = (value: string) => `description: ${JSON.stringify(value.replace(/\s+/g, ' ').trim())}`;
  if (end < 0) {
    return ['---', `name: ${name}`, describe(description ?? ''), '---', '', text].join(eol);
  }
  const head = lines.slice(1, end);
  // Replaces a key's line and the indented lines that continued its old value.
  const replaceKey = (key: string, line: string, insertAt: number): void => {
    const at = head.findIndex((entry) => new RegExp(`^${key}\\s*:`).test(entry));
    if (at < 0) {
      head.splice(insertAt, 0, line);
      return;
    }
    let next = at + 1;
    while (next < head.length && /^\s+\S/.test(head[next])) next += 1;
    head.splice(at, next - at, line);
  };
  replaceKey('name', `name: ${name}`, 0);
  if (description !== null) replaceKey('description', describe(description), 1);
  return [lines[0], ...head, ...lines.slice(end)].join(eol);
}

/** What "new skill" starts from: valid as it stands, so saving it unchanged works. */
export function skillTemplate(name: string, description: string, heading: string, instructions: string): string {
  const safeDescription = description.replace(/\s+/g, ' ').trim();
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(safeDescription)}`,
    '---',
    '',
    `# ${heading}`,
    '',
    instructions,
    '',
  ].join('\n');
}
