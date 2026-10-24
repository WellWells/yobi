import { useEffect, useMemo } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { followWatchMissing, useWatchMissingStore } from '../store/useWatchMissingStore';
import { collectFlowIssues } from '../../../shared/flowIssues';
import type { ConnectorCommandClash, FlowIssue } from '../../../shared/flowIssues';
import { useMcpCommandAssignment } from './useMcpCommands';

/**
 * Flows are loaded once at bootstrap (`useAppBootstrap`), not on entering the
 * flow view, so the title bar can read this while the user sits in Chat.
 * Connector clashes come from the same assignment the slash menu and Settings
 * use, so a flow is marked exactly when a connector there says it has no command.
 */
export function useFlowIssues(): Map<string, FlowIssue[]> {
  const flows = useFlowStore((s) => s.flows);
  const watchMissing = useWatchMissingStore((s) => s.missing);
  useEffect(followWatchMissing, []);
  const { clashes } = useMcpCommandAssignment();
  // Keyed on the flow-held clashes only: every connector status broadcast builds a new
  // assignment, and none of them should re-run the issue scan or re-render each flow row.
  const shadowKey = JSON.stringify(clashes
    .filter((clash) => clash.owner.kind === 'flow')
    .map(({ command, owner, server }): ConnectorCommandClash => ({ command, owner, server: { name: server.name } })));
  return useMemo(
    () => collectFlowIssues(flows, JSON.parse(shadowKey) as ConnectorCommandClash[], watchMissing),
    [flows, shadowKey, watchMissing],
  );
}
