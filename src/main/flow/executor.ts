import { clipboard } from 'electron';
import type {
  FlowButton,
  FlowDefinition,
  FlowExecutionResult,
  FlowStepStatus,
  SkillInstance,
  SkillType,
} from '../../shared/types';
import { parseFlowButtons, withButtonImages } from '../../shared/ytdl';
import type { FlowStepOutcome } from '../../shared/flowMetrics';
import { METRIC_SILENT_STEP_TYPES } from '../../shared/flowMetrics';
import { escapeRegExp } from '../../shared/regex';
import { sendLog } from '../helpers';
import { getLangCache, t } from '../i18n';
import { measureTokens } from '../tokenMeter';
import { recordFlowStep } from '../flowMeter';
import type { FlowExecutorDeps, LogCallback } from './types';
import {
  getProducedFiles,
  interpolate,
  interpolateConfig,
  isFileOutputStep,
  PRODUCED_FILES_KEY,
  recordProducedFile,
  resolveMagicUploadFile,
} from './interpolation';
import {
  BreakLoopSignal,
  ContinueLoopSignal,
  StopFlowSignal,
  emitLog,
  emitSkipNote,
  findBlockEndIndex,
  resolveStepTimeoutMs,
  withStepTimeout,
} from './runtime';
import { executeSkill } from './skills';
import { resolveMcpArguments } from './skills/mcpCall';
import { navigatePageBlank } from './skills/browserPages';
import { signInUseOf } from './skills/readAccess';
import { describeStepError, localizeStepError } from './userError';
import { getProviderLabel } from '../providers';
import { PERPLEXITY_CLOUDFLARE_ERROR_NAME } from '../providers/perplexity';
import { FLOW_VAR_PREFIX } from '../../shared/flowVariables';
import { botStepTargets } from '../../shared/botRecipients';
import { checkBlockStructure, describeBlockIssue } from '../../shared/flowBlockStructure';
import { TRIGGER_IS_INPUT_VARIABLE } from '../../shared/builtin/steps';

/**
 * Skills whose `emitFailFlag` turns a throw into `{{key.isFailed}}`="1" and sets "0" on success.
 * One list for both paths: a skill in only one of them leaves `.isFailed` unset on success.
 */
const FAIL_SOFT_SKILLS: ReadonlySet<SkillType> = new Set<SkillType>([
  'llm', 'browser', 'browser_js', 'bot', 'research', 'share', 'x_thread', 'x_media', 'youtube_download', 'mcp', 'calendar', 'mail_fetch',
]);

interface RunProgress {
  completed: number;
  stopped: boolean;
  aborted: boolean;
  /** Steps lost to `emitFailFlag` in this run — the run still succeeds, so nothing else records it. */
  softFailures: number;
  /** The first of those, worded like `displayError`, so the run's notification can name it. */
  softFailureError?: string;
  error?: string;
  displayError?: string;
  /**
   * The step that threw first. A step inside a loop fails the run through the loop step, and the
   * user is owed the name of the one that actually broke.
   */
  failedStep?: SkillInstance;
  finalOutput?: string;
  lastLlmProvider?: string;
  titleHint?: string;
  buttons?: FlowButton[];
  /** Buttons the step that produced `finalOutput` offers itself (`youtube_info`'s menu). */
  resultButtons?: FlowButton[];
  savedFiles?: string[];
  chatMedia?: string[];
  postCard?: string;
}

/**
 * Every step execution is counted, including each pass through a loop body: a nested step that
 * fails on four of five items is the exact shape this exists to surface, and `progress.completed`
 * cannot see it because it only advances at depth 0.
 */
function noteStep(
  flowId: string,
  step: SkillInstance,
  outcome: FlowStepOutcome,
  startedAt: number,
  error?: string,
): void {
  if (outcome === 'ok' && METRIC_SILENT_STEP_TYPES.has(step.type)) return;
  recordFlowStep({
    flowId,
    stepId: step.id,
    type: step.type,
    outcome,
    durationMs: Date.now() - startedAt,
    error,
  });
}

export function titleHintFor(type: SkillType, subVars: Record<string, string>): string {
  const place = (subVars.place ?? '').trim();
  if (type === 'gmap_reviews' && place) return t(getLangCache(), 'mapReviews.title', { place });
  if (type === 'youtube' || type === 'youtube_info' || type === 'youtube_download') return (subVars.title ?? '').trim();
  if (type === 'x_media') {
    // A forum article has a title of its own (a PTT article).
    const title = (subVars.title ?? '').trim();
    if (title) return title;
    const who = (subVars.name ?? '').trim() || (subVars.author ?? '').trim();
    const said = (subVars.text ?? '').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 40) ?? '';
    return [who, said].filter(Boolean).join(': ');
  }
  return '';
}

/**
 * What a step contributes to the chat answer. A download's output is a file path; the person
 * reading the chat wants the sentence that says where it went.
 */
function resultTextFor(type: SkillType, output: string, subVars: Record<string, string>): string {
  if (type === 'youtube_download') return (subVars.summary ?? '').trim() || output;
  // The post itself, then where its media went (or that it had none).
  if (type === 'x_media') return [subVars.message, subVars.summary || subVars.notice].filter((part) => part?.trim()).join('\n\n') || output;
  return output;
}

const NON_RESULT_STEP_TYPES = new Set<SkillType>(['loop', 'end_loop', 'if', 'end_if', 'comment', 'bot', 'break', 'continue', 'stop']);

const MAX_TRACE_NAME_CHARS = 28;

function flowTrace(flow: FlowDefinition): string {
  const name = (flow.name ?? '').trim() || 'Flow';
  return name.length > MAX_TRACE_NAME_CHARS ? `${name.slice(0, MAX_TRACE_NAME_CHARS)}…` : name;
}

interface StepOutput {
  output: string;
  subVars: Record<string, string>;
}

export function unwrapStepOutput(type: SkillType, raw: string): StepOutput {
  if (type === 'youtube') {
    try {
      const env = JSON.parse(raw) as {
        transcript?: unknown;
        title?: unknown;
        isFailed?: unknown;
        image?: unknown;
      };
      if (env && typeof env.transcript === 'string') {
        const transcript = env.transcript;
        const title = typeof env.title === 'string' ? env.title : '';
        const isFailed = env.isFailed === '1' ? '1' : '0';
        const image = typeof env.image === 'string' ? env.image : '';
        return { output: transcript, subVars: { title, transcript, isFailed, image } };
      }
    } catch {
    }
    return { output: raw, subVars: {} };
  }
  if (type === 'browser') {
    try {
      const env = JSON.parse(raw) as { output?: unknown; image?: unknown };
      if (env && typeof env.output === 'string' && typeof env.image === 'string') {
        return { output: env.output, subVars: { image: env.image } };
      }
    } catch {
    }
    return { output: raw, subVars: {} };
  }
  if (type === 'stock' || type === 'forex' || type === 'weather' || type === 'air_quality' || type === 'calendar' || type === 'mail_fetch' || type === 'almanac' || type === 'tw_invoice' || type === 'gmap_reviews' || type === 'research' || type === 'sysinfo' || type === 'share' || type === 'line_read' || type === 'telegram_read' || type === 'mcp' || type === 'x_thread' || type === 'x_media' || type === 'youtube_info' || type === 'youtube_download') {
    try {
      const env = JSON.parse(raw) as Record<string, unknown>;
      if (env && typeof env.output === 'string') {
        const subVars: Record<string, string> = {};
        for (const [k, v] of Object.entries(env)) {
          if (k !== 'output' && typeof v === 'string') subVars[k] = v;
        }
        return { output: env.output, subVars };
      }
    } catch {
    }
    return { output: raw, subVars: {} };
  }
  if (type === 'browser_open') {
    try {
      const env = JSON.parse(raw) as { id?: unknown; title?: unknown; url?: unknown };
      if (env && typeof env.id === 'string') {
        return {
          output: env.id,
          subVars: {
            title: typeof env.title === 'string' ? env.title : '',
            url: typeof env.url === 'string' ? env.url : '',
          },
        };
      }
    } catch {
    }
    return { output: raw, subVars: {} };
  }
  return { output: raw, subVars: {} };
}

// The __attachmentAllowlist injection is the wiring half of the attachment gate: a step type
// missing from it can send no file at all.
/**
 * Set (to "1") only on a run the person started in the desktop chat: the one kind of run that may
 * show them a window. `FlowManager` sets it from the run's source and drops it from anything else.
 */
export const INTERACTIVE_RUN_KEY = '__run.interactive';

/**
 * How far a run may read a pasted link with the site sign-ins in Settings: `full` (runs not
 * started by a bot, an admin in their private chat) or `others` (anyone else's bot message: no post
 * marked as shown to some people only, no stories or profiles; `signInUseForRun`).
 * `FlowManager` sets it and drops it from anything a caller hands it; a run without it reads
 * every link as a visitor.
 */
export const SIGNED_IN_RUN_KEY = '__run.signedIn';

/**
 * Set (to "1") on a run a Telegram or LINE message started, so a connector step refuses to change
 * anything (`mcpStepRefusal`). `FlowManager` sets it from the run's source and drops it from anything else.
 */
export const BOT_RUN_KEY = '__run.bot';

const RUN_KEY_PREFIX = '__run.';

/**
 * A run's variables. Once the run's own marks are in (`sealed`), no step can write a `__run.` key:
 * a step whose output key is `__run.bot` would otherwise clear the mark that keeps a bot-started
 * run from changing a connector's data, or forge a sign-in mark.
 */
class RunContext extends Map<string, string> {
  sealed = false;

  override set(key: string, value: string): this {
    if (this.sealed && key.startsWith(RUN_KEY_PREFIX)) return this;
    return super.set(key, value);
  }
}

function sealedCopy(context: Map<string, string>): RunContext {
  const copy = new RunContext(context);
  copy.sealed = true;
  return copy;
}

/** The steps that read a pasted link, and so may be told to leave the sign-ins alone. */
const LINK_READING_STEPS: ReadonlySet<string> = new Set(['x_media', 'x_thread', 'youtube_info', 'youtube_download', 'youtube']);

/** The flow's own bot command, which its bot steps' buttons run again. */
export function flowBotCommand(flow: FlowDefinition): string {
  const trigger = [flow.trigger, ...(flow.extraTriggers ?? [])]
    .find((t) => t?.type === 'bot' && (t.botCommand ?? '').trim());
  return (trigger?.botCommand ?? '').trim().replace(/^\//, '');
}

export async function resolveStepConfig(
  step: SkillInstance,
  context: Map<string, string>,
  flowId: string,
  botCommand = '',
): Promise<Record<string, string>> {
  const resolvedConfig = interpolateConfig(step.config, context);
  if (step.type === 'bot') {
    const messageTemplate = step.config.message ?? '';
    const magicFile = await resolveMagicUploadFile(messageTemplate, context);
    if (magicFile) {
      const placeholderPattern = new RegExp(`\\{\\{\\s*${escapeRegExp(magicFile.variable)}\\s*\\}\\}`, 'g');
      const captionTemplate = messageTemplate.replace(placeholderPattern, '').trim();
      resolvedConfig.__magicUploadPath = magicFile.filePath;
      resolvedConfig.__magicUploadCaption = interpolate(captionTemplate, context).trim();
    }
    resolvedConfig.__originalChatIdsTemplate = botStepTargets(step.config);
    resolvedConfig.__attachmentAllowlist = JSON.stringify(getProducedFiles(context));
    resolvedConfig.__triggerPlatform = context.get('bot.triggerPlatform') ?? '';
    // Buttons run this flow again on a press, on behalf of whoever started this run.
    resolvedConfig.__flowId = flowId;
    resolvedConfig.__botCommand = botCommand;
    resolvedConfig.__triggerUserId = context.get('bot.triggerUserId') ?? '';
    // What a reply into the asking chat quotes.
    resolvedConfig.__triggerChatId = context.get('bot.triggerChatId') ?? '';
    resolvedConfig.__triggerMessageId = context.get('bot.triggerMessageId') ?? '';
    // Whether that message is the input alone, so an answer may take its place.
    resolvedConfig.__triggerIsInput = context.get(TRIGGER_IS_INPUT_VARIABLE) ?? '';
  }
  if (step.type === 'youtube_info' || step.type === 'youtube_download') {
    resolvedConfig.__triggerPlatform = context.get('bot.triggerPlatform') ?? '';
    // Who asked decides the size cap and whether the reply may name a folder on this computer.
    resolvedConfig.__triggerUserId = context.get('bot.triggerUserId') ?? '';
    resolvedConfig.__triggerChatId = context.get('bot.triggerChatId') ?? '';
  }
  if (step.type === 'x_media') {
    // Which chat started the run decides where the media goes: a file for Telegram, a URL for LINE.
    resolvedConfig.__triggerPlatform = context.get('bot.triggerPlatform') ?? '';
  }
  if (step.type === 'x_media' || step.type === 'x_thread') {
    // A site that wants a person to click its check may show them a window only when they started
    // the run at the computer (`siteVerification.ts`).
    resolvedConfig.__interactive = context.get(INTERACTIVE_RUN_KEY) === '1' ? '1' : '';
  }
  if (LINK_READING_STEPS.has(step.type)) {
    // Someone else's bot message reads a link through the owner's sign-ins only as far as `others` allows.
    const signIn = signInUseOf(context.get(SIGNED_IN_RUN_KEY));
    resolvedConfig.__signedIn = signIn === 'none' ? '' : signIn;
  }
  if (step.type === 'mcp') {
    // Filled in from the template, not from text a variable was already spliced into (`interpolateMcpArguments`).
    resolvedConfig.arguments = resolveMcpArguments(step.config.arguments ?? '', context);
    resolvedConfig.__botRun = context.get(BOT_RUN_KEY) === '1' ? '1' : '';
  }
  if (step.type === 'js') {
    const entries = Object.fromEntries(context);
    delete entries[PRODUCED_FILES_KEY];
    resolvedConfig.__contextJson = JSON.stringify(entries);
  }
  if (step.type === 'llm') {
    resolvedConfig.__flowId = flowId;
    resolvedConfig.__attachmentAllowlist = JSON.stringify(getProducedFiles(context));
  }
  if (step.type === 'email_send') {
    resolvedConfig.__attachmentAllowlist = JSON.stringify(getProducedFiles(context));
  }
  if (step.type === 'browser_open' || step.type === 'browser_close') {
    resolvedConfig.__flowId = flowId;
  }
  return resolvedConfig;
}

async function runStep(
  step: SkillInstance,
  resolvedConfig: Record<string, string>,
  deps: FlowExecutorDeps,
  signal?: AbortSignal,
): Promise<string> {
  const stepTimeoutMs = resolveStepTimeoutMs(step.type, deps, resolvedConfig);
  if (step.type === 'llm') {
    return executeSkill(step.type, step.id, resolvedConfig, deps, stepTimeoutMs, signal);
  }
  // `withStepTimeout` gives up on the work but cannot cancel it, so the skill gets a signal of its
  // own that fires on Stop AND on the timeout: a shell command or a download is killed rather than
  // finishing later for nobody (and holding the one download slot meanwhile).
  const stepController = new AbortController();
  const stopStep = (): void => stepController.abort();
  if (signal?.aborted) stopStep();
  else signal?.addEventListener('abort', stopStep, { once: true });
  const onStepTimeout = (): void => {
    stopStep();
    if (step.type === 'browser_js') navigatePageBlank((resolvedConfig.page ?? '').trim());
  };
  try {
    return await withStepTimeout(
      executeSkill(step.type, step.id, resolvedConfig, deps, stepTimeoutMs, stepController.signal),
      stepTimeoutMs,
      step.type,
      onStepTimeout,
      signal,
    );
  } finally {
    signal?.removeEventListener('abort', stopStep);
  }
}

/**
 * When a top-level loop ends each body step keeps the outcome of its last pass: a pass logs its own
 * 'completed', a skip or soft failure stays as logged, note included (a Stop keeps "stopped"); still
 * 'running' means that pass finished without a log of its own; a step that never ran is skipped.
 */
function settleLoopBody(
  flow: FlowDefinition,
  loopIndex: number,
  bodyEnd: number,
  lastStatus: ReadonlyMap<string, FlowStepStatus>,
  onLog: LogCallback | undefined,
): void {
  for (let j = loopIndex + 1; j < bodyEnd; j++) {
    const { id } = flow.steps[j];
    const status = lastStatus.get(id);
    if (status === 'running') emitLog(onLog, flow.id, id, j, 'completed');
    else if (status === undefined) emitLog(onLog, flow.id, id, j, 'skipped');
  }
}

async function expandLoop(
  flow: FlowDefinition,
  loopIndex: number,
  rangeEnd: number,
  step: SkillInstance,
  output: string,
  context: Map<string, string>,
  deps: FlowExecutorDeps,
  onLog: LogCallback | undefined,
  progress: RunProgress,
  depth: number,
  trace: string,
  signal?: AbortSignal,
): Promise<number> {
  const loopVar = (step.config.loopVar ?? 'item').trim() || 'item';
  const limitIterations = step.config.limitIterations !== 'false';
  const limit = parseInt(step.config.maxIterations ?? '5', 10) || 5;
  let items: any[] = [];
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      items = parsed;
    }
  } catch {
  }

  if (limitIterations && limit > 0) {
    items = items.slice(0, limit);
  }

  const bodyEnd = Math.min(findBlockEndIndex(flow.steps, loopIndex), rangeEnd);
  const nested = depth > 0;
  const lastStatus = new Map<string, FlowStepStatus>();
  const bodyLog: LogCallback | undefined = nested
    ? onLog
    : (log) => {
      lastStatus.set(log.stepId, log.status);
      onLog?.(log);
    };

  if (items.length > 0) {
    sendLog(`🔄 [${trace}] Looping ${items.length} items${nested ? ' (nested)' : ''} as "{{${loopVar}}}"`);
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const iterationTrace = `${trace} ▸ ${j + 1}/${items.length}`;
      const loopContext = sealedCopy(context);
      if (typeof item === 'object' && item !== null) {
        for (const [k, v] of Object.entries(item)) {
          const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
          if (step.outputKey) {
            loopContext.set(`${step.outputKey}.${k}`, valStr);
          }
          loopContext.set(`${loopVar}.${k}`, valStr);
        }
        const itemStr = JSON.stringify(item);
        if (step.outputKey) {
          loopContext.set(step.outputKey, itemStr);
        }
        loopContext.set(loopVar, itemStr);
      } else {
        const valStr = String(item);
        if (step.outputKey) {
          loopContext.set(step.outputKey, valStr);
        }
        loopContext.set(loopVar, valStr);
      }
      try {
        await runRange(flow, loopIndex + 1, bodyEnd, loopContext, deps, bodyLog, progress, depth + 1, iterationTrace, signal);
      } catch (err) {
        if (err instanceof BreakLoopSignal) break;
        if (!(err instanceof ContinueLoopSignal)) throw err;
      }
      if (progress.aborted) break;
    }
    if (!nested) {
      settleLoopBody(flow, loopIndex, bodyEnd, lastStatus, onLog);
      if (!progress.aborted) progress.completed += Math.max(0, bodyEnd - loopIndex - 1);
    }
    sendLog(`🔄 [${trace}] Loop complete (${items.length} items)`);
  } else {
    for (let j = loopIndex + 1; j < bodyEnd; j++) {
      emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
      if (depth === 0) progress.completed++;
    }
    sendLog(`🔄 [${trace}] No items to loop — skipped ${Math.max(0, bodyEnd - loopIndex - 1)} body step(s)`);
  }

  return bodyEnd - 1;
}

function markAbortedFromHere(
  flow: FlowDefinition,
  fromIndex: number,
  depth: number,
  onLog: LogCallback | undefined,
  progress: RunProgress,
): void {
  if (depth === 0) {
    for (let j = fromIndex; j < flow.steps.length; j++) {
      emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
    }
    sendLog(`⏹️ [${flowTrace(flow)}] Aborted by user (${progress.completed}/${flow.steps.length} steps)`);
  }
  progress.aborted = true;
}

async function runRange(
  flow: FlowDefinition,
  startIndex: number,
  endIndex: number,
  context: Map<string, string>,
  deps: FlowExecutorDeps,
  onLog: LogCallback | undefined,
  progress: RunProgress,
  depth: number,
  trace: string,
  signal?: AbortSignal,
): Promise<void> {
  for (let i = startIndex; i < endIndex; i++) {
    if (signal?.aborted) {
      markAbortedFromHere(flow, i, depth, onLog, progress);
      return;
    }
    const step = flow.steps[i];
    const stepLabel = `Step ${i + 1}/${flow.steps.length} [${step.type}] ${step.label}`;
    emitLog(onLog, flow.id, step.id, i, 'running');
    if (depth === 0) {
      sendLog(`⏳ [${trace}] ${stepLabel}`);
    }

    const startedAt = Date.now();
    try {
      const resolvedConfig = await resolveStepConfig(step, context, flow.id, flowBotCommand(flow));
      const rawOutput = await runStep(step, resolvedConfig, deps, signal);
      const { output, subVars } = unwrapStepOutput(step.type, rawOutput);

      if (step.outputKey) {
        context.set(step.outputKey, output);
        for (const [subKey, subVal] of Object.entries(subVars)) {
          context.set(`${step.outputKey}.${subKey}`, subVal);
        }
      }
      context.set(`${step.id}.output`, output);
      if (isFileOutputStep(step.type, resolvedConfig) && output) {
        context.set('file', output);
        recordProducedFile(context, output);
      }
      // A post's output is its media, empty for a post with none; its text still answers.
      const resultText = resultTextFor(step.type, output, subVars);
      if (resultText && step.outputKey && !NON_RESULT_STEP_TYPES.has(step.type)) {
        progress.finalOutput = resultText;
        // What the answer offers and shows in the desktop chat (a menu's choices, a post's media)
        // belongs to that answer: the next step that answers drops them.
        const offered = withButtonImages(parseFlowButtons(subVars.buttons ?? ''), subVars.buttonImages);
        progress.resultButtons = offered.length > 0 ? offered : undefined;
        const shown = (subVars.chatMedia ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
        progress.chatMedia = shown.length > 0 ? shown : undefined;
        progress.postCard = subVars.card?.trim() || undefined;
      }
      // A video kept on this computer rather than handed to a bot step: the chat offers its folder.
      if ((step.type === 'youtube_download' || step.type === 'x_media') && subVars.savedLocally === '1' && output) {
        progress.savedFiles = [...(progress.savedFiles ?? []), ...output.split('\n').filter(Boolean)];
      }
      if (step.type === 'bot') {
        const buttons = parseFlowButtons(resolvedConfig.buttons ?? '');
        if (buttons.length > 0) progress.buttons = buttons;
      }
      if (depth === 0) {
        const titleHint = titleHintFor(step.type, subVars);
        if (titleHint) progress.titleHint = titleHint;
      }
      if (step.type === 'llm' && output) {
        progress.lastLlmProvider = getProviderLabel((resolvedConfig.provider ?? '').trim() || deps.getTargetUrl());
      }
      if (FAIL_SOFT_SKILLS.has(step.type) && step.config.emitFailFlag === 'true' && step.outputKey) {
        context.set(`${step.outputKey}.isFailed`, '0');
      }

      // Every pass logs its own completion (the run panel and report read each step's latest log);
      // only the counter is top-level, since expandLoop counts each loop body step once.
      emitLog(onLog, flow.id, step.id, i, 'completed', output);
      if (depth === 0) progress.completed++;
      sendLog(`✅ [${trace}] ${stepLabel} — ${output.length} chars`);
      noteStep(flow.id, step, 'ok', startedAt);

      if (step.type === 'loop' && i + 1 < endIndex) {
        i = await expandLoop(flow, i, endIndex, step, output, context, deps, onLog, progress, depth, trace, signal);
      }

      if (step.type === 'if') {
        const conditionMet = output === 'true';
        const bodyEnd = Math.min(findBlockEndIndex(flow.steps, i), endIndex);
        if (!conditionMet) {
          for (let j = i + 1; j < bodyEnd; j++) {
            emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
            if (depth === 0) progress.completed++;
          }
          sendLog(`↪️ [${trace}] If condition false — skipped ${Math.max(0, bodyEnd - i - 1)} step(s)`);
          i = bodyEnd - 1;
        }
      }
    } catch (err) {
      if (err instanceof StopFlowSignal) {
        // Inside a loop a stop step only skips this item; the loop and the steps after it go on.
        emitSkipNote(onLog, flow.id, step.id, i, depth === 0 ? 'stopped' : 'stoppedItem');
        sendLog(depth === 0
          ? `⏹️ [${trace}] ${stepLabel} stopped this run: ${err.message}`
          : `↪️ [${trace}] ${stepLabel} skipped this item: ${err.message}`);
        for (let j = i + 1; j < flow.steps.length; j++) {
          emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
        }
        if (depth === 0) {
          sendLog(`⏹️ [${trace}] Stopped early (${progress.completed}/${flow.steps.length} steps)`);
          progress.stopped = true;
          return;
        }
        break;
      }

      if (err instanceof BreakLoopSignal || err instanceof ContinueLoopSignal) {
        const kind = err instanceof BreakLoopSignal ? 'break' : 'continue';
        if (depth === 0) {
          emitSkipNote(onLog, flow.id, step.id, i, 'notInLoop');
          sendLog(`⚠️ [${trace}] "${kind}" ignored — not inside a loop`);
          continue;
        }
        sendLog(kind === 'break'
          ? `↪️ [${trace}] break — leaving the loop`
          : `↪️ [${trace}] continue — skipping to the next item`);
        emitSkipNote(onLog, flow.id, step.id, i, kind);
        for (let j = i + 1; j < endIndex; j++) {
          emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
        }
        throw err;
      }

      if (signal?.aborted) {
        emitSkipNote(onLog, flow.id, step.id, i, 'aborted');
        markAbortedFromHere(flow, i + 1, depth, onLog, progress);
        return;
      }

      const isVerificationChallenge =
        err instanceof Error && err.name === PERPLEXITY_CLOUDFLARE_ERROR_NAME;

      if (FAIL_SOFT_SKILLS.has(step.type) && step.config.emitFailFlag === 'true' && !isVerificationChallenge) {
        const msg = err instanceof Error ? err.message : String(err);
        if (step.outputKey) {
          context.set(step.outputKey, '');
          context.set(`${step.outputKey}.isFailed`, '1');
        }
        context.set(`${step.id}.output`, '');
        emitLog(onLog, flow.id, step.id, i, 'completed', '', msg, localizeStepError(err, getLangCache()));
        if (depth === 0) progress.completed++;
        progress.softFailures++;
        progress.softFailureError ??= describeStepError(err, step, getLangCache());
        noteStep(flow.id, step, 'soft', startedAt, msg);
        sendLog(`⚠️ [${trace}] ${stepLabel} failed (isFailed=1), continuing: ${msg}`);
        continue;
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      const strings = getLangCache();
      emitLog(onLog, flow.id, step.id, i, 'error', undefined, errorMsg, localizeStepError(err, strings));
      noteStep(flow.id, step, 'hard', startedAt, errorMsg);
      sendLog(`❌ [${trace}] ${stepLabel} failed: ${errorMsg}`);

      for (let j = i + 1; j < flow.steps.length; j++) {
        emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
      }

      progress.failedStep ??= step;
      if (depth === 0) {
        // Keep the step's own English unwrapped: localizeUserFacingError matches on it.
        progress.error = errorMsg;
        progress.displayError = describeStepError(err, progress.failedStep, strings);
        return;
      }
      throw err;
    }
  }
}

/**
 * A flow whose if/loop blocks cross (`if, loop, end_if, X, end_loop`) is refused before any step
 * runs: the false-`if` skip would end at the crossed `end_if` and run X, the step it was guarding.
 * Hand-edited, imported and older saved flows never went through `validateFlowCandidate`.
 */
function crossedBlockFailure(
  flow: FlowDefinition,
  onLog: LogCallback | undefined,
): { error: string; displayError: string } | null {
  const issue = checkBlockStructure(flow.steps);
  if (issue?.kind !== 'crossed') return null;
  const strings = getLangCache();
  const error = describeBlockIssue(issue);
  const displayError = t(strings, 'flow.error.blockStructure', {
    step: String(issue.index + 1),
    closer: t(strings, `flow.skill.${issue.closer}`),
    open: t(strings, `flow.skill.${issue.open}`),
  });
  flow.steps.forEach((step, j) => {
    if (j === issue.index) emitLog(onLog, flow.id, step.id, j, 'error', undefined, error, displayError);
    else emitLog(onLog, flow.id, step.id, j, 'skipped');
  });
  return { error, displayError };
}

export async function executeFlow(
  flow: FlowDefinition,
  deps: FlowExecutorDeps,
  onLog?: LogCallback,
  initialContext?: Record<string, string>,
  signal?: AbortSignal,
): Promise<FlowExecutionResult> {
  const { result, usage } = await measureTokens(
    () => runFlowSteps(flow, deps, onLog, initialContext, signal),
  );
  return { ...result, tokenUsage: usage };
}

async function runFlowSteps(
  flow: FlowDefinition,
  deps: FlowExecutorDeps,
  onLog?: LogCallback,
  initialContext?: Record<string, string>,
  signal?: AbortSignal,
): Promise<FlowExecutionResult> {
  const context = new RunContext();

  context.set('clipboard', await clipboard.readText());
  context.set('timestamp', new Date().toISOString());
  context.set('flow.name', flow.name);

  for (const variable of flow.variables ?? []) {
    context.set(`${FLOW_VAR_PREFIX}.${variable.key}`, variable.value);
  }

  if (initialContext) {
    for (const [k, v] of Object.entries(initialContext)) {
      context.set(k, v);
    }
  }
  context.sealed = true;

  const progress: RunProgress = { completed: 0, stopped: false, aborted: false, softFailures: 0 };

  const trace = flowTrace(flow);
  const crossed = crossedBlockFailure(flow, onLog);
  if (crossed) {
    sendLog(`❌ [${trace}] Refused to run: ${crossed.error}`);
    return {
      flowId: flow.id,
      success: false,
      outputs: Object.fromEntries(context),
      error: crossed.error,
      displayError: crossed.displayError,
      completedSteps: 0,
      totalSteps: flow.steps.length,
      completedAt: new Date().toISOString(),
      softFailures: 0,
    };
  }
  sendLog(`▶️ [${trace}] Executing flow (${flow.steps.length} steps)`);

  await runRange(flow, 0, flow.steps.length, context, deps, onLog, progress, 0, trace, signal);

  if (progress.aborted) {
    return {
      flowId: flow.id,
      success: false,
      aborted: true,
      outputs: Object.fromEntries(context),
      error: 'Aborted by user',
      displayError: t(getLangCache(), 'flow.error.aborted'),
      completedSteps: progress.completed,
      totalSteps: flow.steps.length,
      completedAt: new Date().toISOString(),
      softFailures: progress.softFailures,
    };
  }

  if (progress.error) {
    sendLog(`❌ [${trace}] Flow failed after ${progress.completed}/${flow.steps.length} steps — ${progress.error}`);
    return {
      flowId: flow.id,
      success: false,
      outputs: Object.fromEntries(context),
      error: progress.error,
      displayError: progress.displayError,
      completedSteps: progress.completed,
      totalSteps: flow.steps.length,
      completedAt: new Date().toISOString(),
      softFailures: progress.softFailures,
    };
  }

  if (!progress.stopped) {
    sendLog(`✅ [${trace}] Flow completed (${progress.completed}/${flow.steps.length} steps)`);
  }

  return {
    flowId: flow.id,
    success: true,
    outputs: Object.fromEntries(context),
    completedSteps: progress.completed,
    totalSteps: flow.steps.length,
    completedAt: new Date().toISOString(),
    finalOutput: progress.finalOutput,
    lastLlmProvider: progress.lastLlmProvider,
    titleHint: progress.titleHint,
    softFailures: progress.softFailures,
    softFailureError: progress.softFailureError,
    ...((progress.buttons ?? progress.resultButtons) ? { buttons: progress.buttons ?? progress.resultButtons } : {}),
    ...(progress.savedFiles ? { savedFiles: progress.savedFiles } : {}),
    ...(progress.chatMedia ? { chatMedia: progress.chatMedia } : {}),
    ...(progress.postCard ? { postCard: progress.postCard } : {}),
  };
}
