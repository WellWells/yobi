import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SKILL_FILE, parseSkillMarkdown, skillBodyForAgent } from '../../../shared/agentSkills';
import { installedSkillDir } from '../../agentSkills/skillStore';
import type { AgentSkillEntry } from '../../agentSkills/skillStore';
import { scanSkillFiles } from '../../agentSkills/skillFiles';
import type { SkillFile } from '../../agentSkills/skillFiles';
import { isSandboxScript } from '../../agentSkills/skillSandbox';
import { parseScriptArgs, runSkillScript, splitRunLine } from './agentSkillScript';

/*
 * Agent Skills in a run, the progressive disclosure the format is built for: the catalog names
 * each enabled skill and when to use it; `use_skill` loads one's instructions and file list, reads
 * its files, and runs its JavaScript in the sandbox ("run", agentSkillScript.ts); `shell` with
 * "skill" runs its other scripts with SKILL_DIR set, the user confirming (see agentCall.ts).
 */

export const USE_SKILL_TOOL = 'use_skill';

export const USE_SKILL_LINE = `- "${USE_SKILL_TOOL}": Load an installed skill (see SKILLS) before a task it covers, then follow its instructions. config keys: "skill" (its name; REQUIRED); "file" (once it is loaded: a path from the file list it returned); "page" (a later page of a long text); "run" (a .mjs or .js script of the skill to run now) with "args" (its arguments, as on a command line) and "stdin" (optional input) → returns: the instructions and the skill's file list, that file, or what the script printed.`;

/** One page of a skill's text: a browser provider's delta observation holds 24,000. */
export const SKILL_PAGE_CHARS = 12_000;
const LISTED_FILES_MAX = 60;
const DESCRIPTION_FLOOR = 60;
/** The section on a capped page: what a browser provider can spare from the connectors' room. */
export const SKILLS_CATALOG_BUDGET = 3_000;
export const SKILLS_CATALOG_BUDGET_BYOK = 8_000;

const SKILLS_HEADING = `SKILLS (instructions the user installed for kinds of task; when the request fits one, call "${USE_SKILL_TOOL}" with its name before anything else and follow it):`;

/** The run's skills: what was offered, and which were loaded (the last is SKILL_DIR's default). */
export interface SkillRunState {
  entries: readonly AgentSkillEntry[];
  loaded: string[];
  /** Whether this run may call `shell`: decides how the instructions say to run a script. */
  shell: boolean;
  /** A folder for a skill that is not installed: the draft a test run loads. */
  dirOf?: (name: string) => string | null;
  /**
   * Tools this run can call that the catalog leaves out because a skill names them (`movie_info`),
   * by name, with their full line. A skill whose instructions name one gets that line with them.
   */
  namedTools?: Readonly<Record<string, string>>;
}

/**
 * The lines of the uncatalogued tools the instructions name in backticks. Without them the model
 * reads "call `movie_info`" next to a catalog that lacks it, takes it as not offered and goes to
 * research instead.
 */
function namedToolLines(body: string, tools: Readonly<Record<string, string>> | undefined): string[] {
  if (!tools) return [];
  const lines = Object.entries(tools).filter(([name]) => body.includes(`\`${name}\``)).map(([, line]) => line);
  return lines.length ? ['', 'TOOLS THESE INSTRUCTIONS NAME (offered in this run though not in the catalog; call them with call_tool like any other):', ...lines] : [];
}

function skillDir(run: SkillRunState, name: string): Promise<string | null> {
  const draft = run.dirOf?.(name);
  return draft ? Promise.resolve(draft) : installedSkillDir(name);
}

/** Whether the user's words name the skill: `$name`, `/name`, or the name as a whole word. */
function named(goal: string, name: string): boolean {
  const escaped = name.replace(/[-]/g, '\\-');
  return new RegExp(`(^|[^a-z0-9-])[$/]?${escaped}($|[^a-z0-9-])`, 'i').test(goal);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * The skills a run is offered, in the order listed. A skill the user's words name goes first — a
 * hint, never a filter — and one marked `disable-model-invocation` is offered only then.
 */
export function offeredSkills(entries: readonly AgentSkillEntry[], goal: string): AgentSkillEntry[] {
  return entries
    .filter((entry) => entry.modelInvocable || named(goal, entry.name))
    .map((entry, index) => ({ entry, index, first: named(goal, entry.name) }))
    .sort((a, b) => Number(b.first) - Number(a.first) || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * The SKILLS section, or '' when nothing is offered (the prompt is then unchanged). Descriptions
 * share the budget evenly; whatever still does not fit is listed by name only, so every offered
 * skill stays reachable through `use_skill`.
 */
export function renderSkillCatalog(listed: readonly AgentSkillEntry[], budget: number): string {
  if (listed.length === 0) return '';
  const room = budget - SKILLS_HEADING.length - 1;
  const share = Math.floor(room / listed.length);
  const lines: string[] = [];
  let used = 0;
  let cut = listed.length;
  for (const [index, entry] of listed.entries()) {
    const allowance = Math.max(DESCRIPTION_FLOOR, share - entry.name.length - 5);
    const line = `- ${entry.name}: ${clip(entry.trigger, allowance)}`;
    if (used + line.length + 1 > room) {
      cut = index;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (cut < listed.length) {
    lines.push(`- Also installed: ${listed.slice(cut).map((entry) => entry.name).join(', ')}`);
  }
  return [SKILLS_HEADING, ...lines].join('\n');
}

/** A name as the model wrote it, matched to an offered skill: exactly, then ignoring case, `$`/`/` and spacing. */
/**
 * The skills a resumed run had already loaded, in the order `runUseSkill` keeps (the last is
 * SKILL_DIR's default). Without them a run resumed after a question forgot its skill: research
 * answered for it, and a shell call without "skill" lost SKILL_DIR.
 */
export function skillsLoadedBefore(
  entries: readonly AgentSkillEntry[],
  records: readonly { tool: string; config: Record<string, string>; status: 'ok' | 'error' }[],
): string[] {
  const loaded: string[] = [];
  for (const record of records) {
    if (record.tool !== USE_SKILL_TOOL || record.status !== 'ok') continue;
    const name = findOffered(entries, record.config.skill ?? '')?.name;
    if (!name) continue;
    const at = loaded.indexOf(name);
    if (at >= 0) loaded.splice(at, 1);
    loaded.push(name);
  }
  return loaded;
}

function findOffered(entries: readonly AgentSkillEntry[], raw: string): AgentSkillEntry | null {
  const wanted = raw.trim();
  const exact = entries.find((entry) => entry.name === wanted);
  if (exact) return exact;
  const loose = wanted.normalize('NFKC').toLowerCase().replace(/^[$/]+/, '').replace(/[\s_]+/g, '-');
  return entries.find((entry) => entry.name === loose) ?? null;
}

function pageOf(text: string, rawPage: string | undefined): { slice: string; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(text.length / SKILL_PAGE_CHARS));
  const asked = Number.parseInt(rawPage ?? '1', 10);
  const page = Number.isFinite(asked) ? Math.min(Math.max(1, asked), pages) : 1;
  return { slice: text.slice((page - 1) * SKILL_PAGE_CHARS, page * SKILL_PAGE_CHARS), page, pages };
}

function pageNote(page: number, pages: number): string {
  return pages > 1 ? `\n[page ${page} of ${pages}${page < pages ? `; call ${USE_SKILL_TOOL} again with "page": "${page + 1}" for more` : ''}]` : '';
}

function sizeLabel(bytes: number): string {
  return bytes < 1_024 ? `${bytes} B` : `${Math.round(bytes / 1_024)} KB`;
}

const OTHER_SCRIPT = /\.(py|ts|sh|bash|ps1|bat|cmd)$/i;

/** How the loaded skill's scripts run in this run: JavaScript here and now, the rest through `shell`. */
function scriptHowTo(name: string, files: readonly SkillFile[], shell: boolean): string[] {
  const lines: string[] = [];
  if (files.some((file) => isSandboxScript(file.rel))) {
    lines.push(`RUNNING ITS JAVASCRIPT (.mjs, .js): call "${USE_SKILL_TOOL}" with "skill": "${name}", "run": the script's path and "args": its arguments as on a command line ("stdin" for long input) — what the instructions write as node scripts/x.mjs --flag value. It runs at once on this computer, without the network, file writes or other programs, and sees only the skill's own files. Use what it prints exactly as printed: never compute or change those values yourself.`);
  }
  if (!files.some((file) => OTHER_SCRIPT.test(file.rel))) return lines;
  if (!shell) {
    lines.push('RUNNING ITS OTHER SCRIPTS: this run cannot run commands. Do what the instructions ask with your other tools, or tell the user that step needs a run on their computer.');
    return lines;
  }
  const syntax = process.platform === 'win32'
    ? 'cmd: python "%SKILL_DIR%\\scripts\\x.py"; PowerShell: python "$env:SKILL_DIR\\scripts\\x.py"'
    : 'python3 "$SKILL_DIR/scripts/x.py"';
  lines.push([
    `RUNNING ITS OTHER SCRIPTS: call "shell" with "skill": "${name}". The command starts in your output folder (where file_read and file_write paths point), so input and output files go there; the skill's folder is the SKILL_DIR environment variable, so a script path the instructions give as scripts/x.py (or SKILL_DIR/scripts/x.py) becomes ${syntax}.`,
    'A script needs its interpreter and packages on this computer; when a command fails for want of one, say which and ask the user before installing anything.',
  ].join(' '));
  return lines;
}

/** A path the model wrote, matched to a file of the skill: exactly, then ignoring case (skills say REFERENCE.md for reference.md). */
function findFile(files: readonly SkillFile[], raw: string): SkillFile | null {
  // The model may copy the folder variable in any shell's spelling: SKILL_DIR/, %SKILL_DIR%/, $env:SKILL_DIR/, ${CLAUDE_SKILL_DIR}/.
  const rel = raw.trim().replace(/\\/g, '/').replace(/^(\.\/|%?SKILL_DIR%?\/|\$(env:)?\{?\w*SKILL_DIR\}?\/)+/i, '').replace(/^\/+/, '');
  if (!rel || rel.split('/').includes('..')) return null;
  return files.find((file) => file.rel === rel) ?? files.find((file) => file.rel.toLowerCase() === rel.toLowerCase()) ?? null;
}

async function isBinary(file: SkillFile): Promise<boolean> {
  const handle = await fs.open(file.abs, 'r');
  try {
    const head = Buffer.alloc(Math.min(8_192, file.size));
    await handle.read(head, 0, head.length, 0);
    return head.includes(0);
  } finally {
    await handle.close();
  }
}

export interface SkillToolOutcome {
  observation: string;
  status: 'ok' | 'error';
}

export async function runUseSkill(config: Record<string, string>, run: SkillRunState, signal?: AbortSignal): Promise<SkillToolOutcome> {
  const raw = (config.skill ?? '').trim();
  if (!raw) return { observation: 'ERROR: "skill" is required: the name of one of the SKILLS.', status: 'error' };
  const entry = findOffered(run.entries, raw);
  const names = run.entries.map((offered) => offered.name).join(', ');
  if (!entry) return { observation: `ERROR: no installed skill is called "${raw}". Installed: ${clip(names, 1_200) || 'none'}.`, status: 'error' };
  const dir = await skillDir(run, entry.name);
  if (!dir) return { observation: `ERROR: the skill "${entry.name}" was removed while this run was going. Do the task without it.`, status: 'error' };
  const { files } = await scanSkillFiles(dir);
  const wasLoaded = run.loaded.includes(entry.name);
  if (!wasLoaded) run.loaded.push(entry.name);
  else run.loaded.push(run.loaded.splice(run.loaded.indexOf(entry.name), 1)[0]);

  const runLine = (config.run ?? '').trim();
  if (runLine) {
    const { script, args } = splitRunLine(runLine);
    const target = findFile(files, script);
    if (!target) {
      const scripts = files.map((f) => f.rel).filter((rel) => isSandboxScript(rel) || OTHER_SCRIPT.test(rel));
      return { observation: `ERROR: "${script}" is not a script of the skill "${entry.name}". Its scripts: ${clip(scripts.join(', '), 1_200) || 'none'}.`, status: 'error' };
    }
    return runSkillScript({
      skill: entry.name,
      dir,
      script: target.rel,
      args: [...args, ...parseScriptArgs(config.args)],
      ...(config.stdin ? { stdin: config.stdin } : {}),
      shell: run.shell,
      signal,
    });
  }

  const wantedFile = (config.file ?? '').trim();
  const asksForFile = wantedFile !== '' && !/^SKILL\.md$/i.test(wantedFile.replace(/^\.\//, ''));
  const file = asksForFile ? findFile(files, wantedFile) : null;
  // A file guessed before the skill was ever read gets the instructions and the real file list, not a refusal: saves a turn.
  const missedFile = asksForFile && !file && !wasLoaded;
  if (asksForFile && !file && wasLoaded) {
    const listing = files.map((f) => f.rel).filter((rel) => rel !== SKILL_FILE);
    return { observation: `ERROR: "${wantedFile}" is not a file of the skill "${entry.name}". Its files: ${clip(listing.join(', '), 1_200) || 'none besides its instructions'}.`, status: 'error' };
  }
  if (file) {
    if (await isBinary(file)) {
      return { observation: `${file.rel} (${sizeLabel(file.size)}) is not text. A script can use it as SKILL_DIR/${file.rel} (see RUNNING ITS SCRIPTS in the skill's instructions).`, status: 'ok' };
    }
    const { slice, page, pages } = pageOf(await fs.readFile(file.abs, 'utf8'), config.page);
    return { observation: `FILE ${file.rel} OF SKILL "${entry.name}":\n${skillBodyForAgent(slice)}${pageNote(page, pages)}`, status: 'ok' };
  }

  const parsed = parseSkillMarkdown(await fs.readFile(path.join(dir, SKILL_FILE), 'utf8'), entry.name);
  const { slice, page, pages } = pageOf(skillBodyForAgent(parsed.body), missedFile ? undefined : config.page);
  if (page > 1) return { observation: `SKILL "${entry.name}" (continued):\n${slice}${pageNote(page, pages)}`, status: 'ok' };
  const others = files.filter((file) => file.rel !== SKILL_FILE);
  const listed = others.slice(0, LISTED_FILES_MAX).map((file) => `- ${file.rel} (${sizeLabel(file.size)})`);
  if (others.length > LISTED_FILES_MAX) listed.push(`- …and ${others.length - LISTED_FILES_MAX} more`);
  const howTo = scriptHowTo(entry.name, others, run.shell);
  return {
    observation: [
      ...(missedFile ? [`NOTE: "${wantedFile}" is not a file of this skill, so here are its instructions; pick files from FILES IN THIS SKILL below.`] : []),
      `SKILL "${entry.name}" — follow these instructions for this task:`,
      `${slice}${pageNote(page, pages)}`,
      ...namedToolLines(parsed.body, run.namedTools),
      ...(listed.length > 0 ? ['', `FILES IN THIS SKILL (read one with ${USE_SKILL_TOOL} and "file"; "SKILL_DIR" in the text above means this skill's folder):`, ...listed] : []),
      ...(howTo.length > 0 ? ['', ...howTo] : []),
    ].join('\n'),
    status: 'ok',
  };
}

/** The folder SKILL_DIR points at for a shell call: the named skill, else the one loaded last; null when neither. */
export async function skillDirForShell(run: SkillRunState | undefined, raw: string | undefined): Promise<{ name: string; dir: string } | { error: string } | null> {
  const wanted = (raw ?? '').trim();
  if (!run) return wanted ? { error: `no skills are installed, so "skill": "${wanted}" cannot be used.` } : null;
  const name = wanted ? findOffered(run.entries, wanted)?.name : run.loaded.at(-1);
  if (wanted && !name) return { error: `no installed skill is called "${wanted}". Installed: ${clip(run.entries.map((e) => e.name).join(', '), 600) || 'none'}.` };
  if (!name) return null;
  const dir = await skillDir(run, name);
  return dir ? { name, dir } : { error: `the skill "${name}" was removed while this run was going.` };
}
