import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { languageForLocale } from '../../shared/localeLanguage';
import { SKILL_FILE, SKILL_MD_MAX_BYTES, isValidSkillName, parseSkillMarkdown } from '../../shared/agentSkills';
import { DRAFT_CALL_BUDGET, SKILL_DRAFT_CONVERSATION_MAX, SKILL_DRAFT_REQUEST_MAX } from '../../shared/skillAuthoring';
import type {
  SkillDraftProgress, SkillDraftRequest, SkillDraftResult, SkillDraftStep, SkillOtherFile, SkillTestResult, SkillTextFiles,
  SkillTryRequest, SkillTryResult,
} from '../../shared/skillAuthoring';
import type { ConversationTurn } from '../../shared/conversationDoc';
import { config, saveConfig } from '../config';
import type { FlowExecutorDeps } from '../flow/types';
import { sendLog, sendToRenderer } from '../helpers';
import { getLangCache, localizeUserFacingError, t } from '../i18n';
import { ensureWorkerWindow, getWorkerWin } from '../windows';
import { listAgentSkills, listSkills } from '../agentSkills/skillStore';
import { availableToolsText } from '../agentSkills/skillDraftPrompt';
import type { SkillDraftPriorInput, SkillDraftPromptInput } from '../agentSkills/skillDraftPrompt';
import { runSkillDraft } from '../agentSkills/skillDraftRun';
import { checkSkillFiles } from '../agentSkills/skillCheck';
import { problemsForModel } from '../agentSkills/skillVerify';
import { runSkillTry } from '../agentSkills/skillTestRun';
import { EDITABLE_SKILL_FILE } from '../agentSkills/skillTextFiles';
import { loadConversation } from '../chat/conversationStore';
import { isAllowedFilePath } from './context';

/** Each turn of a long answer read for a draft: the shape of the work, not every paragraph of it. */
const TURN_RESPONSE_MAX = 3_000;
/** What a revise shows the model of the skill's files; the rest goes by name (a signed-out Gemini takes 32,000 a message). */
const REVISE_MATERIAL_MAX = 20_000;
const ANSWER_MAX = 2_000;
const QUESTION_MAX = 600;
const OTHER_FILES_MAX = 1_000;
const DRAFT_ID_MAX = 64;
/**
 * How long one drafting call may take: a reply is several whole files, and Claude's wait is a total
 * that hands over whatever was written by then. The chat setting (120 s by default) would cut drafts off;
 * this is the longest that setting allows, and the editor shows the seconds and a Stop button.
 */
export const SKILL_DRAFT_TIMEOUT_MS = 300_000;

/** One draft or one try at a time: a new one cancels the old, as the editor shows only the latest. */
let running: AbortController | null = null;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** The model skills are written and tried with: the one picked last, or the chat model when none was. */
export function skillAuthorModelUrl(): string {
  return config.skillAuthorUrl.trim() || config.targetUrl;
}

/** Remembered only when it differs from what would be used anyway, so "follow the chat model" survives picking it. */
function rememberSkillAuthorModel(providerUrl: string): void {
  if (providerUrl === skillAuthorModelUrl()) return;
  config.skillAuthorUrl = providerUrl;
  saveConfig({ skillAuthorUrl: providerUrl });
}

function pickedModel(raw: unknown): string {
  const providerUrl = text(raw, 2_000) || skillAuthorModelUrl();
  rememberSkillAuthorModel(providerUrl);
  return providerUrl;
}

function workerDeps(providerUrl: string): FlowExecutorDeps {
  return {
    getWorkerWin,
    ensureWorkerWin: () => ensureWorkerWindow(providerUrl, 'automation'),
    getTargetUrl: () => providerUrl,
    getResponseTimeoutMs: () => config.responseTimeout,
  };
}

function turnText(turn: ConversationTurn, index: number): string {
  const response = turn.response.length > TURN_RESPONSE_MAX ? `${turn.response.slice(0, TURN_RESPONSE_MAX)}\n[…]` : turn.response;
  return `TURN ${index + 1}\nUSER: ${turn.prompt.trim()}\nASSISTANT: ${response.trim()}`;
}

/**
 * The conversation a draft reads: the first turn (what the task was) and then as many of the latest
 * turns as fit (how the user corrected it and what they kept).
 */
export function conversationForDraft(turns: readonly ConversationTurn[], max = SKILL_DRAFT_CONVERSATION_MAX): string {
  if (turns.length === 0) return '';
  const first = turnText(turns[0], 0);
  const tail: string[] = [];
  let used = first.length;
  for (let i = turns.length - 1; i >= 1; i--) {
    const block = turnText(turns[i], i);
    if (used + block.length + 2 > max) break;
    tail.unshift(block);
    used += block.length + 2;
  }
  const skipped = turns.length - 1 - tail.length;
  return [first.slice(0, max), ...(skipped > 0 ? [`[${skipped} turn(s) left out]`] : []), ...tail].join('\n\n');
}

/** The editor's files as sent from the page: only the editable kinds, SKILL.md required. */
export function readEditorFiles(raw: unknown): SkillTextFiles | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const files: SkillTextFiles = {};
  for (const [rel, body] of Object.entries(raw as Record<string, unknown>)) {
    if (!EDITABLE_SKILL_FILE.test(rel) || typeof body !== 'string' || body.length > SKILL_MD_MAX_BYTES) return null;
    files[rel] = body;
  }
  return files[SKILL_FILE] === undefined ? null : files;
}

function readOthers(raw: unknown): SkillOtherFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, OTHER_FILES_MAX).flatMap((entry) => {
    const value = entry as Partial<SkillOtherFile> | null;
    return typeof value?.rel === 'string' && value.rel ? [{ rel: value.rel.slice(0, 300), size: Number(value.size) || 0 }] : [];
  });
}

/** The files the page says AI wrote, among those sent: only which local rules apply, never prompt text. */
function readAuthored(raw: unknown, files: SkillTextFiles): Set<string> {
  return new Set(Array.isArray(raw) ? raw.filter((rel): rel is string => typeof rel === 'string' && Object.hasOwn(files, rel)) : []);
}

function installedName(raw: unknown): string | undefined {
  const name = text(raw, 64);
  return isValidSkillName(name) ? name : undefined;
}

function fileRank(rel: string): number {
  if (rel === SKILL_FILE) return 0;
  if (rel.startsWith('scripts/')) return 1;
  return 2;
}

/**
 * What a revise shows the model: SKILL.md, then scripts and references while they fit; the rest
 * by name. A test file (`evals/`, from an import or an older draft) always goes by name: a draft
 * writes none.
 */
export function reviseMaterial(files: SkillTextFiles, others: readonly SkillOtherFile[], max = REVISE_MATERIAL_MAX): { shown: SkillTextFiles; others: SkillOtherFile[] } {
  const shown: SkillTextFiles = {};
  const hidden = [...others];
  let used = 0;
  const order = Object.keys(files).sort((a, b) => fileRank(a) - fileRank(b) || a.localeCompare(b));
  for (const rel of order) {
    if (rel !== SKILL_FILE && (rel.startsWith('evals/') || used + files[rel].length > max)) {
      hidden.push({ rel, size: files[rel].length });
      continue;
    }
    shown[rel] = files[rel];
    used += files[rel].length;
  }
  return { shown, others: hidden };
}

function readPrior(raw: unknown): { prior: SkillDraftPriorInput; calls: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const questions = Array.isArray(value.questions) ? value.questions.slice(0, 3).map((question) => text(question, QUESTION_MAX)).filter(Boolean) : [];
  if (questions.length === 0) return null;
  const answers = Array.isArray(value.answers) ? value.answers.slice(0, questions.length).map((answer) => text(answer, ANSWER_MAX)) : [];
  const calls = Math.min(DRAFT_CALL_BUDGET, Math.max(1, Math.floor(Number(value.calls) || 1)));
  return { prior: { questions, answers, useAssumptions: value.useAssumptions === true }, calls };
}

function begin(): AbortController {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  return controller;
}

function failure(err: unknown, controller: AbortController, label: string): { ok: false; reason: 'cancelled' | 'failed'; error?: string } {
  if (controller.signal.aborted) return { ok: false, reason: 'cancelled' };
  const error = err instanceof Error ? err.message : String(err);
  sendLog(`⚠️ [Skills] ${label} failed: ${error}`);
  return { ok: false, reason: 'failed', error: localizeUserFacingError(error, getLangCache()) };
}

interface DraftSetup {
  input: SkillDraftPromptInput;
  baseFiles: SkillTextFiles;
  others: SkillOtherFile[];
  keepName?: string;
  base?: string;
}

async function draftSetup(request: SkillDraftRequest, installed: string[], prior: SkillDraftPriorInput | undefined): Promise<DraftSetup | null> {
  const common = {
    request: text(request.request, SKILL_DRAFT_REQUEST_MAX),
    language: languageForLocale(config.locale),
    installed,
    tools: availableToolsText(),
    ...(prior ? { prior } : {}),
  };
  if (request.mode === 'describe') return common.request ? { input: { ...common, mode: 'describe' }, baseFiles: {}, others: [] } : null;
  if (request.mode === 'revise') {
    const files = readEditorFiles(request.files);
    if (!files) return null;
    const base = installedName(request.name);
    // "Fix": what is wrong is found here again, on the files sent, not taken from the page.
    const problems = request.fixProblems === true
      ? problemsForModel(await checkSkillFiles(files, { authored: readAuthored(request.authored, files), others: readOthers(request.others), base }))
      : [];
    if (!common.request && problems.length === 0) return null;
    const material = reviseMaterial(files, readOthers(request.others));
    const ownName = parseSkillMarkdown(files[SKILL_FILE], '').name;
    return {
      input: { ...common, mode: 'revise', files: material.shown, others: material.others, ...(problems.length > 0 ? { problems } : {}) },
      baseFiles: files,
      others: readOthers(request.others),
      keepName: base ?? (isValidSkillName(ownName) ? ownName : undefined),
      base,
    };
  }
  // The path comes from the page: only a conversation in the output folder is read.
  if (!await isAllowedFilePath(request.conversationPath)) return null;
  const loaded = await loadConversation(request.conversationPath);
  const conversation = loaded ? conversationForDraft(loaded.doc.turns) : '';
  return conversation ? { input: { ...common, mode: 'conversation', conversation }, baseFiles: {}, others: [] } : null;
}

export async function draftSkill(raw: unknown): Promise<SkillDraftResult> {
  const request = raw as SkillDraftRequest;
  if (!request || typeof request !== 'object' || !['describe', 'conversation', 'revise'].includes(request.mode)) return { ok: false, reason: 'invalid' };
  const installed = (await listSkills()).map((skill) => skill.name);
  const prior = request.prior === undefined ? null : readPrior(request.prior);
  if (request.prior !== undefined && !prior) return { ok: false, reason: 'invalid' };
  const setup = await draftSetup(request, installed, prior?.prior);
  if (!setup) return { ok: false, reason: 'invalid' };
  const providerUrl = pickedModel(request.providerUrl);
  const controller = begin();
  const draftId = text(request.draftId, DRAFT_ID_MAX);
  // A stopped draft may still be running its checks; the editor already said it stopped.
  const onStep = (step: SkillDraftStep): void => {
    if (!controller.signal.aborted) sendToRenderer(IPC.SKILLS_DRAFT_PROGRESS, { draftId, step } satisfies SkillDraftProgress);
  };
  sendLog(`🧩 [Skills] drafting a skill (${setup.input.mode}${prior ? ', after the answers' : ''})`);
  try {
    const result = await runSkillDraft({
      ...setup,
      taken: new Set(installed),
      spent: prior?.calls ?? 0,
      providerUrl,
      deps: workerDeps(providerUrl),
      timeoutMs: Math.max(config.responseTimeout, SKILL_DRAFT_TIMEOUT_MS),
      signal: controller.signal,
      ...(draftId ? { onStep } : {}),
    });
    if (controller.signal.aborted) return { ok: false, reason: 'cancelled' };
    if (!result.ok && result.reason === 'failed') return { ok: false, reason: 'failed', error: t(getLangCache(), 'settings.skills.ai.invalidOutput') };
    return result;
  } catch (err: unknown) {
    return failure(err, controller, 'draft');
  } finally {
    if (running === controller) running = null;
  }
}

/** The local checks of the editor's files: structure and each script's example run, no model call. */
export async function testSkill(raw: unknown): Promise<SkillTestResult> {
  const request = raw as { files?: unknown; others?: unknown; name?: unknown; authored?: unknown } | null;
  const files = readEditorFiles(request?.files);
  if (!files) return { ok: false, reason: 'invalid' };
  const report = await checkSkillFiles(files, {
    authored: readAuthored(request?.authored, files), others: readOthers(request?.others), base: installedName(request?.name),
  });
  sendLog(`🧩 [Skills] checked "${parseSkillMarkdown(files[SKILL_FILE], '').name}": ${report.runs.filter((run) => run.ok).length}/${report.runs.length} example runs passed`);
  return { ok: true, report };
}

/** "Try it": the user's request run by the agent on the picked model, the editor's files standing in for the skill. */
export async function trySkill(raw: unknown): Promise<SkillTryResult> {
  const request = raw as SkillTryRequest | null;
  const files = readEditorFiles(request?.files);
  const ask = text(request?.request, SKILL_DRAFT_REQUEST_MAX);
  if (!files || !ask) return { ok: false, reason: 'invalid' };
  const base = installedName(request?.name);
  const installed = await listAgentSkills().catch(() => []);
  const providerUrl = pickedModel(request?.providerUrl);
  const controller = begin();
  try {
    const result = await runSkillTry({ files, base, request: ask, installed, providerUrl, deps: workerDeps(providerUrl), signal: controller.signal });
    return controller.signal.aborted ? { ok: false, reason: 'cancelled' } : result;
  } catch (err: unknown) {
    return failure(err, controller, 'try');
  } finally {
    if (running === controller) running = null;
  }
}

export function registerSkillAuthorHandlers(): void {
  ipcMain.handle(IPC.SKILLS_DRAFT, (_event, raw: unknown) => draftSkill(raw));
  ipcMain.handle(IPC.SKILLS_TRY, (_event, raw: unknown) => trySkill(raw));
  ipcMain.handle(IPC.SKILLS_TEST, (_event, raw: unknown) => testSkill(raw));
  ipcMain.handle(IPC.SKILLS_DRAFT_CANCEL, () => { running?.abort(); });
  ipcMain.handle(IPC.SKILLS_DEFAULT_MODEL, () => skillAuthorModelUrl());
}
