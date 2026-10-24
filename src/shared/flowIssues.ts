import { BOT_COMMAND_RE } from './types';
import type { FlowDefinition, TriggerConfig } from './types';
import { missingRequiredVariables } from './flowVariables';
import { botTriggerAccess, isBotCommandClosed } from './botCommandAccess';
import type { McpCommandOwner } from './mcpCommand';
import { isUsableWatchFolder } from './flowFileTrigger';

/**
 * Flow states that silently break a flow at runtime, or silently change what one of its commands
 * reaches, named in one place so the UI can surface them. Detection mirrors
 * `FlowManager.getBotCommands()` (main) and `useChatCommands()` (renderer); keep them in sync or
 * the UI reports something the app does not do.
 */
export type FlowIssueKind =
  | 'commandMissing'
  | 'commandInvalid'
  | 'commandDuplicate'
  | 'commandClosed'
  | 'missingRequiredVars'
  | 'commandShadowsConnector'
  | 'watchFolderUnset'
  | 'watchFolderMissing';

export type FlowIssueScope = 'bot' | 'chat';

export interface FlowIssue {
  kind: FlowIssueKind;
  /** Command surface the issue belongs to; absent for issues about the flow itself. */
  scope?: FlowIssueScope;
  /** Normalised command without the leading slash. */
  command?: string;
  /** Names of the other flows claiming the same command, or of the connectors this flow beat to it. */
  otherNames?: string[];
  /** Duplicate only: true for the flow that actually answers the command. */
  wins?: boolean;
  /** missingRequiredVars only: labels of the unfilled required variables. */
  varNames?: string[];
  /** watchFolderMissing only: the folder as the trigger names it. */
  folder?: string;
}

/** Most actionable first, so a row with several issues leads with the one to fix. */
const KIND_RANK: Record<FlowIssueKind, number> = {
  commandDuplicate: 0,
  commandInvalid: 1,
  commandMissing: 2,
  commandClosed: 3,
  watchFolderUnset: 4,
  watchFolderMissing: 5,
  missingRequiredVars: 6,
  // Last: the flow still answers its command; only the connector went without one.
  commandShadowsConnector: 7,
};

interface Claim {
  flowId: string;
  flowName: string;
}

/** A connector left without a slash command, as `assignMcpCommandNames` reports it in `clashes`. */
export interface ConnectorCommandClash {
  command: string;
  owner: McpCommandOwner;
  server: { name: string };
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
 * Connectors that lost their slash command to a flow's chat command, one issue per flow and
 * command. Who won is taken from the assignment, not decided again here: it already ranks the
 * chat's built-ins over flows, and only the first flow claiming a chat command holds it.
 */
function pushShadowedConnectors(
  issues: Map<string, FlowIssue[]>,
  flows: FlowDefinition[],
  clashes: readonly ConnectorCommandClash[],
): void {
  const enabled = new Set(flows.filter((flow) => flow.enabled).map((flow) => flow.id));
  const lost = new Map<string, { flowId: string; command: string; names: string[] }>();
  for (const { command, owner, server } of clashes) {
    if (owner.kind !== 'flow' || !enabled.has(owner.flowId)) continue;
    const key = `${owner.flowId} ${command}`;
    const entry = lost.get(key) ?? { flowId: owner.flowId, command, names: [] };
    entry.names.push(server.name);
    lost.set(key, entry);
  }
  for (const { flowId, command, names } of lost.values()) {
    push(issues, flowId, { kind: 'commandShadowsConnector', scope: 'chat', command, otherNames: names });
  }
}

/**
 * An enabled flow's folder triggers: one with no usable folder never fires; one whose folder the
 * main process cannot find (`watchMissing`, its broadcast) waits for the folder to come back.
 */
function pushWatchFolderIssues(
  issues: Map<string, FlowIssue[]>,
  flows: FlowDefinition[],
  watchMissing: ReadonlySet<string>,
): void {
  for (const flow of flows) {
    if (!flow.enabled) continue;
    const fileTriggers = triggersOf(flow).filter((trigger) => trigger.type === 'file');
    if (fileTriggers.length === 0) continue;
    if (fileTriggers.some((trigger) => !isUsableWatchFolder(trigger.watchFolder))) {
      push(issues, flow.id, { kind: 'watchFolderUnset' });
    } else if (watchMissing.has(flow.id)) {
      const folder = fileTriggers.map((trigger) => (trigger.watchFolder ?? '').trim()).join(', ');
      push(issues, flow.id, { kind: 'watchFolderMissing', folder });
    }
  }
}

/**
 * `flows` must be in the same order the app registers them: for a duplicated
 * command the first claimant wins, exactly as `getBotCommands()` decides it.
 * `connectorClashes` is the `clashes` list of the chat's connector command assignment;
 * `watchMissing` the flows whose watched folder the main process cannot find.
 */
export function collectFlowIssues(
  flows: FlowDefinition[],
  connectorClashes: readonly ConnectorCommandClash[] = [],
  watchMissing: readonly string[] = [],
): Map<string, FlowIssue[]> {
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
      // Limited to listed accounts with nobody listed: registered, but it answers no one.
      if (trigger.type === 'bot' && isBotCommandClosed(botTriggerAccess(trigger))) {
        push(issues, flow.id, { kind: 'commandClosed', scope, command });
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

  pushShadowedConnectors(issues, flows, connectorClashes);
  pushWatchFolderIssues(issues, flows, new Set(watchMissing));

  for (const list of issues.values()) {
    list.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  }
  return issues;
}

/** True when any flow has an issue — the nav highlight's only input. */
export function hasAnyFlowIssue(issues: Map<string, FlowIssue[]>): boolean {
  return issues.size > 0;
}

/** A bot trigger limited to listed accounts with nobody listed, for the inline editor error. */
export function isTriggerClosed(trigger: TriggerConfig): boolean {
  return trigger.type === 'bot' && isBotCommandClosed(botTriggerAccess(trigger));
}

/**
 * The clashes a single trigger's command is part of — another flow claiming it, or a connector
 * that lost it to this flow — for the inline editor warning under that command field.
 */
export function findTriggerConflicts(issues: FlowIssue[], trigger: TriggerConfig): FlowIssue[] {
  const claim = triggerCommand(trigger);
  if (!claim?.command) return [];
  return issues.filter((issue) => (issue.kind === 'commandDuplicate' || issue.kind === 'commandShadowsConnector')
    && issue.scope === claim.scope
    && issue.command === claim.command);
}
