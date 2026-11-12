import { isByokTargetUrl } from '../../shared/types';
import { SKILL_FILE, hasFatalIssue, parseSkillMarkdown, withSkillIdentity } from '../../shared/agentSkills';
import { DRAFT_CALL_BUDGET, draftSkillName, reviseSkillDoc } from '../../shared/skillAuthoring';
import type { SkillDraftCallPurpose, SkillDraftResult, SkillDraftStep, SkillOtherFile, SkillTextFiles } from '../../shared/skillAuthoring';
import { askStructured, createProviderSession } from '../flow/agent/structuredLlm';
import type { Validation } from '../flow/agent/structuredLlm';
import type { FlowExecutorDeps } from '../flow/types';
import { sendLog } from '../helpers';
import { checkSkillFiles } from './skillCheck';
import { EDITABLE_SKILL_FILE } from './skillTextFiles';
import { parseDraftReply } from './skillDraftFormat';
import { buildSkillDraftPrompt, buildSkillRepairDelta, buildSkillRepairFull } from './skillDraftPrompt';
import type { SkillDraftPromptInput } from './skillDraftPrompt';

/*
 * One drafting round: a model call, then the checks on this computer (structure, each script's
 * example run in the sandbox). The only repair is a rewrite of a reply that holds no usable skill
 * (no blocks, no SKILL.md the agent could load): what the checks find goes to the editor, and the
 * user decides whether a fix is worth a call: every call is the user's tokens.
 * `DRAFT_CALL_BUDGET` covers the whole draft, the round after the user's answers included. The
 * files are never saved here.
 */

const REPAIRS_MAX = 1;

export interface SkillDraftRun {
  input: SkillDraftPromptInput;
  /** The editor's files a revise starts from; empty for a new skill. */
  baseFiles: SkillTextFiles;
  others: readonly SkillOtherFile[];
  /** A revise keeps the skill's name; a new skill gets one no installed skill has. */
  keepName?: string;
  taken: ReadonlySet<string>;
  /** The installed skill whose other files are staged with the draft's for its example runs. */
  base?: string;
  /** Calls the draft already spent: its first round, when this is the round after the answers. */
  spent: number;
  providerUrl: string;
  deps: FlowExecutorDeps;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Each step as it happens, for the editor to show what the draft is waiting for. */
  onStep?: (step: SkillDraftStep) => void;
}

type DraftValue = Extract<SkillDraftResult, { ok: true }>;

/** What the draft's first call is for, by where the draft started. */
function firstPurpose(input: SkillDraftPromptInput): SkillDraftCallPurpose {
  if (input.prior) return 'answers';
  if (input.mode === 'describe') return 'write';
  return input.mode;
}

/**
 * A revised SKILL.md keeps every header line of the one it revises but its name and description
 * (a license, a Claude Code key): the model rewrites the whole file and may drop them.
 */
function keepHeader(before: string, after: string): string {
  const parsed = parseSkillMarkdown(after, '');
  if (hasFatalIssue(parsed.issues)) return after;
  return reviseSkillDoc(before, { name: parsed.name, description: parsed.description, instructions: parsed.body });
}

/** Puts the draft's SKILL.md under the name it must have; '' when it has none an agent could load. */
function settleName(files: SkillTextFiles, keepName: string | undefined, taken: ReadonlySet<string>): string {
  const doc = files[SKILL_FILE];
  if (doc === undefined) return '';
  const parsed = parseSkillMarkdown(doc, '');
  if (hasFatalIssue(parsed.issues)) return '';
  const name = keepName ?? draftSkillName(parsed.name, taken);
  if (!name) return '';
  files[SKILL_FILE] = withSkillIdentity(doc, name, null);
  return name;
}

export async function runSkillDraft(run: SkillDraftRun): Promise<SkillDraftResult> {
  const budgetLeft = DRAFT_CALL_BUDGET - run.spent;
  if (budgetLeft <= 0) return { ok: false, reason: 'invalid' };
  const asked = run.input.prior !== undefined;
  let calls = 0;
  let lastError = '';

  const reject = (error: string): Validation<DraftValue> => {
    lastError = error;
    run.onStep?.({ kind: 'unusable' });
    return { ok: false, error };
  };

  const read = async (raw: string): Promise<Validation<DraftValue>> => {
    calls += 1;
    const reply = parseDraftReply(raw);
    if (!reply.ok) return reject(reply.error);
    const { questions } = reply.value;
    // The editor holds only these and refuses to save, check or try a draft holding any other (a
    // README.md, scripts/lib/util.mjs), with no way to remove it: such a file is left out here.
    const files: SkillTextFiles = {};
    for (const [rel, body] of Object.entries(reply.value.files)) {
      if (EDITABLE_SKILL_FILE.test(rel)) files[rel] = body;
      else sendLog(`🧩 [Skills] draft file left out (not part of a skill): ${rel}`);
    }
    if (Object.keys(files).length === 0) {
      if (!asked) return { ok: true, value: { ok: true, kind: 'questions', questions, calls: 0 } };
      return reject('The reply has no files. Write them now in @@@ FILE path @@@ blocks; ask nothing more.');
    }
    const current: SkillTextFiles = { ...run.baseFiles, ...files };
    const before = run.baseFiles[SKILL_FILE];
    if (before !== undefined && files[SKILL_FILE] !== undefined) current[SKILL_FILE] = keepHeader(before, files[SKILL_FILE]);
    const name = settleName(current, run.keepName, run.taken);
    if (!name) return reject('SKILL.md is missing or its --- front matter has no valid "name" and "description". Write the whole SKILL.md again.');
    const changed = Object.keys(current).filter((rel) => current[rel] !== run.baseFiles[rel]);
    const report = await checkSkillFiles(current, {
      authored: new Set(changed), others: run.others, base: run.base, signal: run.signal, onStep: run.onStep,
    });
    return { ok: true, value: { ok: true, kind: 'files', name, files: current, changed, report, calls: 0 } };
  };

  const byok = isByokTargetUrl(run.providerUrl);
  const result = await askStructured<DraftValue>({
    basePrompt: buildSkillDraftPrompt(run.input),
    providerUrl: run.providerUrl,
    deps: run.deps,
    timeoutMs: run.timeoutMs,
    read,
    maxRepairs: Math.min(REPAIRS_MAX, budgetLeft - 1),
    // BYOK keeps the conversation, so a rewrite is only why; a browser one-off starts over.
    ...(byok ? { session: createProviderSession(undefined, true) } : {}),
    transcriptRepair: () => buildSkillRepairDelta(lastError),
    buildRepair: () => buildSkillRepairFull(run.input, lastError),
    onReject: (error, attempt, preview) => sendLog(`🧩 [Skills] draft reply unusable (rewrite ${attempt}): ${error} — reply: ${preview}`),
    onAttempt: (attempt) => {
      run.onStep?.({ kind: 'model', purpose: attempt === 0 ? firstPurpose(run.input) : 'reformat', call: run.spent + attempt + 1, budget: DRAFT_CALL_BUDGET });
    },
    signal: run.signal,
  });
  if (!result.ok || !result.value) {
    sendLog(`⚠️ [Skills] draft failed after ${calls} call(s): ${result.error ?? 'no usable draft'}`);
    return { ok: false, reason: 'failed' };
  }
  const value = result.value;
  const failing = value.kind === 'files' ? value.report.runs.filter((entry) => !entry.ok).length : 0;
  sendLog(`🧩 [Skills] draft ${value.kind === 'files' ? `"${value.name}"` : 'questions'} after ${calls} call(s)${failing > 0 ? `, ${failing} example run(s) failing` : ''}`);
  return { ...value, calls: run.spent + calls };
}
