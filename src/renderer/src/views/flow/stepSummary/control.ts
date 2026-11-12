import { OUTPUT_KEY_RE } from '../../../../../shared/flowValidation';
import { cut, flagged, isNamed, ok, outputPart, parts, t, unset, value, wholeRef } from './core';
import { refsIn, sourceOf } from './refs';
import { innermostLoop, placeOf, type StepPlace } from './structure';
import type { StepSummary, StepSummaryContext, Summarizer } from './types';

const IF_OPERATORS = new Set(['is_true', 'is_false', 'equals', 'not_equals', 'contains', 'is_empty']);
const NEEDS_RIGHT = new Set(['equals', 'not_equals', 'contains']);
/** Names the runner already gives a meaning: a loop variable called one of these hides it. */
export const RESERVED_NAMES = new Set(['clipboard', 'timestamp', 'selection', 'input', 'file', 'var', 'bot', 'flow']);

function at(ctx: StepSummaryContext, index: number): StepSummaryContext {
  return { ...ctx, index };
}

/** What an opener reads as: the name the user gave it, else what it does. */
function blockName(ctx: StepSummaryContext, index: number): string {
  const step = ctx.steps[index];
  if (isNamed(step, ctx.t)) return step.label.trim();
  return step.type === 'loop' ? loopWhat(step.config, at(ctx, index)) : ifWhat(step.config, at(ctx, index)) ?? t(ctx, 'flow.skill.if');
}

function loopWhat(config: Record<string, string>, ctx: StepSummaryContext): string {
  const input = (config.input ?? '').trim();
  return input ? t(ctx, 'flow.summary.loop.each', { input: cut(input, 32) }) : t(ctx, 'flow.skill.loop');
}

function ifWhat(config: Record<string, string>, ctx: StepSummaryContext): string | null {
  const left = (config.left ?? '').trim();
  if (!left) return null;
  const operator = IF_OPERATORS.has(config.operator ?? '') ? config.operator : 'is_true';
  const vars = { left: cut(left, 32), op: t(ctx, `flow.skill.if.op.${operator}`), right: cut(config.right ?? '', 24) };
  return t(ctx, NEEDS_RIGHT.has(operator) ? 'flow.summary.if.compare' : 'flow.summary.if.test', vars);
}

function structureIssue(ctx: StepSummaryContext, place: StepPlace, type: string): string | undefined {
  const issue = place.issue;
  if (!issue) return undefined;
  const loopish = type === 'loop' || type === 'end_loop';
  switch (issue.kind) {
    case 'unclosed': return t(ctx, loopish ? 'flow.summary.block.unclosedLoop' : 'flow.summary.block.unclosedIf');
    case 'unmatched': return t(ctx, loopish ? 'flow.summary.block.unmatchedLoop' : 'flow.summary.block.unmatchedIf');
    case 'crossed': return t(ctx, loopish ? 'flow.summary.block.crossedLoop' : 'flow.summary.block.crossedIf', { step: `#${issue.open + 1}` });
    case 'outsideLoop': return t(ctx, 'flow.summary.block.outsideLoop');
  }
}

function withStructure(ctx: StepSummaryContext, summary: StepSummary, type: string): StepSummary {
  const issue = structureIssue(ctx, placeOf(ctx.steps, ctx.index), type);
  return issue ? flagged(summary, 'error', issue) : summary;
}

const loop: Summarizer = (step, ctx) => {
  const variable = value(step, 'loopVar') || 'item';
  const token = `{{${variable}}}`;
  const input = value(step, 'input');
  if (!input) return withStructure(ctx, unset(ctx, 'loop', ['input'], t(ctx, 'flow.summary.loop.var', { name: token })), 'loop');
  const limit = step.config.limitIterations === 'false'
    ? t(ctx, 'flow.summary.loop.noLimit')
    : t(ctx, 'flow.summary.loop.max', { count: value(step, 'maxIterations') || '5' });
  const what = loopWhat(step.config, ctx);
  const detail = parts(sourceOf(ctx, input), limit, token);
  const summary = isNamed(step, ctx.t) ? ok(step.label.trim(), parts(what, detail)) : ok(what, detail);
  if (!OUTPUT_KEY_RE.test(variable) || RESERVED_NAMES.has(variable)) {
    return flagged(summary, 'error', t(ctx, 'flow.summary.loop.badVar', { name: variable }));
  }
  return withStructure(ctx, summary, 'loop');
};

/** `└ 結束「逐篇處理」`: an end marker by the block it closes. */
function endMarker(type: 'end_loop' | 'end_if'): Summarizer {
  return (_step, ctx) => {
    const place = placeOf(ctx.steps, ctx.index);
    if (place.partner === null) {
      return withStructure(ctx, ok(t(ctx, `flow.skill.${type}`)), type);
    }
    return ok(t(ctx, 'flow.summary.end', { name: blockName(ctx, place.partner) }), `#${place.partner + 1}`);
  };
}

function ifRange(ctx: StepSummaryContext): string | undefined {
  const end = placeOf(ctx.steps, ctx.index).partner;
  if (end === null) return undefined;
  const from = ctx.index + 2;
  const to = end;
  if (to < from) return t(ctx, 'flow.summary.if.emptyRange');
  return to === from ? t(ctx, 'flow.summary.if.runsOne', { step: `#${from}` }) : t(ctx, 'flow.summary.if.runs', { from: `#${from}`, to: `#${to}` });
}

const ifStep: Summarizer = (step, ctx) => {
  const what = ifWhat(step.config, ctx);
  if (!what) return withStructure(ctx, unset(ctx, 'if', ['left'], ifRange(ctx)), 'if');
  const detail = parts(sourceOf(ctx, value(step, 'left'), value(step, 'right')), ifRange(ctx));
  return withStructure(ctx, isNamed(step, ctx.t) ? ok(step.label.trim(), parts(what, detail)) : ok(what, detail), 'if');
};

const onChange: Summarizer = (step, ctx) => {
  const watched = value(step, 'value');
  if (!watched) return unset(ctx, 'on_change', ['value'], outputPart(ctx, step));
  const refs = refsIn(watched).map((ref) => `{{${ref}}}`);
  const what = t(ctx, 'flow.summary.onChange.what', { value: refs.length > 0 ? refs.join(t(ctx, 'flow.summary.sep')) : cut(watched.replace(/\s+/g, ' '), 32) });
  const detail = parts(
    sourceOf(ctx, watched),
    step.config.withDiff === 'true' ? t(ctx, 'flow.summary.onChange.diff') : undefined,
    outputPart(ctx, step),
  );
  const summary = isNamed(step, ctx.t) ? ok(step.label.trim(), parts(what, detail)) : ok(what, detail);
  return innermostLoop(ctx.steps, ctx.index) === null ? summary : flagged(summary, 'warning', t(ctx, 'flow.summary.onChange.inLoop'));
};

/** "當 #8 如果 … 為真": the innermost condition inside the innermost loop, which decides when it runs. */
function condition(ctx: StepSummaryContext, loopIndex: number): string | undefined {
  const guard = [...placeOf(ctx.steps, ctx.index).enclosing].reverse().find((block) => block.type === 'if' && block.index > loopIndex);
  return guard ? t(ctx, 'flow.summary.when', { step: `#${guard.index + 1}`, condition: blockName(ctx, guard.index) }) : undefined;
}

function loopExit(kind: 'break' | 'continue'): Summarizer {
  return (_step, ctx) => {
    const loopIndex = innermostLoop(ctx.steps, ctx.index);
    if (loopIndex === null) return withStructure(ctx, ok(t(ctx, `flow.skill.${kind}`)), kind);
    const summary = ok(t(ctx, `flow.summary.exit.${kind}`, { name: blockName(ctx, loopIndex) }), condition(ctx, loopIndex));
    const next = ctx.steps[ctx.index + 1];
    if (kind === 'continue' && next?.type === 'end_loop' && placeOf(ctx.steps, ctx.index + 1).partner === loopIndex) {
      return flagged(summary, 'warning', t(ctx, 'flow.summary.continue.last'));
    }
    return summary.secondary ? summary : flagged(summary, 'warning', t(ctx, `flow.summary.unguarded.${kind}`));
  };
}

const stop: Summarizer = (step, ctx) => {
  const checked = value(step, 'value');
  if (!checked) return unset(ctx, 'stop', ['value']);
  const loopIndex = innermostLoop(ctx.steps, ctx.index);
  const shown = wholeRef(checked) ? checked : cut(checked, 32);
  const what = t(ctx, loopIndex === null ? 'flow.summary.stop.flow' : 'flow.summary.stop.item', { value: shown });
  const detail = parts(
    loopIndex === null ? undefined : t(ctx, 'flow.summary.stop.inLoop', { name: blockName(ctx, loopIndex) }),
    sourceOf(ctx, checked),
  );
  return isNamed(step, ctx.t) ? ok(step.label.trim(), parts(what, detail)) : ok(what, detail);
};

export const CONTROL_SUMMARIES = {
  loop, end_loop: endMarker('end_loop'), if: ifStep, end_if: endMarker('end_if'), on_change: onChange,
  break: loopExit('break'), continue: loopExit('continue'), stop,
} as const;
