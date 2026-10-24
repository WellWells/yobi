import type { AgentFlowRecipient, AgentPendingFlowHold, AgentStageLabel, FlowDefinition } from '../../../shared/types';
import type { RecipientDirectory } from '../../../shared/botRecipients';
import { resolveEditTarget, runFlowEdit } from '../flowEdit';
import type { FlowEditOutcome } from '../flowEdit';
import type { EditTarget, FlowRef } from '../flowEdit';
import type { FlowExecutorDeps } from '../types';
import { sendLog } from '../../helpers';
import { describeSavedEdit, holdingSave, ownerOnlyReason, sensitiveTypesOf } from './agentFlowShared';
import type { FlowHold, FlowSaveRequest, FlowWriteConfirmRequest } from './agentFlowShared';

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
  /** A bot admin's run: the revised flow is held for their answer in the chat instead of saved. */
  hold?: FlowHold;
  onStage?: (label: AgentStageLabel) => void;
}

export interface FlowToolOutcome {
  observation: string;
  status: 'ok' | 'error';
  /** Nothing was saved: the revised flow waits for the user's answer in the chat. */
  deferred?: FlowSaveRequest;
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

/**
 * A held change as the engine puts it to the user. An admin who is not the owner gets an enabled
 * flow switched off whenever the flow reads the owner's data or acts as the owner (`ownerOnlyReason`)
 * — judged on the whole revised flow, triggers included, not on what the change touches: pointing an
 * existing LINE digest's bot step at themselves changes only the bot step, and turning a flow's
 * trigger into a watched folder changes no step at all, yet either hands them the owner's data from
 * the next run. The owner switches it back on.
 */
function heldEdit(original: FlowDefinition, outcome: Extract<FlowEditOutcome, { status: 'saved' }>, hold: FlowHold, recipients: AgentFlowRecipient[]): FlowSaveRequest {
  const { diff } = outcome;
  const ownerPause = !outcome.paused && outcome.flow.enabled ? ownerOnlyReason(outcome.flow, hold) : undefined;
  const flow = ownerPause ? { ...outcome.flow, enabled: false } : outcome.flow;
  const off: AgentPendingFlowHold | undefined = outcome.paused ? 'sensitive' : ownerPause;
  sendLog(`🧩 [Agent] holding the change to "${flow.name}" for the user's answer in the chat`);
  return {
    kind: 'flowSave',
    pending: {
      mode: 'edit',
      flow,
      issues: outcome.issues,
      baseUpdatedAt: original.updatedAt,
      diff: {
        added: diff.added, removed: diff.removed, changed: diff.changed, trigger: diff.trigger,
        ...(diff.renamedFrom ? { renamedFrom: diff.renamedFrom } : {}),
      },
      ...(off ? { off, paused: true } : {}),
    },
    recipients,
    sensitiveTypes: sensitiveTypesOf([...diff.added, ...diff.changed].map((ref) => ref.type)),
  };
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
  const holding = ctx.hold ? holdingSave() : null;
  let heldRecipients: AgentFlowRecipient[] = [];
  const outcome = await runFlowEdit({
    flow: original,
    change,
    deps: ctx.deps,
    save: holding?.save ?? ctx.replaceFlow,
    words: ctx.words,
    ...(ctx.providerUrl ? { providerUrl: ctx.providerUrl } : {}),
    ...(ctx.recipients ? { recipients: ctx.recipients } : {}),
    onPhase: (phase) => ctx.onStage?.(PHASE_STAGE[phase]),
    confirm: async (next, diff, recipients, paused) => {
      // Held, not confirmed: the question in the chat is the confirmation, asked after the run pauses.
      if (holding) {
        heldRecipients = recipients;
        return true;
      }
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
      if (holding && ctx.hold) return { observation: '', status: 'ok', deferred: heldEdit(original, outcome, ctx.hold, heldRecipients) };
      ctx.recentFlows.push({ id: outcome.flow.id, name: outcome.flow.name });
      sendLog(`🧩 [Agent] changed flow "${outcome.flow.name}"`);
      return { observation: describeSavedEdit(outcome.flow, outcome.diff, outcome.issues, outcome.paused), status: 'ok' };
  }
}
