import type { InterpretedResult, OutcomeNotice, VerificationResult } from './toolContracts';
import type { ActionRecord } from './evidenceLedger';

/**
 * Turns what a change really did into the three places that must agree about it: the line the model
 * reads after the call, the EARLIER ACTIONS block a later turn reads, and the footer the user gets.
 * The footer is the guarantee — the model is asked to be honest, the delivery path makes it so.
 */

export function resultCheckLine(result: InterpretedResult): string {
  switch (result.outcome) {
    case 'claimed': return `RESULT CHECK: CLAIMED — ${result.summary}.`;
    case 'review_opened': return `RESULT CHECK: REVIEW WINDOW OPENED — ${result.summary}.`;
    case 'partial': return `RESULT CHECK: PARTIAL — ${result.summary}.`;
    case 'uncertain': return `RESULT CHECK: UNCLEAR — ${result.summary}. Do not claim it worked.`;
    case 'failed':
      return `RESULT CHECK: FAILED — ${result.summary}. Nothing changed.${result.failure === 'not_found'
        ? ' Find the item again with a (read) tool instead of resending this call.'
        : ''}`;
    default: return '';
  }
}

export function verificationLine(result: VerificationResult): string {
  switch (result.status) {
    case 'verified': return `RESULT CHECK: VERIFIED — ${result.evidence}.`;
    case 'not_found': return `RESULT CHECK: NOT VERIFIED — the tool said it was done, but ${result.evidence}. Do not claim it worked.`;
    default: return `RESULT CHECK: COULD NOT VERIFY — ${result.evidence}. Say it could not be confirmed.`;
  }
}

/** The user-facing line for one record, or null when nothing happened worth a line. */
export function recordNotice(record: ActionRecord): OutcomeNotice | null {
  if (record.verdict !== 'ready' || record.confirmed === 'denied' || !record.outcome) return null;
  if (record.verification) return record.verification.notice ?? null;
  if (record.outcome === 'succeeded') return null;
  return record.notice ?? null;
}

/** The few reasons a user can act on. A code missing here reads as a safety check. */
const HELD_BACK_KEYS: Readonly<Record<string, string>> = {
  boundary_exceeded: 'agent.outcome.heldBack.notAsked',
  actor_missing: 'agent.outcome.heldBack.account',
  actor_unknown: 'agent.outcome.heldBack.account',
  actor_unresolved: 'agent.outcome.heldBack.account',
  target_unobserved: 'agent.outcome.heldBack.target',
  target_ambiguous: 'agent.outcome.heldBack.target',
  folder_mismatch: 'agent.outcome.heldBack.target',
  context_unavailable: 'agent.outcome.heldBack.target',
  content_suspect: 'agent.outcome.heldBack.content',
  split_required: 'agent.outcome.heldBack.content',
};

/**
 * The line for a change the gate held back and the run never got past, or null.
 *
 * No dialog opens for a held-back call, so this line is the only place the user can learn it did
 * not run. Without it the delivery fell back to "every write failed" for a call that was never
 * attempted, and the model made up a reason of its own (2026-09-15, saveDraft held back twice).
 * A hold that a later call of the same tool got past is left to that call's own line.
 */
export function heldBackNotice(record: ActionRecord, later: readonly ActionRecord[]): OutcomeNotice | null {
  if (record.verdict !== 'blocked') return null;
  const gotPast = later.some((next) => next.verdict === 'ready'
    && next.confirmed !== 'denied'
    && next.serverId === record.serverId
    && next.tool === record.tool);
  if (gotPast) return null;
  const key = HELD_BACK_KEYS[record.reasons?.[0]?.code ?? ''] ?? 'agent.outcome.heldBack.other';
  return { key, vars: { tool: record.tool } };
}

export function buildActionFooter(
  records: readonly ActionRecord[],
  translate: (key: string, vars: Record<string, string>) => string,
): string {
  const lines = [...new Set(records
    .map((record, index) => recordNotice(record) ?? heldBackNotice(record, records.slice(index + 1)))
    .filter((notice): notice is OutcomeNotice => notice !== null)
    .map((notice) => translate(notice.key, notice.vars).trim())
    .filter(Boolean))];
  if (lines.length === 0) return '';
  return [`**${translate('agent.outcome.heading', {})}**`, ...lines.map((line) => `- ${line}`)].join('\n');
}

export function withActionFooter(answer: string, footer: string): string {
  if (!footer) return answer;
  const trimmed = answer.trimEnd();
  return trimmed.includes(footer) ? trimmed : `${trimmed}\n\n${footer}`;
}

function hhmm(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function statusOf(record: ActionRecord): string {
  if (record.confirmed === 'denied') return 'DECLINED BY THE USER';
  if (record.verification?.status === 'verified') return `VERIFIED (${record.verification.evidence})`;
  if (record.verification?.status === 'not_found') return `SAID DONE, BUT NOT FOUND (${record.verification.evidence})`;
  switch (record.outcome) {
    case 'review_opened': return 'REVIEW WINDOW OPENED (nothing saved, nothing sent)';
    case 'claimed': return 'SAID DONE, NOT VERIFIED';
    case 'partial': return `PARTIAL (${record.summary ?? ''})`;
    case 'failed': return `FAILED (${record.summary ?? ''})`;
    case 'uncertain': return 'UNCLEAR';
    default: return 'DONE';
  }
}

const EARLIER_ACTIONS_LIMIT = 5;
const EARLIER_ACTIONS_MAX_CHARS = 900;

/** The newest changes that actually ran (or were declined), one line each; '' when there are none. */
export function renderActionLines(records: readonly ActionRecord[], limit = EARLIER_ACTIONS_LIMIT): string {
  const ran = records.filter((record) => record.verdict === 'ready').slice(-limit);
  const lines: string[] = [];
  let used = 0;
  for (const record of [...ran].reverse()) {
    const line = `- ${hhmm(record.at)} ${record.server} ${record.label} → ${statusOf(record)}`.replace(/\s+/g, ' ');
    if (used + line.length > EARLIER_ACTIONS_MAX_CHARS) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
