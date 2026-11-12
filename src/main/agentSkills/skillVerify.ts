import { builtinModules } from 'node:module';
import { SKILL_FILE, hasFatalIssue, parseSkillMarkdown } from '../../shared/agentSkills';
import { scriptCommandLine } from '../../shared/skillAuthoring';
import type {
  ScriptRunResult, SkillCheckCode, SkillCheckIssue, SkillTextFiles, SkillVerifyReport,
} from '../../shared/skillAuthoring';
import { parseScriptArgs } from '../flow/agent/agentSkillScript';
import { isSandboxScript, runSandboxedScript } from './skillSandbox';

/*
 * The checks a skill gets on this computer, with no model call: its files hang together, nothing
 * is listed as "and so on", no script imports a package, and each script runs once with the
 * example its SKILL.md gives, so the user reads what it really prints. The strict rules apply only
 * to files the AI wrote this time; an imported skill's own Python script or long reference is not
 * an error. Model-written tests would share the model's wrong facts and catch none of them.
 */

/** What an AI draft may write. */
export const AUTHORED_FILE = /^(SKILL\.md|scripts\/[^/\\]+\.mjs|references\/[^/\\]+\.md)$/;
const MAX_SCRIPTS = 3;
const MAX_REFERENCES = 3;
const AUTHORED_FILE_MAX_CHARS = 60_000;
/** Output kept per run for the editor and the fix prompt. */
const KEPT_OUTPUT = 2_000;

/** Phrases that stand for a list the draft did not write out. "等等" is common prose, so only warned. */
const INCOMPLETE_ERROR = /(依此類推|以此類推|依次類推|依此类推|以此类推|\band so on\b|\betc\b\.?|…|\.\.\.(?![\w$({[]))/i;
const INCOMPLETE_WARNING = /等等/;
const SCRIPT_COMMENT_INCOMPLETE = /(依此類推|以此類推|依次類推|依此类推|以此类推|\band so on\b|\betc\b\.?)/i;
/** One of those phrases in quotes is named, not used: a skill that says never to write 「依此類推」. */
const NAMED_PHRASE = /[「『“"'‘](?:依此類推|以此類推|依次類推|依此类推|以此类推|等等|and so on|etc\.?|…|\.\.\.)[」』”"'’]/gi;
const FILE_MENTION = /\b(?:scripts|references|assets|evals)\/[A-Za-z0-9._/-]+[A-Za-z0-9_]/g;
// Indented too: a code block under a list item ("2. Run:\n   ```bash").
const CODE_FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;

function issue(level: SkillCheckIssue['level'], code: SkillCheckCode, file?: string, detail?: string, line?: number): SkillCheckIssue {
  return { level, code, ...(file ? { file } : {}), ...(detail ? { detail } : {}), ...(line ? { line } : {}) };
}

function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Markdown prose without code or named phrases, blanked so every match stays on its line: a spread
 * `...args` in a code block is not a missing list.
 */
function proseOf(markdown: string): string {
  return markdown.replace(CODE_FENCE, blank).replace(/`[^`\n]*`/g, blank).replace(NAMED_PHRASE, blank);
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

interface ScriptComment {
  text: string;
  /** Where the text starts in the source. */
  at: number;
}

/** A script split into its comments and the rest. */
function splitScript(source: string): { code: string; comments: ScriptComment[] } {
  const comments: ScriptComment[] = [];
  const code: string[] = [];
  let from = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && (next === '/' || next === '*')) {
      code.push(source.slice(from, i));
      const end = next === '/' ? source.indexOf('\n', i) : source.indexOf('*/', i + 2);
      comments.push({ text: source.slice(i + 2, end < 0 ? source.length : end), at: i + 2 });
      i = end < 0 ? source.length : next === '/' ? end : end + 2;
      from = i;
    } else if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  code.push(source.slice(from));
  return { code: code.join('\n'), comments };
}

/** The first "and so on" in a script's comments, with its line. */
function cutListInComments(source: string): { phrase: string; line: number } | null {
  for (const comment of splitScript(source).comments) {
    const hit = SCRIPT_COMMENT_INCOMPLETE.exec(comment.text);
    if (hit) return { phrase: hit[0], line: lineAt(source, comment.at + hit.index) };
  }
  return null;
}

// A statement-level import/export … from, a bare import, import(), require(): "from 'x'" inside a message is not one.
const IMPORTED = /(?:(?:^|[;}])\s*(?:import|export)\b[^;'"`]*?\bfrom\s*|(?:^|[;}])\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/gm;
const BUILTIN = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

/**
 * Packages a script imports. A skill has no node_modules and nothing installs one: only Node's
 * built-in modules and the skill's own files load (seen: a draft importing "typescript").
 */
export function packageImports(source: string): string[] {
  const found = new Set<string>();
  for (const match of splitScript(source).code.matchAll(IMPORTED)) {
    const spec = match[2].trim();
    if (/^(\.{1,2}\/|\/|node:|data:|file:)/.test(spec)) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (!BUILTIN.has(spec) && !BUILTIN.has(name)) found.add(name);
  }
  return [...found];
}

function mentionedFiles(markdown: string): string[] {
  return [...new Set((markdown.match(FILE_MENTION) ?? []).map((rel) => rel.replace(/[.,;:)]+$/, '')))];
}

function sandboxScripts(files: SkillTextFiles): string[] {
  return Object.keys(files).filter((rel) => rel.startsWith('scripts/') && isSandboxScript(rel));
}

/** Where a SKILL.md shows commands: the lines of its code blocks, then its inline code. */
function commandCandidates(markdown: string): string[] {
  const lines = [...markdown.matchAll(CODE_FENCE)].flatMap((match) => match[2].split('\n'));
  const inline = [...markdown.replace(CODE_FENCE, '').matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
  return [...lines, ...inline];
}

/** A word standing for a value rather than being one: `<count>`, `{name}`, `[--seed N]`, `...`. */
const PLACEHOLDER = /<[^<>]+>|\{[A-Za-z_][\w-]*\}|^\[|\]$|^\.{3}$|^…$/;
/** Where the command for the script ends: a pipe, a redirection, the next command, a comment. */
const COMMAND_END = /^(\||\|\||&&|;|&|>|>>|<|2>|2>&1|&>|#.*)$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The arguments of the first command in `candidates` that runs `script` with real values; null when
 * none does. A command starts with `node`: a bare `scripts/x.mjs` in the text names the script.
 */
function exampleArgs(candidates: readonly string[], script: string): string[] | null {
  // After the start, a space, a quote, `=` or a folder: `node scripts/x.mjs`, `"$SKILL_DIR/scripts/x.mjs"`.
  const at = new RegExp(`(?:^|[\\s"'/=])${escapeRegExp(script)}(?=$|[\\s"'])`);
  for (const candidate of candidates) {
    const match = at.exec(candidate);
    if (!match || !/\bnode(?:\.exe)?\s/i.test(candidate.slice(0, match.index + 1))) continue;
    const rest = candidate.slice(match.index + match[0].length).replace(/^["']/, '');
    const words = parseScriptArgs(rest);
    const end = words.findIndex((word) => COMMAND_END.test(word));
    const args = end < 0 ? words : words.slice(0, end);
    if (!args.some((arg) => PLACEHOLDER.test(arg))) return args;
  }
  return null;
}

export interface ScriptExample {
  script: string;
  args: string[];
}

/**
 * The example run SKILL.md gives for each JavaScript script: the first command in a code block
 * (else in inline code) that names the script with real values. A script with no such command has
 * no example and is not run.
 */
export function scriptExamples(files: SkillTextFiles): ScriptExample[] {
  const doc = files[SKILL_FILE];
  if (doc === undefined) return [];
  const candidates = commandCandidates(doc);
  return sandboxScripts(files).flatMap((script) => {
    const args = exampleArgs(candidates, script);
    return args ? [{ script, args }] : [];
  });
}

function lintAuthored(files: SkillTextFiles, authored: ReadonlySet<string>): SkillCheckIssue[] {
  const issues: SkillCheckIssue[] = [];
  for (const rel of authored) {
    if (!AUTHORED_FILE.test(rel)) issues.push(issue('error', 'fileNotAllowed', rel));
    else if ((files[rel] ?? '').length > AUTHORED_FILE_MAX_CHARS) issues.push(issue('error', 'fileTooLarge', rel, String(AUTHORED_FILE_MAX_CHARS)));
  }
  const scripts = Object.keys(files).filter((rel) => /^scripts\/[^/]+\.mjs$/.test(rel));
  const references = Object.keys(files).filter((rel) => /^references\/[^/]+\.md$/.test(rel));
  if (scripts.length > MAX_SCRIPTS) issues.push(issue('error', 'tooManyFiles', 'scripts/', String(MAX_SCRIPTS)));
  if (references.length > MAX_REFERENCES) issues.push(issue('error', 'tooManyFiles', 'references/', String(MAX_REFERENCES)));
  for (const rel of authored) {
    const text = files[rel];
    if (text === undefined) continue;
    if (rel.endsWith('.md')) {
      const prose = proseOf(text);
      const hit = INCOMPLETE_ERROR.exec(prose) ?? INCOMPLETE_WARNING.exec(prose);
      if (hit) issues.push(issue(hit[0] === '等等' ? 'warning' : 'error', 'incompleteEnumeration', rel, hit[0], lineAt(prose, hit.index)));
    } else if (isSandboxScript(rel)) {
      const cut = cutListInComments(text);
      if (cut) issues.push(issue('error', 'incompleteEnumeration', rel, cut.phrase, cut.line));
      const packages = packageImports(text);
      if (packages.length > 0) issues.push(issue('error', 'packageImport', rel, packages.join(', ')));
    }
  }
  return issues;
}

/**
 * Whether the files make a usable skill. `authored` is what the AI wrote this time (empty for a
 * check of a skill as it is); `others` are files of the skill the editor does not hold.
 */
export function lintSkill(files: SkillTextFiles, opts: { authored: ReadonlySet<string>; others: readonly string[] }): SkillCheckIssue[] {
  const issues: SkillCheckIssue[] = [];
  const known = new Set([...Object.keys(files), ...opts.others]);
  const doc = files[SKILL_FILE];
  if (doc === undefined) return [issue('error', 'missingFile', SKILL_FILE)];
  const fatal = parseSkillMarkdown(doc, 'skill').issues.find((entry) => hasFatalIssue([entry]));
  if (fatal) issues.push(issue('error', 'skillMd', SKILL_FILE, fatal.code));
  const mentioned = mentionedFiles(doc);
  for (const rel of mentioned) {
    if (!known.has(rel)) issues.push(issue('error', 'missingFile', SKILL_FILE, rel));
  }
  const examples = new Set(scriptExamples(files).map((example) => example.script));
  for (const rel of sandboxScripts(files)) {
    if (!opts.authored.has(rel)) continue;
    if (!mentioned.includes(rel)) issues.push(issue('error', 'unreferencedScript', rel));
    else if (!examples.has(rel)) issues.push(issue('warning', 'noExample', rel));
  }
  issues.push(...lintAuthored(files, opts.authored));
  return issues;
}

function keep(text: string): string {
  return text.length > KEPT_OUTPUT ? `${text.slice(0, KEPT_OUTPUT)}…` : text;
}

export interface ExampleRunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** After each run: how many have run and how many of those failed. */
  onRun?: (done: number, failed: number) => void;
}

/** Each example, one after the other, in the sandbox the agent's runs use: a pass is exit code 0. */
export async function runScriptExamples(skillDir: string, examples: readonly ScriptExample[], opts: ExampleRunOptions = {}): Promise<ScriptRunResult[]> {
  const results: ScriptRunResult[] = [];
  let failed = 0;
  for (const example of examples) {
    if (opts.signal?.aborted) break;
    const run = await runSandboxedScript({ skillDir, script: example.script, args: example.args, signal: opts.signal, timeoutMs: opts.timeoutMs });
    const ok = !run.refused && !run.timedOut && run.exitCode === 0;
    results.push({ ...example, ok, exitCode: run.exitCode, timedOut: run.timedOut, stdout: keep(run.stdout), stderr: keep(run.stderr) });
    if (!ok) failed += 1;
    opts.onRun?.(results.length, failed);
  }
  return results;
}

const ISSUE_TEXT: Record<SkillCheckCode, string> = {
  fileNotAllowed: 'this file is not allowed: write only SKILL.md, scripts/*.mjs and references/*.md',
  tooManyFiles: 'too many files here',
  fileTooLarge: 'the file is too long',
  missingFile: 'refers to a file the skill does not have',
  unreferencedScript: 'SKILL.md never says when to run this script',
  noExample: 'SKILL.md shows no example run of this script with real values: add one on its own line in a code block',
  incompleteEnumeration: 'a list, table or mapping is cut short: write every entry out',
  packageImport: 'imports a package, and a skill has none installed: use only the built-in node: modules and the skill\'s own files',
  skillMd: 'SKILL.md is not a valid skill',
};

/** What the checks found, in English, for a revise that fixes it: errors, missing examples and failed runs. */
export function problemsForModel(report: SkillVerifyReport): string[] {
  const lines = report.issues
    .filter((entry) => entry.level === 'error' || entry.code === 'noExample')
    .map((entry) => `${entry.file ? `${entry.file}${entry.line ? ` line ${entry.line}` : ''}: ` : ''}${ISSUE_TEXT[entry.code]}${entry.detail ? ` (${entry.detail})` : ''}`);
  for (const run of report.runs) {
    if (run.ok) continue;
    const ended = run.timedOut ? 'ran past the time limit' : `ended with exit code ${run.exitCode ?? 'none'}`;
    const output = [run.stderr && `stderr: ${run.stderr.slice(0, 400)}`, run.stdout && `stdout: ${run.stdout.slice(0, 400)}`].filter(Boolean).join('; ');
    lines.push(`the example \`${scriptCommandLine(run.script, run.args)}\` in SKILL.md ${ended}${output ? `; ${output}` : ''}`);
  }
  return lines;
}
