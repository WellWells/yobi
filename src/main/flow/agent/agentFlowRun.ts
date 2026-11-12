import type { FlowDefinition, FlowExecutionResult } from '../../../shared/types';
import { resolveEditTarget } from '../flowEdit';
import type { FlowRef } from '../flowEdit';
import { sendLog } from '../../helpers';
import { ownerOnlyReason, sensitiveTypesOf } from './agentFlowShared';
import type { FlowHold } from './agentFlowShared';
import { targetError } from './agentFlowEdit';
import type { FlowToolOutcome } from './agentFlowEdit';

/**
 * `/agent`'s `run_flow`: "test it" runs a saved flow once, now, the way Run in the editor does —
 * a switched-off flow too, since testing comes before switching on. Which flow is decided here
 * like `edit_flow`'s (blank = the last one this conversation made or changed).
 *
 * From a bot, `mayRunFromChat` decides; the rest wait for the desktop, where the owner sees them.
 */

export const RUN_FLOW_LINE = '- "run_flow": Run a saved flow once now, to test it (off ones too). config keys: "flow" (its name; omit for the last one in this chat) → returns: how the run went.';

export interface FlowRunToolContext {
  listFlows?: () => readonly FlowDefinition[];
  runFlow?: (flowId: string) => Promise<FlowExecutionResult>;
  recentFlows: readonly FlowRef[];
  /** A bot run (the asker answers in the chat): set for every bot run that may use flow tools. */
  hold?: FlowHold;
}

export const RUN_OUTPUT_PREVIEW_CHARS = 400;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > RUN_OUTPUT_PREVIEW_CHARS ? `${flat.slice(0, RUN_OUTPUT_PREVIEW_CHARS)}…` : flat;
}

/** How the run went, for the model to tell the user: never a raw dump of every step's output. */
export function describeRun(flow: FlowDefinition, result: FlowExecutionResult): string {
  const name = `"${flow.name}"`;
  if (result.aborted) return `The test run of ${name} was stopped before it finished (${result.completedSteps} of ${result.totalSteps} steps ran).`;
  if (!result.success) {
    const reason = result.error ?? 'unknown error';
    return `The test run of ${name} FAILED after ${result.completedSteps} of ${result.totalSteps} steps: ${reason}. Tell the user what failed and how to fix it; do not run it again unless they ask.`;
  }
  const lines = [`The test run of ${name} finished: all ${result.totalSteps} steps ran.${flow.enabled ? '' : ' The flow is still switched off; it runs by itself only once the user switches it on.'}`];
  if (result.softFailures) lines.push(`${result.softFailures} step(s) failed and were skipped: ${result.softFailureError ?? ''}`.trim());
  const output = preview(result.finalOutput ?? '');
  if (output) lines.push(`Last output: ${output}`);
  return lines.join('\n');
}

/**
 * A bot run may test a flow unless that skips a review: a flow that acts on the computer and is
 * switched off was switched off for the owner to look at on the computer, and an admin who is not
 * the owner never runs such steps nor ones that read the owner's data or act as the owner. The
 * owner's own switched-on flow runs on its trigger anyway, so testing it is no new power.
 */
export function mayRunFromChat(flow: FlowDefinition, hold: FlowHold): boolean {
  const sensitive = sensitiveTypesOf(flow.steps.map((step) => String(step.type))).length > 0;
  if (!hold.owner) return !sensitive && !ownerOnlyReason(flow, hold);
  return !sensitive || flow.enabled;
}

export async function runRunFlowTool(config: Record<string, string>, ctx: FlowRunToolContext): Promise<FlowToolOutcome> {
  if (!ctx.listFlows || !ctx.runFlow) {
    return { observation: 'ERROR: This run cannot run flows. Tell the user to press Run in the flow editor.', status: 'error' };
  }
  const query = (config.flow ?? '').trim();
  const target = resolveEditTarget(query, ctx.listFlows(), ctx.recentFlows);
  if (target.kind !== 'found') return { observation: targetError(query, target, 'run_flow'), status: 'error' };
  const { flow } = target;

  if (ctx.hold && !mayRunFromChat(flow, ctx.hold)) {
    return {
      observation: `ERROR: "${flow.name}" has steps that act on the computer or read the owner's data, so it can only be test-run from Yobi on the computer. Tell the user that; do not try another way.`,
      status: 'error',
    };
  }

  sendLog(`▶️ [Agent] test-running flow "${flow.name}"`);
  const result = await ctx.runFlow(flow.id);
  return { observation: describeRun(flow, result), status: 'ok' };
}
