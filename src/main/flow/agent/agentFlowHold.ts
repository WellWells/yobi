import type { AgentPendingFlow, FlowDefinition } from '../../../shared/types';
import type { FlowRef } from '../flowEdit';
import { sendLog } from '../../helpers';
import { buildHoldReason, describeSavedEdit, describeSavedFlow, ownerOnlyReason } from './agentFlowShared';
import type { FlowHold, SavedFlowState } from './agentFlowShared';

/**
 * Saves a flow a bot admin approved in the chat: the flow held on the run when the question was
 * asked, never one rebuilt after the answer. A new flow is switched on unless it was held off; a
 * change is written over the saved flow only if nothing else saved it since the change was made.
 *
 * Why it stays off is worked out again here, for the person answering now: a question asked by an
 * older build, before a check existed, must not switch on a flow that check would keep off.
 */

export interface HeldFlowContext {
  saveFlow?: (flow: FlowDefinition) => Promise<FlowDefinition>;
  replaceFlow?: (flow: FlowDefinition) => Promise<FlowDefinition>;
  enableFlow?: (flowId: string) => Promise<FlowDefinition | null>;
  listFlows?: () => readonly FlowDefinition[];
  /** Appended to on success: what a later "change it" in this conversation refers to. */
  recentFlows?: FlowRef[];
  /** Who is answering, read again on this resume. */
  holdFlows?: FlowHold;
}

export interface HeldFlowOutcome {
  observation: string;
  status: 'ok' | 'error';
}

/**
 * The flow as an admin's answer saves it. One who is not the owner gets it marked to read the public
 * web only: a page step pointed at the router or a NAS would otherwise post it to them every run.
 */
function asSavedBy(flow: FlowDefinition, ctx: HeldFlowContext): FlowDefinition {
  return ctx.holdFlows?.owner === true ? flow : { ...flow, publicWebOnly: true };
}

async function commitBuild(pending: AgentPendingFlow, ctx: HeldFlowContext): Promise<HeldFlowOutcome> {
  if (!ctx.saveFlow) return { observation: 'ERROR: This run cannot save flows. Tell the user to save it from the desktop.', status: 'error' };
  const off = pending.off ?? (ctx.holdFlows ? buildHoldReason(pending.flow, pending.issues, ctx.holdFlows) : undefined);
  let saved = await ctx.saveFlow(asSavedBy(pending.flow, ctx));
  let state: SavedFlowState = off ? { how: 'off', why: off } : { how: 'off', why: 'settings' };
  if (!off && ctx.enableFlow) {
    // Read back rather than assumed: a flow missing a required setting stays off.
    const enabled = await ctx.enableFlow(saved.id);
    if (enabled?.enabled) {
      saved = enabled;
      state = { how: 'on' };
    }
  }
  ctx.recentFlows?.push({ id: saved.id, name: saved.name });
  sendLog(`🧩 [Agent] saved the approved flow "${saved.name}" (${state.how === 'on' ? 'on' : 'off'})`);
  return { observation: describeSavedFlow(saved, pending.issues, state), status: 'ok' };
}

async function commitEdit(pending: AgentPendingFlow, ctx: HeldFlowContext): Promise<HeldFlowOutcome> {
  const current = ctx.listFlows?.().find((flow) => flow.id === pending.flow.id);
  if (!current || !ctx.replaceFlow) {
    return { observation: 'ERROR: That flow no longer exists, so the change was not saved. Tell the user — do not build a new one unasked.', status: 'error' };
  }
  // The approval covered a change to the flow as it was then. Saved since (on the desktop, or by an
  // earlier answer), writing this over it would silently throw that save away.
  if (pending.baseUpdatedAt && current.updatedAt !== pending.baseUpdatedAt) {
    return {
      observation: `ERROR: "${current.name}" was saved again after this change was made, so the change was not saved over it. Call "edit_flow" again to make the change on the flow as it is now.`,
      status: 'error',
    };
  }
  const ownerPause = !pending.paused && pending.flow.enabled && ctx.holdFlows ? ownerOnlyReason(pending.flow, ctx.holdFlows) : undefined;
  const saved = await ctx.replaceFlow(asSavedBy(ownerPause ? { ...pending.flow, enabled: false } : pending.flow, ctx));
  ctx.recentFlows?.push({ id: saved.id, name: saved.name });
  sendLog(`🧩 [Agent] saved the approved change to "${saved.name}"`);
  const diff = pending.diff ?? { added: [], removed: [], changed: [], trigger: false };
  const paused = pending.paused === true || ownerPause !== undefined;
  return { observation: describeSavedEdit(saved, diff, pending.issues, paused, ownerPause ?? pending.off), status: 'ok' };
}

export async function commitHeldFlow(pending: AgentPendingFlow, ctx: HeldFlowContext): Promise<HeldFlowOutcome> {
  try {
    return pending.mode === 'build' ? await commitBuild(pending, ctx) : await commitEdit(pending, ctx);
  } catch (err) {
    return { observation: `ERROR: ${err instanceof Error ? err.message : String(err)}`, status: 'error' };
  }
}

/** Whether a run file's `pendingFlow` is one this build can save; anything else is dropped unread. */
export function isPendingFlow(value: unknown): value is AgentPendingFlow {
  if (!value || typeof value !== 'object') return false;
  const pending = value as Partial<AgentPendingFlow>;
  const flow = pending.flow as Partial<FlowDefinition> | undefined;
  return (pending.mode === 'build' || pending.mode === 'edit')
    && Boolean(flow) && typeof flow?.id === 'string' && typeof flow.name === 'string'
    && Array.isArray(flow.steps) && Boolean(flow.trigger) && Array.isArray(pending.issues);
}
