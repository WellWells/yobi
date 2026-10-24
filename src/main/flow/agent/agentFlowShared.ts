import type {
  AgentFlowEditSummary, AgentFlowRecipient, AgentPendingFlow, AgentPendingFlowHold, FlowBuildIssue, FlowDefinition, SkillType,
} from '../../../shared/types';
import { actsAsOwner, flowReadsOwnerData } from '../../../shared/botCommandAccess';
import { SENSITIVE_STEP_TYPES } from '../flowRevision';

/**
 * What `build_flow` and `edit_flow` share: the confirmation they ask for, which steps make that
 * confirmation a warning, how the issues found in a saved flow are put to the model, and how a bot
 * admin's run holds a finished flow for their answer in the chat instead of saving it.
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

/**
 * A bot admin's run (`holdFlows`). Nobody is at the desk to answer the save dialog, so the finished
 * flow is held, put to them as a question in the chat, and saved — exactly as held — when the
 * answer approves it. `owner`: the person asking is the owner ("me"); another admin's flow that
 * reads the owner's data is saved switched off, for the owner to look at first.
 */
export interface FlowHold {
  owner: boolean;
}

/** A held flow handed from `build_flow` / `edit_flow` to the engine, which pauses the run on it. */
export interface FlowSaveRequest {
  kind: 'flowSave';
  pending: AgentPendingFlow;
  /** Who its bot steps send to, by name — for the question only, never for the model. */
  recipients: AgentFlowRecipient[];
  sensitiveTypes: string[];
}

/** Issues that make a flow fail on its first run; the others are worth reading but do not stop it. */
const ISSUES_THAT_HOLD = new Set<FlowBuildIssue['kind']>(['blank', 'setup', 'recipient']);

/**
 * Why an admin who is not the owner may not switch this flow on, judged on the whole flow: it reads
 * the owner's data (a step, or a trigger watching one of the owner's folders), or it acts as the
 * owner (writes to their disk, mails from their account, calls out from their network). Undefined
 * for the owner, or for a flow with neither.
 */
export function ownerOnlyReason(flow: FlowDefinition, hold: FlowHold): 'ownerData' | 'ownerActs' | undefined {
  if (hold.owner) return undefined;
  if (flowReadsOwnerData(flow)) return 'ownerData';
  if (actsAsOwner(flow.steps)) return 'ownerActs';
  return undefined;
}

/** Why a new flow approved from the chat is still saved switched off, or undefined to switch it on. */
export function buildHoldReason(flow: FlowDefinition, issues: readonly FlowBuildIssue[], hold: FlowHold): AgentPendingFlowHold | undefined {
  if (sensitiveTypesOf(flow.steps.map((step) => String(step.type))).length > 0) return 'sensitive';
  const ownerOnly = ownerOnlyReason(flow, hold);
  if (ownerOnly) return ownerOnly;
  if (issues.some((issue) => ISSUES_THAT_HOLD.has(issue.kind))) return 'issues';
  return undefined;
}

/** A `save` that keeps the finished flow instead of writing it: what a held build or edit passes down. */
export function holdingSave(): { save: (flow: FlowDefinition) => Promise<FlowDefinition>; held: () => FlowDefinition | null } {
  let kept: FlowDefinition | null = null;
  return {
    save: async (flow) => {
      kept = flow;
      return flow;
    },
    held: () => kept,
  };
}

/** How a new flow ended up: off for review (the desktop), on as approved, or off for a reason. */
export type SavedFlowState = { how: 'review' } | { how: 'on' } | { how: 'off'; why: AgentPendingFlowHold | 'settings' };

const OFF_REASON: Record<AgentPendingFlowHold | 'settings', string> = {
  sensitive: 'it has steps that act on the computer, which the user reviews on the desktop before switching it on',
  ownerData: 'it reads the owner\'s own data, and only the owner switches such a flow on, from the desktop',
  ownerActs: 'it writes to the owner\'s computer or sends with the owner\'s accounts or network, and only the owner switches such a flow on, from the desktop',
  issues: 'something in it still has to be filled in (below), on the desktop',
  settings: 'it needs settings filled in before it can run, on the desktop',
};

/**
 * What the model is allowed to say about the flow it just saved. The issues are here because the
 * alternative — a cheerful "done!" over a flow with an empty feed URL — is the same class of
 * false claim `withActionFooter` exists to stop one layer down.
 */
export function describeSavedFlow(flow: FlowDefinition, issues: readonly FlowBuildIssue[], state: SavedFlowState = { how: 'review' }): string {
  const steps = flow.steps.map((step) => step.type as SkillType);
  const shown = steps.slice(0, 12).join(' → ');
  const more = steps.length > 12 ? ` (+${steps.length - 12} more)` : '';
  const lead = `Saved the flow "${flow.name}" with ${steps.length} step(s)`;
  const saved = state.how === 'review'
    ? `${lead}, DISABLED for the user to review: ${shown}${more}.`
    : state.how === 'on'
      ? `${lead} and switched it ON, as the user approved — it runs by itself from now on: ${shown}${more}.`
      : `${lead} and left it OFF: ${OFF_REASON[state.why]}. Steps: ${shown}${more}.`;
  const where = state.how === 'on' ? 'Tell the user it is on and what it will do' : 'Tell the user it is waiting in the flow list and what it will do';
  return [
    saved,
    ...renderIssueLines(issues),
    `${where} — do not build it again; to change it, use "edit_flow".`,
  ].join('\n');
}

type DiffLabels = Pick<AgentFlowEditSummary, 'renamedFrom' | 'trigger'> & Record<'added' | 'removed' | 'changed', ReadonlyArray<{ label: string }>>;

function quoted(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(', ');
}

/** What the model is told about a change it saved; `pausedWhy` says why an enabled flow was switched off. */
export function describeSavedEdit(
  flow: FlowDefinition,
  diff: DiffLabels,
  issues: readonly FlowBuildIssue[],
  paused: boolean,
  pausedWhy: AgentPendingFlowHold = 'sensitive',
): string {
  const labels = (refs: ReadonlyArray<{ label: string }>): string => quoted(refs.map((ref) => ref.label));
  const parts = [
    ...(diff.added.length > 0 ? [`added ${labels(diff.added)}`] : []),
    ...(diff.removed.length > 0 ? [`removed ${labels(diff.removed)}`] : []),
    ...(diff.changed.length > 0 ? [`changed ${labels(diff.changed)}`] : []),
    ...(diff.renamedFrom ? [`renamed it from "${diff.renamedFrom}"`] : []),
    ...(diff.trigger ? ['changed when it runs'] : []),
  ];
  const why = pausedWhy === 'ownerData'
    ? 'the flow reads the owner\'s data, so the owner reviews it and switches it back on'
    : pausedWhy === 'ownerActs'
      ? 'the flow writes to the owner\'s computer or sends with the owner\'s accounts or network, so the owner reviews it and switches it back on'
      : 'the change adds a step that acts on the computer, so the user reviews it and switches it back on';
  const state = paused
    ? `now DISABLED: it was on, and ${why}`
    : flow.enabled ? 'still ENABLED — the change applies from its next run' : 'still DISABLED, as it was';
  return [
    `Saved the change to the flow "${flow.name}": ${parts.join('; ')}. It is ${state}.`,
    ...renderIssueLines(issues),
    'Tell the user what changed — do not change it again or build a new flow.',
  ].join('\n');
}
