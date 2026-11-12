import { showAppNotice } from '../../hooks/useUiNotifications';
import { useFlowStore } from '../../store/useFlowStore';
import { fillTemplate } from '../../../../shared/fillTemplate';
import type { SkillInstance } from '../../../../shared/types';
import { outlineRows } from './outline/outlineModel';
import { stepDisplayName } from './stepSummary';

/** The loop or condition a step is directly inside, or undefined at the top level. */
export function enclosingBlock(steps: readonly SkillInstance[], stepId: string): string | undefined {
  const row = outlineRows(steps).find((r) => r.step.id === stepId);
  return row?.ancestors[row.ancestors.length - 1];
}

/**
 * What a move did to where a step runs, when it changed: into a loop (it now runs once per item)
 * or a condition, or out of one. Undefined when the step stayed in the same block.
 */
export function scopeChange(
  before: readonly SkillInstance[],
  after: readonly SkillInstance[],
  stepId: string,
): { kind: 'into' | 'outOf'; blockId: string } | undefined {
  const was = enclosingBlock(before, stepId);
  const now = enclosingBlock(after, stepId);
  if (was === now) return undefined;
  // Deeper now: it went into `now`; otherwise it left `was`.
  const depth = (steps: readonly SkillInstance[]): number => outlineRows(steps).find((r) => r.step.id === stepId)?.depth ?? 0;
  if (now && depth(after) > depth(before)) return { kind: 'into', blockId: now };
  if (was) return { kind: 'outOf', blockId: was };
  return now ? { kind: 'into', blockId: now } : undefined;
}

/** Says so after a move (the buttons or a drag) took a step into or out of a loop or condition. */
export function noteScopeChange(flowId: string, stepId: string, before: readonly SkillInstance[], t: (key: string) => string): void {
  const after = useFlowStore.getState().flows.find((flow) => flow.id === flowId)?.steps;
  if (!after) return;
  const change = scopeChange(before, after, stepId);
  if (!change) return;
  const block = after.find((step) => step.id === change.blockId) ?? before.find((step) => step.id === change.blockId);
  if (!block) return;
  const loop = block.type === 'loop';
  const text = change.kind === 'into'
    ? t(loop ? 'flow.step.moved.into.loop' : 'flow.step.moved.into.if')
    : t(loop ? 'flow.step.moved.outOf.loop' : 'flow.step.moved.outOf.if');
  showAppNotice({ level: 'info', message: fillTemplate(text, { name: stepDisplayName(block, t) }) });
}
