import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { SkillInstance } from '../../../../../shared/types';
import { stepDisplayName } from '../stepSummary';
import type { GuardBlock, OutlineRow } from './outlineModel';

/**
 * What a closed guard's condition says under its name, in the editor and the outline alike:
 * "成立時：略過這一輪「逐篇處理」" (the skip's own summary, `flow.summary.exit.*`).
 */
export function guardTexts(
  rows: readonly OutlineRow[],
  guards: ReadonlyMap<string, GuardBlock>,
  steps: readonly SkillInstance[],
  t: (key: string) => string,
): Map<string, string> {
  const texts = new Map<string, string>();
  if (guards.size === 0) return texts;
  const byId = new Map(steps.map((step) => [step.id, step]));
  const ownerOf = new Map(rows.map((row) => [row.step.id, row.owner]));
  guards.forEach((guard, id) => {
    const loopId = ownerOf.get(guard.action.id);
    const loop = loopId ? byId.get(loopId) : undefined;
    const action = fillTemplate(t(`flow.summary.exit.${guard.action.type}`), { name: loop ? stepDisplayName(loop, t) : '' });
    texts.set(id, fillTemplate(t('flow.step.guard.then'), { action }));
  });
  return texts;
}
