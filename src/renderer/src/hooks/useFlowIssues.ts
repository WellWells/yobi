import { useMemo } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { collectFlowIssues } from '../../../shared/flowIssues';
import type { FlowIssue } from '../../../shared/flowIssues';

/**
 * Flows are loaded once at bootstrap (`useAppBootstrap`), not on entering the
 * flow view, so the title bar can read this while the user sits in Chat.
 */
export function useFlowIssues(): Map<string, FlowIssue[]> {
  const flows = useFlowStore((s) => s.flows);
  return useMemo(() => collectFlowIssues(flows), [flows]);
}
