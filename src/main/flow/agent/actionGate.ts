import type { McpTool } from '../../mcp/mcpTypes';
import { ACTION_BOUNDARIES, isIdLikeKey } from './toolContracts';
import type { ActionBoundary, Args, ContractCheck, GateReason, ToolContract } from './toolContracts';
import { actionId, allActions } from './evidenceLedger';
import type { ActionRecord, EvidenceLedger } from './evidenceLedger';

/**
 * What the GOAL lets this run change, declared on the first action — before any tool result has
 * entered the prompt, so text inside a fetched email cannot write it. It only ever NARROWS what the
 * gate allows; nothing the model infers can authorize a call on its own.
 */
export interface GoalIntent {
  change: ActionBoundary[];
  content: 'user' | 'compose' | 'none';
}

/** A run that never said what it may change still gets the reversible and the ordinary edits. */
const DEFAULT_CHANGE: readonly ActionBoundary[] = ['draft', 'modify'];

export const MAX_BLOCKED_PER_RUN = 3;

export function readIntent(json: unknown): { intent?: GoalIntent } {
  if (typeof json !== 'object' || json === null) return {};
  const raw = (json as Record<string, unknown>).intent;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.change)) return {};
  const change = [...new Set(obj.change
    .map((value) => String(value).trim().toLowerCase())
    .filter((value): value is ActionBoundary => (ACTION_BOUNDARIES as readonly string[]).includes(value)))];
  const content = obj.content === 'user' || obj.content === 'compose' ? obj.content : 'none';
  return { intent: { change, content } };
}

/** A send includes writing the draft first; a delete includes moving things on the way. */
export function allowedBoundaries(intent: GoalIntent | null): Set<ActionBoundary> {
  const declared = intent ? intent.change : DEFAULT_CHANGE;
  const allowed = new Set<ActionBoundary>(declared);
  if (allowed.has('send')) allowed.add('draft');
  if (allowed.has('delete')) allowed.add('modify');
  return allowed;
}

/** Words that name a boundary in a user's answer. `modify` and `draft` are allowed by default. */
const CONSENT_WORDS: ReadonlyArray<[ActionBoundary, RegExp]> = [
  ['delete', /刪除|刪掉|删除|删掉|移除|垃圾桶|\b(delete|remove|trash)\b/i],
  ['send', /寄出|寄送|發送|发送|送出|\bsend\b/i],
];
/**
 * Anything that refuses, cancels, keeps, postpones or limits, matched anywhere in the answer:
 * "cancel the delete", "keep it, delete next week" and "only remove the label" name the verb
 * without agreeing to it. A plain yes that happens to contain one is held back once more.
 */
const NOT_CONSENT = /不|沒|没|別|别|勿|免|否|取消|保留|無須|无须|毋須|以後|之後|下次|下週|下周|改天|稍後|只|僅|仅|\b(no|not|never|cancel|keep|later|without|instead|only)\b|n't/i;

/**
 * What the user's own answers to this run's questions allow beyond the declared intent. Unlike the
 * intent, an answer is the user's own words, so an unqualified one may widen what the gate allows.
 * A send or delete still opens a dialog every time.
 */
export function consentedBoundaries(answers: readonly string[]): ActionBoundary[] {
  const found = new Set<ActionBoundary>();
  for (const answer of answers) {
    if (NOT_CONSENT.test(answer)) continue;
    for (const [boundary, pattern] of CONSENT_WORDS) {
      if (pattern.test(answer)) found.add(boundary);
    }
  }
  return [...found];
}

const BOUNDARY_WORDS: Record<ActionBoundary, string> = {
  draft: 'create a draft or open a compose window',
  modify: 'change, move or create things',
  send: 'send something to other people',
  delete: 'delete things',
};

export interface GateInput {
  serverId: string;
  tool: McpTool;
  args: Args;
  contract: ToolContract;
  ledger: EvidenceLedger;
  intent: GoalIntent | null;
  /** The user's answers to this run's questions; see `consentedBoundaries`. */
  answers?: readonly string[];
  blockedSoFar: number;
  signature: string;
}

export type GateDecision =
  | { verdict: 'ready' }
  | { verdict: 'needs'; needs: NonNullable<ContractCheck['needs']> }
  | { verdict: 'blocked'; reasons: GateReason[]; recheck?: ActionRecord; transient: boolean };

const RECHECK_OUTCOMES = new Set(['claimed', 'review_opened', 'partial', 'uncertain']);
const FINAL_FAILURES = new Set(['not_found', 'invalid_args', 'permission']);

function clip(value: string, limit = 60): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function timeOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

/** For a connector with no contract of its own: a handle nobody has shown the model is invented. */
export function genericIdCheck(args: Args, ledger: EvidenceLedger): ContractCheck {
  const reasons: GateReason[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (!isIdLikeKey(key)) continue;
    const unseen = stringValues(value).filter((item) => !ledger.hasValue(item));
    if (unseen.length === 0) continue;
    reasons.push({
      code: 'target_unobserved',
      message: `"${key}" is "${clip(unseen[0])}", which no tool result and nothing the user wrote contains. Use the exact value from a (read) result.`,
    });
  }
  return { reasons };
}

function priorNeedingRecheck(input: GateInput, key: string): ActionRecord | undefined {
  return allActions(input.ledger).reverse().find((record) => record.serverId === input.serverId
    && record.targetKey === key
    && record.verdict === 'ready'
    && record.confirmed !== 'denied'
    && RECHECK_OUTCOMES.has(record.outcome ?? '')
    && record.verification?.status !== 'verified'
    && !input.ledger.checked.has(actionId(record)));
}

function recheckMessage(prior: ActionRecord): string {
  const when = timeOf(prior.at);
  if (prior.outcome === 'review_opened') {
    return `At ${when} a window was already opened for this (${prior.label}). It may still be open and unsaved in the user's app. Tell the user about it; open another only if that is what they want.`;
  }
  return `At ${when} this was already done (${prior.label}) and never confirmed. Its current state is checked below — use that before doing it again.`;
}

export function decideAction(input: GateInput): GateDecision {
  const { args, contract, ledger } = input;
  if (input.blockedSoFar >= MAX_BLOCKED_PER_RUN) {
    return {
      verdict: 'blocked',
      transient: false,
      reasons: [{
        code: 'too_many_blocks',
        message: `${MAX_BLOCKED_PER_RUN} changes in this run were already held back. Ask the user for what is missing, or finish and say what you could not do.`,
      }],
    };
  }

  const boundary = contract.boundary(args);
  const declared = input.intent?.change ?? DEFAULT_CHANGE;
  const allowed = allowedBoundaries({ change: [...declared, ...consentedBoundaries(input.answers ?? [])], content: 'none' });
  if (boundary && !allowed.has(boundary)) {
    return {
      verdict: 'blocked',
      transient: false,
      reasons: [{
        code: 'boundary_exceeded',
        message: `This call would ${BOUNDARY_WORDS[boundary]}, and the GOAL did not ask for that. Do only what the GOAL asks; if you believe it should, ask the user first — an answer that says to ${boundary} allows it.`,
      }],
    };
  }

  const failed = allActions(ledger).find((record) => record.signature === input.signature
    && record.outcome === 'failed'
    && FINAL_FAILURES.has(record.failure ?? ''));
  if (failed) {
    return {
      verdict: 'blocked',
      transient: false,
      reasons: [{
        code: 'repeat_of_failure',
        message: `This exact call already failed at ${timeOf(failed.at)} (${failed.summary ?? 'error'}). Fix what was wrong instead of sending it again.`,
      }],
    };
  }

  const key = contract.targetKey?.(args) ?? null;
  const prior = key ? priorNeedingRecheck(input, key) : undefined;
  if (prior) {
    return {
      verdict: 'blocked',
      transient: true,
      recheck: prior,
      reasons: [{ code: 'prior_action_unchecked', message: recheckMessage(prior) }],
    };
  }

  const check = contract.check ? contract.check(args, ledger) : genericIdCheck(args, ledger);
  if (check.needs && check.needs.length > 0) return { verdict: 'needs', needs: check.needs };
  if (check.reasons.length > 0) return { verdict: 'blocked', reasons: check.reasons, transient: false };
  return { verdict: 'ready' };
}

export function formatBlocked(reasons: readonly GateReason[], extra: readonly string[] = []): string {
  return [
    'BLOCKED — this call did not run and nothing changed:',
    ...reasons.map((reason) => {
      const choices = reason.choices?.length
        ? ` Choices: ${reason.choices.map((choice) => `"${choice}"`).join(', ')}.`
        : '';
      return `- ${reason.message}${choices}`;
    }),
    ...extra,
    'Fix what is named above, or ask the user. Do not send this call again unchanged.',
  ].join('\n');
}
