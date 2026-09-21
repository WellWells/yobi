import { BOT_COMMAND_RE } from './types';
import type { FlowDefinition, TriggerConfig } from './types';
import { missingRequiredVariables } from './flowVariables';

/**
 * Flow states that silently break a flow at runtime. Every one of these already
 * had a code path that skipped the flow and wrote a log line nobody reads —
 * this module is the single place that names them so the UI can surface them.
 *
 * Detection deliberately mirrors the two consumers it describes:
 * `FlowManager.getBotCommands()` (main) and `useChatCommands()` (renderer).
 * If either changes its filtering, this has to change with it or the UI starts
 * telling the user something the app does not actually do.
 */
export type FlowIssueKind =
  | 'commandMissing'
  | 'commandInvalid'
  | 'commandDuplicate'
  | 'missingRequiredVars';

export type FlowIssueScope = 'bot' | 'chat';

export interface FlowIssue {
  kind: FlowIssueKind;
  /** Command surface the issue belongs to; absent for issues about the flow itself. */
  scope?: FlowIssueScope;
  /** Normalised command without the leading slash. */
  command?: string;
  /** Names of the other flows claiming the same command. */
  otherNames?: string[];
  /** Duplicate only: true for the flow that actually answers the command. */
  wins?: boolean;
  /** missingRequiredVars only: labels of the unfilled required variables. */
  varNames?: string[];
}

/** Most actionable first, so a row with several issues leads with the one to fix. */
const KIND_RANK: Record<FlowIssueKind, number> = {
  commandDuplicate: 0,
  commandInvalid: 1,
  commandMissing: 2,
  missingRequiredVars: 3,
};

interface Claim {
  flowId: string;
  flowName: string;
}

/** Normalised command a trigger claims; null for trigger types that claim none. */
export function triggerCommand(trigger: TriggerConfig): { scope: FlowIssueScope; command: string } | null {
  if (trigger.type !== 'bot' && trigger.type !== 'chat') return null;
  const raw = trigger.type === 'bot' ? trigger.botCommand : trigger.chatCommand;
  return { scope: trigger.type, command: (raw ?? '').toLowerCase().trim() };
}

function triggersOf(flow: FlowDefinition): TriggerConfig[] {
  return [flow.trigger, ...(flow.extraTriggers ?? [])];
}

function push(issues: Map<string, FlowIssue[]>, flowId: string, issue: FlowIssue): void {
  const list = issues.get(flowId);
  if (list) {
    list.push(issue);
    return;
  }
  issues.set(flowId, [issue]);
}

/**
 * `flows` must be in the same order the app registers them: for a duplicated
 * command the first claimant wins, exactly as `getBotCommands()` decides it.
 */
export function collectFlowIssues(flows: FlowDefinition[]): Map<string, FlowIssue[]> {
  const issues = new Map<string, FlowIssue[]>();
  // Keyed by `${scope} ${command}` so a bot /gmr never collides with a chat /gmr.
  const claims = new Map<string, Claim[]>();

  for (const flow of flows) {
    // Command issues only exist for enabled flows: a disabled flow registers
    // nothing, so flagging it would light up the nav over a parked draft.
    if (!flow.enabled) continue;
    for (const trigger of triggersOf(flow)) {
      const claim = triggerCommand(trigger);
      if (!claim) continue;
      const { scope, command } = claim;
      if (!command) {
        push(issues, flow.id, { kind: 'commandMissing', scope });
        continue;
      }
      if (!BOT_COMMAND_RE.test(command)) {
        push(issues, flow.id, { kind: 'commandInvalid', scope, command });
        continue;
      }
      const key = `${scope} ${command}`;
      const claimants = claims.get(key) ?? [];
      // One flow claiming the same command twice answers it either way, so
      // collapse to a single claim rather than reporting a self-conflict.
      if (claimants.some((c) => c.flowId === flow.id)) continue;
      claimants.push({ flowId: flow.id, flowName: flow.name });
      claims.set(key, claimants);
    }
  }

  for (const [key, claimants] of claims) {
    if (claimants.length < 2) continue;
    const [scope, command] = key.split(' ') as [FlowIssueScope, string];
    claimants.forEach((claim, index) => {
      push(issues, claim.flowId, {
        kind: 'commandDuplicate',
        scope,
        command,
        wins: index === 0,
        otherNames: claimants.filter((_, i) => i !== index).map((c) => c.flowName),
      });
    });
  }

  // Unlike the command checks this covers disabled flows too: `setEnabledMany()`
  // refuses to turn such a flow on and only writes a log line, so the user sees
  // the switch spring back with no explanation anywhere in the UI.
  for (const flow of flows) {
    const missing = missingRequiredVariables(flow);
    if (missing.length === 0) continue;
    push(issues, flow.id, {
      kind: 'missingRequiredVars',
      varNames: missing.map((v) => v.label || v.key),
    });
  }

  for (const list of issues.values()) {
    list.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  }
  return issues;
}

/** True when any flow has an issue — the nav highlight's only input. */
export function hasAnyFlowIssue(issues: Map<string, FlowIssue[]>): boolean {
  return issues.size > 0;
}

/** The duplicate issue a single trigger is responsible for, for the inline editor warning. */
export function findTriggerConflict(issues: FlowIssue[], trigger: TriggerConfig): FlowIssue | undefined {
  const claim = triggerCommand(trigger);
  if (!claim?.command) return undefined;
  return issues.find((issue) => issue.kind === 'commandDuplicate'
    && issue.scope === claim.scope
    && issue.command === claim.command);
}
