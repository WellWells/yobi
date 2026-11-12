import { FLOW_VAR_PREFIX } from '../../../../../shared/flowVariables';
import { isFileOutputStep } from '../../../../../shared/fileOutputStep';
import { FILE_TRIGGER_NAME_VAR, hasFileTrigger } from '../../../../../shared/flowFileTrigger';
import type { SkillInstance, TriggerConfig } from '../../../../../shared/types';
import { list, stepDisplayName, t } from './core';
import type { StepSummaryContext } from './types';

/** What the steps before one can hand it: the outputs and loop variables in its scope. */
export interface StepScope {
  /** Output name → index of the step that makes it, for outputs still in scope. */
  outputs: ReadonlyMap<string, number>;
  /** Open loops around the step, outermost first. */
  loops: ReadonlyArray<{ name: string; index: number }>;
  /** The latest step in scope whose file is `{{file}}`, or null. */
  fileStep: number | null;
}

interface Frame {
  name: string;
  index: number;
  added: string[];
  fileBefore: number | null;
}

const scopeCache = new WeakMap<readonly SkillInstance[], StepScope[]>();

/**
 * The scope before each step, walked the way the runner and `checkVariableReferences` walk it:
 * an output made inside a loop, and a file made there, are gone after its `end_loop`. One walk
 * per steps array (the store replaces the array on every edit), so a 200-step outline is O(n²)
 * copies once, not per row.
 */
export function flowScopes(steps: readonly SkillInstance[]): StepScope[] {
  const cached = scopeCache.get(steps);
  if (cached) return cached;
  const outputs = new Map<string, number>();
  const frames: Frame[] = [];
  let fileStep: number | null = null;
  const scopes: StepScope[] = [];
  steps.forEach((step, index) => {
    scopes.push({ outputs: new Map(outputs), loops: frames.map(({ name, index: at }) => ({ name, index: at })), fileStep });
    if (step.outputKey) {
      outputs.set(step.outputKey, index);
      frames.at(-1)?.added.push(step.outputKey);
    }
    if (step.type === 'loop') {
      frames.push({ name: (step.config.loopVar ?? '').trim() || 'item', index, added: [], fileBefore: fileStep });
    } else if (step.type === 'end_loop') {
      const frame = frames.pop();
      if (frame) {
        for (const key of frame.added) outputs.delete(key);
        fileStep = frame.fileBefore;
      }
    }
    if (isFileOutputStep(step.type, step.config)) fileStep = index;
  });
  scopeCache.set(steps, scopes);
  return scopes;
}

export function scopeAt(steps: readonly SkillInstance[], index: number): StepScope {
  return flowScopes(steps)[index] ?? { outputs: new Map(), loops: [], fileStep: null };
}

export type RefKind = 'step' | 'loop' | 'file' | 'builtin' | 'variable' | 'missing' | 'outOfScope';

export interface DescribedRef {
  /** "#2 讀取訂閱", "觸發輸入", "流程設定：語言"; the raw `{{ref}}` when it resolves to nothing. */
  text: string;
  resolved: boolean;
  kind: RefKind;
  /** The step it comes from (a step output, a loop's item, a step's file). */
  stepIndex?: number;
}

/** "#4 整理文章": a step by its card number and name. */
export function stepRef(ctx: StepSummaryContext, index: number): string {
  const step = ctx.steps[index];
  return step ? `#${index + 1} ${stepDisplayName(step, ctx.t)}` : `#${index + 1}`;
}

function inputVariables(triggers: readonly TriggerConfig[]): string[] {
  return triggers.flatMap((trigger) => {
    if (trigger.type === 'bot') return [trigger.botInputVariable?.trim() || 'input'];
    if (trigger.type === 'chat') return [trigger.chatInputVariable?.trim() || 'input'];
    return [];
  });
}

/**
 * What a `{{…}}` in this step's fields stands for, in words: the step that makes it (in this
 * step's scope), the loop item, the trigger's input, a flow setting by its name. Without
 * `ctx.triggers` / `ctx.variables` the trigger inputs and settings are taken on trust.
 */
export function describeRef(ref: string, ctx: StepSummaryContext): DescribedRef {
  const name = ref.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const raw = `{{${name}}}`;
  const root = name.split('.')[0];
  const scope = scopeAt(ctx.steps, ctx.index);
  const triggers = ctx.triggers;
  const builtin = (key: string): DescribedRef => ({ text: t(ctx, `flow.summary.ref.${key}`), resolved: true, kind: 'builtin' });
  const notHere: DescribedRef = { text: raw, resolved: false, kind: 'outOfScope' };

  if (name === 'clipboard') return builtin('clipboard');
  if (name === 'timestamp') return builtin('timestamp');
  if (name === 'flow.name') return builtin('flowName');
  if (name === 'selection') return !triggers || triggers.some((tr) => tr.type === 'hotkey') ? builtin('selection') : notHere;
  if (root === 'bot') {
    if (triggers && !triggers.some((tr) => tr.type === 'bot')) return notHere;
    return name === 'bot.triggerChatId' ? builtin('botChat') : builtin('botTrigger');
  }
  if (root === FLOW_VAR_PREFIX) {
    const key = name.slice(FLOW_VAR_PREFIX.length + 1);
    const variable = ctx.variables?.find((item) => item.key === key);
    if (ctx.variables && !variable) return { text: raw, resolved: false, kind: 'missing' };
    return { text: t(ctx, 'flow.summary.ref.variable', { name: variable?.label.trim() || key }), resolved: true, kind: 'variable' };
  }
  const loop = [...scope.loops].reverse().find((frame) => frame.name === root);
  if (loop) return { text: t(ctx, 'flow.summary.ref.loopItem', { step: stepRef(ctx, loop.index) }), resolved: true, kind: 'loop', stepIndex: loop.index };
  if (root === 'file') {
    if (name === FILE_TRIGGER_NAME_VAR) return !triggers || hasFileTrigger([...triggers]) ? builtin('triggerFileName') : notHere;
    if (scope.fileStep !== null) {
      return { text: t(ctx, 'flow.summary.ref.fileOf', { step: stepRef(ctx, scope.fileStep) }), resolved: true, kind: 'file', stepIndex: scope.fileStep };
    }
    return !triggers || hasFileTrigger([...triggers]) ? builtin('triggerFile') : notHere;
  }
  const at = scope.outputs.get(root);
  if (at !== undefined) return { text: stepRef(ctx, at), resolved: true, kind: 'step', stepIndex: at };
  if (triggers ? inputVariables(triggers).includes(name) : name === 'input') return builtin('input');
  if (ctx.steps.some((step) => step.outputKey === root)) return notHere;
  return { text: raw, resolved: false, kind: 'missing' };
}

const REF_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Every `{{…}}` in a text, in order, without repeats. */
export function refsIn(text: string): string[] {
  return [...new Set([...text.matchAll(REF_RE)].map((match) => match[1]))];
}

/** The first reference in these fields that resolves to nothing here, with why. */
export function firstBadRef(ctx: StepSummaryContext, texts: readonly string[]): string | undefined {
  for (const text of texts) {
    for (const ref of refsIn(text)) {
      const described = describeRef(ref, ctx);
      if (described.resolved) continue;
      const raw = `{{${ref}}}`;
      return described.kind === 'outOfScope'
        ? t(ctx, 'flow.summary.issue.refNotHere', { ref: raw })
        : t(ctx, 'flow.summary.issue.missingRef', { ref: raw });
    }
  }
  return undefined;
}

/**
 * "← #3 讀取文章": where a field's data comes from, by the steps and loops it reads (built-ins
 * such as the clipboard count too). Nothing when the field reads nothing.
 */
export function sourceOf(ctx: StepSummaryContext, ...texts: string[]): string | undefined {
  const names: string[] = [];
  for (const text of texts) {
    for (const ref of refsIn(text)) {
      const described = describeRef(ref, ctx);
      if (!described.resolved) continue;
      if (!names.includes(described.text)) names.push(described.text);
    }
  }
  if (names.length === 0) return undefined;
  return t(ctx, 'flow.summary.from', { source: list(ctx, names.slice(0, 2)) + (names.length > 2 ? '…' : '') });
}
