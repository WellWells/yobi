import type { FlowIssue } from '../../../../shared/flowIssues';

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

export function describeFlowIssue(issue: FlowIssue, t: (k: string) => string): string {
  return t(`flow.issue.${issueSuffix(issue)}`)
    .replace('{{scope}}', issue.scope ? t(`flow.issue.scope.${issue.scope}`) : '')
    .replace('{{command}}', issue.command ?? '')
    .replace('{{others}}', (issue.otherNames ?? []).join(JOIN))
    .replace('{{names}}', (issue.varNames ?? []).join(JOIN));
}
