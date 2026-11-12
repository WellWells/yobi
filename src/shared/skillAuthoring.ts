import { SKILL_DESCRIPTION_MAX, isValidSkillName, skillSlug } from './agentSkills';

/** What the user types to the drafting model: a description of the skill, or a change to make. */
export const SKILL_DRAFT_REQUEST_MAX = 4_000;
/** How much of a conversation a "save as skill" draft reads. */
export const SKILL_DRAFT_CONVERSATION_MAX = 14_000;
/** A description the drafting model writes: shorter than the spec's cap, since every run pays for it. */
export const SKILL_DRAFT_DESCRIPTION_MAX = 600;

/** Model calls one draft may spend in all: the first, one after the user answers, and one rewrite of an unreadable reply. */
export const DRAFT_CALL_BUDGET = 3;

/** The first round's questions, sent back with the user's answers. */
export interface SkillDraftPrior {
  questions: string[];
  answers: string[];
  /** Calls the draft has already spent. */
  calls: number;
  /** "Write it with your assumptions" instead of answering. */
  useAssumptions: boolean;
}

/**
 * Where a draft starts. `describe` is a new skill from the user's words, `conversation` a new skill
 * from a conversation the user had (the "save as skill" item), `revise` a change to the files open
 * in the editor (`name`: the installed skill they belong to, if any; `fixProblems`: the request is
 * "fix what the checks found", which main checks again itself, with the strict rules on `authored`,
 * the files AI wrote in this editor). Nothing here is saved: the result goes back into the editor.
 */
export type SkillDraftRequest = (
  | { mode: 'describe'; request: string; providerUrl?: string; prior?: SkillDraftPrior }
  | { mode: 'conversation'; conversationPath: string; request?: string; providerUrl?: string; prior?: SkillDraftPrior }
  | {
    mode: 'revise'; files: SkillTextFiles; others?: SkillOtherFile[]; name?: string; request: string; fixProblems?: boolean;
    authored?: string[]; providerUrl?: string; prior?: SkillDraftPrior;
  }
) & {
  /** The page's name for this draft: its progress comes back under it. */
  draftId?: string;
};

export type SkillDraftFailure = 'cancelled' | 'failed' | 'invalid';

/** What a model call in a draft is for: the first one by where the draft started, then a rewrite of an unreadable reply. */
export type SkillDraftCallPurpose = 'write' | 'conversation' | 'revise' | 'answers' | 'reformat';

/**
 * One step of a draft as it happens, so the editor can say what it is waiting for: a model call
 * (`call` counts the whole draft, the round before the answers included), a reply with no files,
 * the structure check (`runs`: scripts about to run their example) and each example run.
 */
export type SkillDraftStep =
  | { kind: 'model'; purpose: SkillDraftCallPurpose; call: number; budget: number }
  | { kind: 'unusable' }
  | { kind: 'lint'; errors: number; runs: number }
  | { kind: 'run'; done: number; total: number; failed: number };

/** The local checks' part of a draft's progress. */
export type SkillCheckStep = Extract<SkillDraftStep, { kind: 'lint' | 'run' }>;

export interface SkillDraftProgress {
  draftId: string;
  step: SkillDraftStep;
}

export type SkillDraftResult =
  | { ok: true; kind: 'questions'; questions: string[]; calls: number }
  | {
    ok: true;
    kind: 'files';
    name: string;
    files: SkillTextFiles;
    /** The files this draft wrote or changed. */
    changed: string[];
    report: SkillVerifyReport;
    calls: number;
  }
  | { ok: false; reason: SkillDraftFailure; error?: string };

/** Checks of the files in the editor, on this computer: no model call. */
export interface SkillTestRequest {
  files: SkillTextFiles;
  others?: SkillOtherFile[];
  /** The installed skill the files belong to: its other files are staged with them. */
  name?: string;
  /**
   * The files AI wrote in this editor: the strict rules (complete lists, an example run per script)
   * apply to them, as in the check that came with the draft. Another skill's files are not held to them.
   */
  authored?: string[];
}

export type SkillTestResult = { ok: true; report: SkillVerifyReport } | { ok: false; reason: 'invalid' | 'cancelled' };

/** "Try it": one request run by the agent on the picked model, the editor's files standing in for the skill. */
export interface SkillTryRequest {
  files: SkillTextFiles;
  request: string;
  /** The installed skill the editor has open: the draft stands in for it, its other files staged with it. */
  name?: string;
  providerUrl?: string;
}

/** A script the try ran through the skill tool, as the agent wrote it, and whether it printed without an error. */
export interface SkillTryScript {
  skill: string;
  command: string;
  ok: boolean;
}

export type SkillTryResult =
  | {
    ok: true;
    /** The draft's name, to tell it from the other skills in `loaded`. */
    draft: string;
    answer: string;
    /** The skills the agent loaded, in order. */
    loaded: string[];
    scripts: SkillTryScript[];
  }
  /** `onlyNamed`: the skill is offered only when the request names it, and this one does not. */
  | { ok: false; reason: SkillDraftFailure | 'onlyNamed'; error?: string };

/** A skill's text files by path inside its folder: `SKILL.md`, `scripts/x.mjs`, `references/x.md`. */
export type SkillTextFiles = Record<string, string>;

/** A file of the skill the editor does not open (a Python script, an image), listed with its size. */
export interface SkillOtherFile {
  rel: string;
  size: number;
}

/** An installed skill as the editor opens it: its text files, and the rest by name. */
export interface SkillFilesView {
  files: SkillTextFiles;
  others: SkillOtherFile[];
}

export type SkillCheckCode =
  | 'fileNotAllowed'
  | 'tooManyFiles'
  | 'fileTooLarge'
  | 'missingFile'
  | 'unreferencedScript'
  | 'noExample'
  | 'incompleteEnumeration'
  | 'packageImport'
  | 'skillMd';

export interface SkillCheckIssue {
  level: 'error' | 'warning';
  code: SkillCheckCode;
  file?: string;
  detail?: string;
  /** Where in the file (1-based), for the fix prompt to point at. */
  line?: number;
}

/** A script run once with the example its SKILL.md gives, for the user to read what it printed. */
export interface ScriptRunResult {
  script: string;
  /** The example's arguments, as SKILL.md writes them. */
  args: string[];
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** What a local check of a skill found: nothing here cost a model call. */
export interface SkillVerifyReport {
  issues: SkillCheckIssue[];
  runs: ScriptRunResult[];
}

/** An example run as a person would type it: arguments with spaces or quotes are quoted. */
export function scriptCommandLine(script: string, args: readonly string[]): string {
  const quoted = args.map((arg) => (arg === '' || /[\s"']/.test(arg) ? JSON.stringify(arg) : arg));
  return ['node', script, ...quoted].join(' ');
}

/** What the drafting model returns, before it becomes a SKILL.md. */
export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
}

/** A valid skill name from what the model wrote: its slug, then one that is not taken. */
export function draftSkillName(raw: string, taken: ReadonlySet<string>): string {
  const base = isValidSkillName(raw) ? raw : skillSlug(raw);
  if (!base || !taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 60)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

function descriptionLine(description: string): string {
  const flat = description.replace(/\s+/g, ' ').trim().slice(0, SKILL_DESCRIPTION_MAX);
  return `description: ${JSON.stringify(flat)}`;
}

/** A new SKILL.md from a draft: the spec's two keys, then the instructions. */
export function skillDocFromDraft(draft: SkillDraft): string {
  return ['---', `name: ${draft.name}`, descriptionLine(draft.description), '---', '', draft.instructions.trim(), ''].join('\n');
}

/**
 * The SKILL.md open in the editor with the draft's name, description and instructions, every other
 * header line (license, Claude Code keys, comments) kept as it was.
 */
export function reviseSkillDoc(doc: string, draft: SkillDraft): string {
  const text = doc.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const end = lines[0]?.trim() === '---' ? lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line)) : -1;
  if (end < 0) return skillDocFromDraft(draft);
  const head = lines.slice(1, end);
  const setKey = (key: string, line: string, insertAt: number): void => {
    const at = head.findIndex((entry) => new RegExp(`^${key}\\s*:`).test(entry));
    if (at < 0) {
      head.splice(insertAt, 0, line);
      return;
    }
    let next = at + 1;
    while (next < head.length && /^\s+\S/.test(head[next])) next += 1;
    head.splice(at, next - at, line);
  };
  setKey('name', `name: ${draft.name}`, 0);
  setKey('description', descriptionLine(draft.description), 1);
  return ['---', ...head, '---', '', draft.instructions.trim(), ''].join('\n');
}
