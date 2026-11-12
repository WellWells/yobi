import { findReferenceIssues } from '../../../../../shared/flowReferenceCheck';
import { isShareLinkFormat } from '../../../../../shared/shareFormat';
import type { FlowDefinition } from '../../../../../shared/types';

/** What a share step sets only when it makes a file; a link leaves them empty. */
const FILE_ONLY_FIELDS = new Set(['path', 'format', 'fellBack', 'zipped']);
const VAR_REF_RE = /\{\{([^{}]+)\}\}/g;

/**
 * The later steps (card numbers) that use what a share step set to "share link" no longer makes:
 * its file path (`{{share_1.path}}` and the other file-only sub-fields) or the `{{file}}` it would
 * have been. `{{file}}` is judged by `findReferenceIssues`, with the step as a PDF and as it is, so
 * the editor's reference check and this warning read one rule.
 */
export function stepsLosingShareFile(flow: Pick<FlowDefinition, 'steps' | 'trigger' | 'extraTriggers' | 'variables'>, stepId: string): number[] {
  const index = flow.steps.findIndex((s) => s.id === stepId);
  const step = flow.steps[index];
  if (!step || step.type !== 'share' || !isShareLinkFormat(step.config.format)) return [];
  const hit = new Set<number>();
  const key = step.outputKey.trim();
  flow.steps.forEach((later, i) => {
    if (i <= index || !key) return;
    const uses = Object.values(later.config).some((value) => [...value.matchAll(VAR_REF_RE)].some((match) => {
      const [root, field] = match[1]!.trim().split('.');
      return root === key && field !== undefined && FILE_ONLY_FIELDS.has(field);
    }));
    if (uses) hit.add(i + 1);
  });
  const triggers = [flow.trigger, ...(flow.extraTriggers ?? [])];
  const missingFile = (steps: FlowDefinition['steps']): Set<number> => new Set(
    findReferenceIssues(steps, triggers, flow.variables ?? [])
      .filter((issue) => issue.reason === 'fileMissing' && issue.stepIndex > index)
      .map((issue) => issue.stepIndex),
  );
  const asFile = flow.steps.map((s) => (s.id === stepId ? { ...s, config: { ...s.config, format: 'pdf' } } : s));
  const withFile = missingFile(asFile);
  for (const i of missingFile(flow.steps)) if (!withFile.has(i)) hit.add(i + 1);
  return [...hit].sort((a, b) => a - b);
}
