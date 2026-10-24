import type { FlowIssue } from '../../../../shared/flowIssues';
import { fillTemplate } from '../../../../shared/fillTemplate';

/** Matches how the main process joins variable names in its own log lines. */
const JOIN = ', ';

/**
 * The key is finished inside the `t()` call on purpose: `scripts/i18n-check.ts`
 * only registers a dynamic prefix when it sees `` t(`prefix${ ``, and would
 * otherwise delete every `flow.issue.*` key it cannot match literally.
 */
function issueSuffix(issue: FlowIssue): string {
  if (issue.kind !== 'commandDuplicate') return issue.kind;
  return issue.wins ? 'duplicate.wins' : 'duplicate.loses';
}

// Flow and connector names are the user's own text, so they go in through fillTemplate.
export function describeFlowIssue(issue: FlowIssue, t: (k: string) => string): string {
  return fillTemplate(t(`flow.issue.${issueSuffix(issue)}`), {
    scope: issue.scope ? t(`flow.issue.scope.${issue.scope}`) : '',
    command: issue.command ?? '',
    others: (issue.otherNames ?? []).join(JOIN),
    names: (issue.varNames ?? []).join(JOIN),
    folder: issue.folder ?? '',
  });
}
