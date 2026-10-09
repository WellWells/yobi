import type { AgentFlowEditSummary, AgentFlowRecipient, FlowBuildIssue } from '../../../shared/types';
import { SENSITIVE_STEP_TYPES } from '../flowRevision';

/**
 * What `build_flow` and `edit_flow` share: the confirmation they ask for, which steps make that
 * confirmation a warning, and how the issues found in a saved flow are put to the model.
 */

export interface FlowWriteConfirmRequest {
  kind: 'flow';
  flowName: string;
  stepTypes: string[];
  sensitiveTypes: string[];
  /** Present when a saved flow is being changed rather than a new one built. */
  edit?: AgentFlowEditSummary;
  /** Who the bot steps send to. The recipients come from the model's wording, so the user sees them here. */
  recipients?: AgentFlowRecipient[];
}

export function sensitiveTypesOf(types: readonly string[]): string[] {
  return [...new Set(types.filter((type) => SENSITIVE_STEP_TYPES.has(type)))];
}

const ISSUE_TEXT: Record<FlowBuildIssue['kind'], (issue: FlowBuildIssue) => string> = {
  blank: (issue) => `step ${issue.step} (${issue.skill}) has no "${issue.detail}" — the user has to fill it in`,
  failsoft: (issue) => `step ${issue.step} (${issue.skill}) runs in a loop without fail-soft`,
  setup: (issue) => `step ${issue.step} (${issue.skill}) needs ${issue.detail} to be set up first`,
  recipient: (issue) => `step ${issue.step} (${issue.skill}) sends to "${issue.detail}", which matches no paired chat or several — the user picks the recipient in that step`,
  broadcast: (issue) => `step ${issue.step} (${issue.skill}) sends to all ${issue.detail} paired people — say so, in case they meant only themself`,
};

/** The "must say so" block: without it, a cheerful "done!" over a flow that will not work is the reply. */
export function renderIssueLines(issues: readonly FlowBuildIssue[]): string[] {
  if (issues.length === 0) return [];
  return [
    'Needs the user to check, and you must say so rather than report plain success:',
    ...issues.slice(0, 6).map((issue) => `- ${ISSUE_TEXT[issue.kind](issue)}`),
  ];
}
