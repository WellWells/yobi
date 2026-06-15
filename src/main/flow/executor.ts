import { clipboard } from 'electron';
import type { FlowDefinition, FlowExecutionResult, SkillInstance, SkillType } from '../../shared/types';
import { sendLog } from '../helpers';
import type { FlowExecutorDeps, LogCallback } from './types';
import {
  escapeRegExp,
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
  findIfEndIndex,
  findLoopEndIndex,
  resolveStepTimeoutMs,
  withStepTimeout,
} from './runtime';
import { executeSkill } from './skills';
import { navigatePageBlank } from './skills/browserPages';
import { PERPLEXITY_CLOUDFLARE_ERROR_NAME } from '../providers/perplexity';

interface RunProgress {
  completed: number;
  stopped: boolean;
  aborted: boolean;
  error?: string;
  finalOutput?: string;
}

const NON_RESULT_STEP_TYPES = new Set<SkillType>(['loop', 'end_loop', 'if', 'end_if', 'comment', 'bot', 'break', 'continue']);

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
  if (type === 'rss' || type === 'browser') {
    try {
      const env = JSON.parse(raw) as { output?: unknown; image?: unknown };
      if (env && typeof env.output === 'string' && typeof env.image === 'string') {
        return { output: env.output, subVars: { image: env.image } };
      }
    } catch {
    }
    return { output: raw, subVars: {} };
  }
  if (type === 'stock' || type === 'forex' || type === 'weather') {
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

async function resolveStepConfig(
  step: SkillInstance,
  context: Map<string, string>,
  flowId: string,
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
    resolvedConfig.__originalChatIdsTemplate = (step.config.chatIds ?? step.config.chatId ?? '').trim();
    resolvedConfig.__attachmentAllowlist = JSON.stringify(getProducedFiles(context));
  }
  if (step.type === 'js') {
    const entries = Object.fromEntries(context);
    delete entries[PRODUCED_FILES_KEY];
    resolvedConfig.__contextJson = JSON.stringify(entries);
  }
  if (step.type === 'llm') {
    resolvedConfig.__flowId = flowId;
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
  // The llm step serializes on the app-wide llmLane and owns its response
  // timeout + about:blank interrupt internally, starting the clock only once it
  // holds the shared worker window (see execLlm). Wrapping it in withStepTimeout
  // here as well would re-count llmLane queue-wait against the response budget —
  // exactly the starvation bug — so pass the signal straight through instead.
  if (step.type === 'llm') {
    return executeSkill(step.type, step.id, resolvedConfig, deps, stepTimeoutMs, signal);
  }
  const onStepTimeout =
    step.type === 'browser_js'
      ? () => {
          navigatePageBlank((resolvedConfig.page ?? '').trim());
        }
      : undefined;
  return withStepTimeout(
    executeSkill(step.type, step.id, resolvedConfig, deps, stepTimeoutMs),
    stepTimeoutMs,
    step.type,
    onStepTimeout,
    signal,
  );
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

  const bodyEnd = Math.min(findLoopEndIndex(flow.steps, loopIndex), rangeEnd);
  const nested = depth > 0;

  if (items.length > 0) {
    sendLog(`🔄 [AgentFlow] Looping subsequent steps for ${items.length} items${nested ? ' (nested)' : ''} using variable "${loopVar}"`);
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      sendLog(`🔄 [AgentFlow] Loop iteration ${j + 1}/${items.length}${nested ? ' (nested)' : ''}`);
      const loopContext = new Map(context);
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
        await runRange(flow, loopIndex + 1, bodyEnd, loopContext, deps, onLog, progress, depth + 1, signal);
      } catch (err) {
        if (err instanceof BreakLoopSignal) break;
        if (!(err instanceof ContinueLoopSignal)) throw err;
        // ContinueLoopSignal: fall through to the next item.
      }
      if (progress.aborted) break;
    }
    if (depth === 0) {
      if (progress.aborted) {
        for (let j = loopIndex + 1; j < bodyEnd; j++) {
          emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
        }
      } else {
        for (let j = loopIndex + 1; j < bodyEnd; j++) {
          progress.completed++;
        }
      }
    }
    if (!nested) sendLog(`🔄 [AgentFlow] Loop complete`);
  } else {
    for (let j = loopIndex + 1; j < bodyEnd; j++) {
      emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
      if (depth === 0) progress.completed++;
    }
    if (!nested) sendLog(`🔄 [AgentFlow] No items to loop, skipped loop body steps`);
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
    sendLog(`⏹️ [AgentFlow] Flow "${flow.name}" aborted by user (${progress.completed}/${flow.steps.length} steps)`);
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
  signal?: AbortSignal,
): Promise<void> {
  for (let i = startIndex; i < endIndex; i++) {
    if (signal?.aborted) {
      markAbortedFromHere(flow, i, depth, onLog, progress);
      return;
    }
    const step = flow.steps[i];
    emitLog(onLog, flow.id, step.id, i, 'running');
    if (depth === 0) {
      sendLog(`⏳ Step ${i + 1}/${flow.steps.length}: [${step.type}] ${step.label}`);
    }

    try {
      const resolvedConfig = await resolveStepConfig(step, context, flow.id);
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
      if (output && step.outputKey && !NON_RESULT_STEP_TYPES.has(step.type)) {
        progress.finalOutput = output;
      }
      if ((step.type === 'llm' || step.type === 'browser_js' || step.type === 'bot') && step.config.emitFailFlag === 'true' && step.outputKey) {
        context.set(`${step.outputKey}.isFailed`, '0');
      }

      if (depth === 0) {
        progress.completed++;
        emitLog(onLog, flow.id, step.id, i, 'completed', output);
        sendLog(`✅ Step ${i + 1} completed (${output.length} chars)`);
      }

      if (step.type === 'loop' && i + 1 < endIndex) {
        i = await expandLoop(flow, i, endIndex, step, output, context, deps, onLog, progress, depth, signal);
      }

      if (step.type === 'if') {
        const conditionMet = output === 'true';
        const bodyEnd = Math.min(findIfEndIndex(flow.steps, i), endIndex);
        if (!conditionMet) {
          for (let j = i + 1; j < bodyEnd; j++) {
            emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
            if (depth === 0) progress.completed++;
          }
          if (depth === 0) sendLog(`↪️ [AgentFlow] If condition false — skipped ${Math.max(0, bodyEnd - i - 1)} step(s)`);
          i = bodyEnd - 1;
        }
      }
    } catch (err) {
      if (err instanceof StopFlowSignal) {
        emitLog(onLog, flow.id, step.id, i, 'skipped', undefined, err.message);
        if (depth === 0) sendLog(`⏹️ Step ${i + 1} stopped flow: ${err.message}`);
        for (let j = i + 1; j < flow.steps.length; j++) {
          emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
        }
        if (depth === 0) {
          sendLog(`⏹️ [AgentFlow] Flow "${flow.name}" stopped early (${progress.completed}/${flow.steps.length} steps)`);
          progress.stopped = true;
          return;
        }
        break;
      }

      if (err instanceof BreakLoopSignal || err instanceof ContinueLoopSignal) {
        const kind = err instanceof BreakLoopSignal ? 'break' : 'continue';
        if (depth === 0) {
          // No enclosing loop — nothing to break/continue; log and carry on.
          emitLog(onLog, flow.id, step.id, i, 'skipped', undefined, `${kind} (no loop)`);
          sendLog(`⚠️ [AgentFlow] "${kind}" ignored — not inside a loop`);
          continue;
        }
        emitLog(onLog, flow.id, step.id, i, 'skipped', undefined, kind);
        for (let j = i + 1; j < endIndex; j++) {
          emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
        }
        throw err;
      }

      if (signal?.aborted) {
        emitLog(onLog, flow.id, step.id, i, 'skipped', undefined, 'Aborted by user');
        markAbortedFromHere(flow, i + 1, depth, onLog, progress);
        return;
      }

      const isVerificationChallenge =
        err instanceof Error && err.name === PERPLEXITY_CLOUDFLARE_ERROR_NAME;

      if ((step.type === 'llm' || step.type === 'browser_js' || step.type === 'bot') && step.config.emitFailFlag === 'true' && !isVerificationChallenge) {
        const msg = err instanceof Error ? err.message : String(err);
        if (step.outputKey) {
          context.set(step.outputKey, '');
          context.set(`${step.outputKey}.isFailed`, '1');
        }
        context.set(`${step.id}.output`, '');
        emitLog(onLog, flow.id, step.id, i, 'completed', '', msg);
        if (depth === 0) {
          progress.completed++;
          sendLog(`⚠️ Step ${i + 1} ${step.type} failed (isFailed=1), continuing: ${msg}`);
        }
        continue;
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      emitLog(onLog, flow.id, step.id, i, 'error', undefined, errorMsg);
      if (depth === 0) sendLog(`❌ Step ${i + 1} failed: ${errorMsg}`);

      for (let j = i + 1; j < flow.steps.length; j++) {
        emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
      }

      if (depth === 0) {
        progress.error = `Step "${step.label}" failed: ${errorMsg}`;
        return;
      }
      throw err;
    }
  }
}

export async function executeFlow(
  flow: FlowDefinition,
  deps: FlowExecutorDeps,
  onLog?: LogCallback,
  initialContext?: Record<string, string>,
  signal?: AbortSignal,
): Promise<FlowExecutionResult> {
  const context = new Map<string, string>();

  context.set('clipboard', clipboard.readText());
  context.set('timestamp', new Date().toISOString());
  context.set('flow.name', flow.name);

  if (initialContext) {
    for (const [k, v] of Object.entries(initialContext)) {
      context.set(k, v);
    }
  }

  const progress: RunProgress = { completed: 0, stopped: false, aborted: false };

  sendLog(`▶️ [AgentFlow] Executing flow: ${flow.name} (${flow.steps.length} steps)`);

  await runRange(flow, 0, flow.steps.length, context, deps, onLog, progress, 0, signal);

  if (progress.aborted) {
    return {
      flowId: flow.id,
      success: false,
      aborted: true,
      outputs: Object.fromEntries(context),
      error: 'Aborted by user',
      completedSteps: progress.completed,
      totalSteps: flow.steps.length,
      completedAt: new Date().toISOString(),
    };
  }

  if (progress.error) {
    return {
      flowId: flow.id,
      success: false,
      outputs: Object.fromEntries(context),
      error: progress.error,
      completedSteps: progress.completed,
      totalSteps: flow.steps.length,
      completedAt: new Date().toISOString(),
    };
  }

  if (!progress.stopped) {
    sendLog(`✅ [AgentFlow] Flow "${flow.name}" completed (${progress.completed}/${flow.steps.length} steps)`);
  }

  return {
    flowId: flow.id,
    success: true,
    outputs: Object.fromEntries(context),
    completedSteps: progress.completed,
    totalSteps: flow.steps.length,
    completedAt: new Date().toISOString(),
    finalOutput: progress.finalOutput,
  };
}
