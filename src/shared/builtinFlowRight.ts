import { builtinById, isBuiltinFlowId, linkCommandFor } from './linkSites/registry';
import { PAGE_ANALYZE_FLOW_ID } from './pageAnalyzeLine';
import { parseVideoInput } from './ytdl';

/** The right a bot user needs for one run of a built-in flow. */
export type BuiltinFlowRight = 'analyze' | 'download';

/**
 * What a built-in's line asks for, by the line itself rather than by the flow that sent its
 * button: "analyze" under a forwarded post or page and the video menu's summary only read and sum
 * up (a model call), everything else downloads. Null for a flow that is no built-in — a person's
 * own flow command is guarded by its allow list instead.
 */
export function builtinFlowRight(flowId: string, input: string): BuiltinFlowRight | null {
  if (flowId === PAGE_ANALYZE_FLOW_ID) return 'analyze';
  if (!isBuiltinFlowId(flowId)) return null;
  // A button's own flow is the one that sent it (a forward); its line names the one it runs.
  const action = builtinById(linkCommandFor(input)?.flowId ?? flowId)?.action;
  if (action === 'analyze') return 'analyze';
  return action === 'menu' && parseVideoInput(input)?.quality === 'summary' ? 'analyze' : 'download';
}
