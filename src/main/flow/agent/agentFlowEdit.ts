import type { AgentStageLabel, FlowDefinition } from '../../../shared/types';
import type { RecipientDirectory } from '../../../shared/botRecipients';
import { resolveEditTarget, runFlowEdit } from '../flowEdit';
import type { EditTarget, FlowDiff, FlowRef, StepRef } from '../flowEdit';
import type { FlowExecutorDeps } from '../types';
import { sendLog } from '../../helpers';
import { renderIssueLines, sensitiveTypesOf } from './agentFlowShared';
import type { FlowWriteConfirmRequest } from './agentFlowShared';

/**
 * `/agent`'s `edit_flow`: change a flow the user already has instead of building a second copy
 * of it. Which flow, what changed, and the confirmation are all decided here; the model only
 * says what the user asked for.
 */

export interface FlowEditToolContext {
  deps: FlowExecutorDeps;
  providerUrl: string;
  listFlows?: () => readonly FlowDefinition[];
  replaceFlow?: (flow: FlowDefinition) => Promise<FlowDefinition>;
  /** The flows this conversation made or changed, oldest first; appended to on success. */
  recentFlows: FlowRef[];
  /** The user's own words in this run, read for "send it to me" — never the model's "change". */
  words: string;
  recipients?: RecipientDirectory;
  confirm?: (request: FlowWriteConfirmRequest) => Promise<boolean>;
  onStage?: (label: AgentStageLabel) => void;
}

export interface FlowToolOutcome {
  observation: string;
  status: 'ok' | 'error';
}

const PHASE_STAGE = { understand: 'analyzing', build: 'building', verify: 'verifying' } as const;

function quoted(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(', ');
}

function targetError(query: string, target: Exclude<EditTarget, { kind: 'found' }>): string {
  if (target.candidates.length === 0) {
    return 'ERROR: The user has no saved flows yet. Build one with "build_flow" instead.';
  }
  const lead = target.kind === 'ambiguous'
    ? `"${query}" fits more than one flow.`
    : query ? `No flow is called "${query}".` : 'No flow was made or changed earlier in this conversation, so which one is meant is unclear.';
  return `ERROR: ${lead} Ask the user which one with "ask_user", offering these as choices: ${quoted(target.candidates.map((flow) => flow.name))}. Then call "edit_flow" again with its name in "flow".`;
}

function describeEdit(flow: FlowDefinition, diff: FlowDiff, issues: Parameters<typeof renderIssueLines>[0], paused: boolean): string {
  const labels = (refs: readonly StepRef[]): string => quoted(refs.map((ref) => ref.label));
  const parts = [
    ...(diff.added.length > 0 ? [`added ${labels(diff.added)}`] : []),
    ...(diff.removed.length > 0 ? [`removed ${labels(diff.removed)}`] : []),
    ...(diff.changed.length > 0 ? [`changed ${labels(diff.changed)}`] : []),
    ...(diff.renamedFrom ? [`renamed it from "${diff.renamedFrom}"`] : []),
    ...(diff.trigger ? ['changed when it runs'] : []),
  ];
  const state = paused
    ? 'now DISABLED: it was on, and the change adds a step that acts on the computer, so the user reviews it and switches it back on'
    : flow.enabled ? 'still ENABLED — the change applies from its next run' : 'still DISABLED, as it was';
  return [
    `Saved the change to the flow "${flow.name}": ${parts.join('; ')}. It is ${state}.`,
    ...renderIssueLines(issues),
    'Tell the user what changed — do not change it again or build a new flow.',
  ].join('\n');
}

export async function runEditFlowTool(config: Record<string, string>, ctx: FlowEditToolContext): Promise<FlowToolOutcome> {
  const change = (config.change ?? '').trim();
  if (!change) return { observation: 'ERROR: "change" is required.', status: 'error' };
  if (!ctx.listFlows || !ctx.replaceFlow) {
    return { observation: 'ERROR: This run cannot change saved flows. Tell the user they can change it in the flow editor.', status: 'error' };
  }
  const query = (config.flow ?? '').trim();
  const target = resolveEditTarget(query, ctx.listFlows(), ctx.recentFlows);
  if (target.kind !== 'found') return { observation: targetError(query, target), status: 'error' };

  const original = target.flow;
  const outcome = await runFlowEdit({
    flow: original,
    change,
    deps: ctx.deps,
    save: ctx.replaceFlow,
    words: ctx.words,
    ...(ctx.providerUrl ? { providerUrl: ctx.providerUrl } : {}),
    ...(ctx.recipients ? { recipients: ctx.recipients } : {}),
    onPhase: (phase) => ctx.onStage?.(PHASE_STAGE[phase]),
    confirm: async (next, diff, recipients, paused) => {
      if (!ctx.confirm) return false;
      ctx.onStage?.('confirming');
      return ctx.confirm({
        kind: 'flow',
        flowName: next.name,
        stepTypes: next.steps.map((step) => String(step.type)),
        ...(recipients.length > 0 ? { recipients } : {}),
        // Only what this change adds or rewrites: the steps it leaves alone were approved before.
        sensitiveTypes: sensitiveTypesOf([...diff.added, ...diff.changed].map((ref) => ref.type)),
        edit: {
          added: diff.added,
          removed: diff.removed,
          changed: diff.changed,
          ...(diff.renamedFrom ? { renamedFrom: diff.renamedFrom } : {}),
          trigger: diff.trigger,
          enabled: next.enabled,
          ...(paused ? { paused } : {}),
        },
      });
    },
  });

  switch (outcome.status) {
    case 'questions': {
      const list = outcome.questions.map((question, index) => `${index + 1}. ${question}`).join(' ');
      return {
        observation: `ERROR: Before "${original.name}" can be changed: ${list} Ask the user with "ask_user" and wait for their answer, then call "edit_flow" again with it in "change". Do not choose for them.`,
        status: 'error',
      };
    }
    case 'unchanged':
      return { observation: 'ERROR: The revised flow came out the same as the saved one, so nothing was saved. Ask the user what exactly should change.', status: 'error' };
    case 'declined':
      return { observation: 'ERROR: The user declined these changes. Do not retry — ask what they want changed instead, or finish.', status: 'error' };
    case 'failed':
      return { observation: `ERROR: ${outcome.error}`, status: 'error' };
    case 'saved':
      ctx.recentFlows.push({ id: outcome.flow.id, name: outcome.flow.name });
      sendLog(`🧩 [Agent] changed flow "${outcome.flow.name}"`);
      return { observation: describeEdit(outcome.flow, outcome.diff, outcome.issues, outcome.paused), status: 'ok' };
  }
}
