import { useMemo } from 'react';
import { useFlowStore } from './useFlowStore';
import type { FlowDefinition } from '../../../shared/types';

/**
 * The flows as saved, in the sidebar's order. What runs is the saved flow (the scheduler, the
 * hotkeys, the chat's slash commands and the Bot all read flows.json), so everything outside the
 * editor describes this list, not the editor's draft. Reading the draft would also redraw the
 * chat, the hidden Settings dialog and the sidebar on every keystroke in a step.
 *
 * The order is selected as one string, which stays equal while a step is edited; a flow never
 * saved yet is left out (nothing runs it).
 */
export function useSavedFlows(): FlowDefinition[] {
  const order = useFlowStore((s) => s.flows.map((flow) => flow.id).join('\n'));
  const saved = useFlowStore((s) => s.savedFlows);
  return useMemo(() => {
    if (!order) return [];
    return order.split('\n').map((id) => saved[id]).filter((flow): flow is FlowDefinition => Boolean(flow));
  }, [order, saved]);
}
