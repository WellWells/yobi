import { clipLine } from '../../../shared/textBudget';
import type { McpTool } from '../../mcp/mcpTypes';

/**
 * What one tool call can do to the world, from nothing (`read`) to something that cannot be taken
 * back (`destructive`). The level decides whether the action gate reviews a call at all and how the
 * user is asked, so a tool nobody has classified is never assumed to be harmless.
 */
export type ToolRisk = 'read' | 'reversible' | 'mutating' | 'external' | 'destructive';

/** What a call does, in the words a GOAL grants permission in: a draft never licenses a send. */
export type ActionBoundary = 'draft' | 'modify' | 'send' | 'delete';

export const ACTION_BOUNDARIES: readonly ActionBoundary[] = ['draft', 'modify', 'send', 'delete'];

export type ActionOutcome = 'succeeded' | 'claimed' | 'review_opened' | 'partial' | 'failed' | 'uncertain';

export type FailureClass = 'not_found' | 'invalid_args' | 'permission' | 'unavailable' | 'transient' | 'unknown';

export type ConfirmPolicy = 'never' | 'ask' | 'always';

export type Args = Record<string, unknown>;

/** A user-facing line, localized at delivery: the contract only picks the key and fills the facts. */
export interface OutcomeNotice {
  key: string;
  vars: Record<string, string>;
}

export interface InterpretedResult {
  outcome: ActionOutcome;
  failure?: FailureClass;
  /** Model-facing, one line: what the tool's answer actually means. */
  summary: string;
  notice?: OutcomeNotice;
}

export type VerificationStatus = 'verified' | 'not_found' | 'unavailable';

export interface VerificationResult {
  status: VerificationStatus;
  evidence: string;
  notice?: OutcomeNotice;
}

/** Why a call was held back, in the model's terms, plus the options the user could pick from. */
export interface GateReason {
  code: string;
  message: string;
  choices?: string[];
}

/** One row of the confirmation dialog: a fact the user can judge, not a JSON key. */
export interface DescribedRow {
  key: 'action' | 'account' | 'target' | 'recipients' | 'content' | 'items';
  value: string;
  valueKey?: string;
  vars?: Record<string, string>;
}

export interface Fact {
  kind: string;
  key: string;
  fields: Record<string, string>;
  source: 'runtime' | 'tool';
}

/** A read-only call a contract may make by itself — verification and context lookups only. */
export type ReadCaller = (tool: string, args: Args) => Promise<{ text: string; isError: boolean }>;

export interface ContractCheck {
  reasons: GateReason[];
  /** Read-only lookups that would let the check decide; the engine runs them and checks again. */
  needs?: { tool: string; args: Args }[];
}

/** The subset of the evidence ledger a contract reads. Kept structural so contracts stay pure. */
export interface LedgerView {
  facts: (kind: string) => Fact[];
  fact: (kind: string, key: string) => Fact | undefined;
  hasValue: (value: string) => boolean;
  userWords: string;
}

export interface ToolContract {
  risk: (args: Args) => ToolRisk;
  boundary: (args: Args) => ActionBoundary | null;
  confirm: (args: Args) => ConfirmPolicy;
  interpret: (text: string, isError: boolean, args: Args, ledger: LedgerView) => InterpretedResult;
  /** Identity of what the call changes, so a later turn can tell it is the same thing again. */
  targetKey?: (args: Args) => string | null;
  check?: (args: Args, ledger: LedgerView) => ContractCheck;
  describe?: (args: Args, ledger: LedgerView) => DescribedRow[];
  extractFacts?: (args: Args, text: string) => Fact[];
  verify?: (args: Args, at: string, ledger: LedgerView, read: ReadCaller) => Promise<VerificationResult>;
  /** Plain words for the action in logs and in the EARLIER ACTIONS block. */
  label?: (args: Args, ledger: LedgerView) => string;
  /**
   * i18n key for what the user's result lines call this tool. Only connectors Yobi describes itself
   * have one; a server's own title, then the id spelled out, stand in for the rest.
   */
  titleKey?: string;
}

const DESTRUCTIVE_VERBS = new Set(['delete', 'del', 'remove', 'clear', 'drop', 'purge', 'empty', 'destroy', 'revoke']);
const EXTERNAL_VERBS = new Set(['send', 'reply', 'forward', 'publish', 'share', 'invite']);
const WRITE_VERBS = new Set([
  'create', 'update', 'patch', 'delete', 'del', 'write', 'insert', 'append', 'remove',
  'move', 'archive', 'send', 'modify', 'edit', 'upload', 'duplicate', 'merge', 'comment',
  'revoke', 'cancel', 'set', 'make', 'rename', 'clear', 'drop', 'add',
]);
const READ_VERBS = new Set([
  'get', 'list', 'search', 'retrieve', 'query', 'read', 'fetch', 'find', 'view',
  'describe', 'export', 'download', 'show', 'lookup', 'count',
]);

export function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * A write verb in the name beats a `readOnlyHint`, because a server
 * that marks `delete_account` read-only is wrong, not reassuring.
 */
function isReadTool(tool: McpTool): boolean {
  const tokens = nameTokens(tool.name);
  if (tokens.some((token) => WRITE_VERBS.has(token))) return false;
  const hint = tool.annotations?.readOnlyHint;
  if (hint === true) return true;
  if (hint === false) return false;
  return tokens.some((token) => READ_VERBS.has(token));
}

export function genericRisk(tool: McpTool): ToolRisk {
  if (isReadTool(tool)) return 'read';
  const tokens = nameTokens(tool.name);
  if (tool.annotations?.destructiveHint === true || tokens.some((token) => DESTRUCTIVE_VERBS.has(token))) {
    return 'destructive';
  }
  if (tokens.some((token) => EXTERNAL_VERBS.has(token))) return 'external';
  return 'mutating';
}

export function boundaryForRisk(risk: ToolRisk): ActionBoundary | null {
  switch (risk) {
    case 'read': return null;
    case 'reversible': return 'draft';
    case 'external': return 'send';
    case 'destructive': return 'delete';
    default: return 'modify';
  }
}

/** The label the catalog prints next to a tool, and the vocabulary the legend teaches. */
export function riskLabel(risk: ToolRisk): string {
  switch (risk) {
    case 'read': return 'read';
    case 'reversible': return 'draft';
    case 'external': return 'send';
    case 'destructive': return 'delete';
    default: return 'write';
  }
}

export function confirmForRisk(risk: ToolRisk): ConfirmPolicy {
  if (risk === 'read') return 'never';
  return risk === 'external' || risk === 'destructive' ? 'always' : 'ask';
}

export function classifyFailure(text: string): FailureClass {
  if (/not found|no matching|does not exist|unknown (message|id|identity)|no such/i.test(text)) return 'not_found';
  if (/permission|forbidden|restricted|not allowed|blocks skipReview|unauthori[sz]ed|denied/i.test(text)) return 'permission';
  if (/\b(invalid|validation|unrecognized|malformed)\b|missing required/i.test(text)) return 'invalid_args';
  if (/not running|unavailable|not connected/i.test(text)) return 'unavailable';
  if (/time(d)? ?out|rate limit|temporar|ECONN|\b50[23]\b|\b429\b/i.test(text)) return 'transient';
  return 'unknown';
}

export function parseJsonValue(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Stands in for a failure the server gave no words for. The model reads it as is; the user's line
 * is written by us instead (`failedResult`), so this English never reaches a localized footer.
 */
const UNSTATED_FAILURE = 'the tool reported a failure';

/**
 * A failure reported inside a successful response: some connectors (the Thunderbird add-on) return
 * business errors as `{"error": "..."}` without `isError`.
 */
export function embeddedError(text: string): string | null {
  const obj = asRecord(parseJsonValue(text));
  if (!obj) return null;
  if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
  if (obj.success === false) {
    return typeof obj.message === 'string' && obj.message.trim() ? obj.message.trim() : UNSTATED_FAILURE;
  }
  return null;
}

/**
 * `detail` is the server's own words, relayed to the user as received. When there are none — an
 * empty error, or a bare `success: false` — the user's line says only that it failed, in their
 * language, instead of splicing our English placeholder into it.
 */
export function failedResult(detail: string, tool: string): InterpretedResult {
  const said = detail === UNSTATED_FAILURE ? '' : clipLine(detail, 120);
  return {
    outcome: 'failed',
    failure: classifyFailure(detail),
    summary: said ? `the tool reported an error ("${clipLine(detail, 200)}")` : 'the tool reported an error and gave no reason',
    notice: said
      ? { key: 'agent.outcome.failed', vars: { tool, detail: said } }
      : { key: 'agent.outcome.failedNoReason', vars: { tool } },
  };
}

/** Why Yobi's own connection layer stopped a call before it reached the server. */
export type UnsentReason = 'notConnected' | 'notSent';

export const UNSENT_NOTICE_KEYS: Readonly<Record<UnsentReason, string>> = {
  notConnected: 'agent.outcome.notConnected',
  notSent: 'agent.outcome.notSent',
};

/**
 * A call the connection layer refused before it reached the server (not connected, or a change not
 * resent after a session renewal). The model reads the registry's English; the user's line is ours,
 * so neither that English nor the raw server id is relayed as the connector's words.
 */
export function unsentResult(detail: string, tool: string, reason: UnsentReason): InterpretedResult {
  return { ...failedResult(detail, tool), notice: { key: UNSENT_NOTICE_KEYS[reason], vars: { tool } } };
}

export function interpretGeneric(text: string, isError: boolean, toolName: string): InterpretedResult {
  if (isError) return failedResult(text, toolName);
  const embedded = embeddedError(text);
  if (embedded) return failedResult(embedded, toolName);
  return { outcome: 'succeeded', summary: '' };
}

/** Argument keys that name an existing thing — the values a model most often invents. */
export function isIdLikeKey(key: string): boolean {
  return /(^|_)ids?$|[a-z]Ids?$/.test(key);
}

export function genericContract(tool: McpTool): ToolContract {
  const risk = genericRisk(tool);
  return {
    risk: () => risk,
    boundary: () => boundaryForRisk(risk),
    confirm: () => confirmForRisk(risk),
    interpret: (text, isError) => interpretGeneric(text, isError, tool.name),
  };
}
