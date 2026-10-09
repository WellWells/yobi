import { UNSENT_NOTICE_KEYS } from './toolContracts';
import type { InterpretedResult, OutcomeNotice, VerificationResult } from './toolContracts';
import type { ActionRecord } from './evidenceLedger';
import { toolTitleKey } from './contractRegistry';

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
 * The line for a change the gate held back and the run never got past, or null. No dialog opens
 * for a held-back call, so this line is the only place the user learns it did not run. A hold
 * that a later call of the same tool got past is left to that call's own line.
 */
export function heldBackNotice(record: ActionRecord, later: readonly ActionRecord[]): OutcomeNotice | null {
  if (record.verdict !== 'blocked') return null;
  if (laterCallGotPast(record, later)) return null;
  if (record.reasons?.[0]?.code === 'prior_action_unchecked' && record.recheck) return earlierChangeNotice(record);
  const key = HELD_BACK_KEYS[record.reasons?.[0]?.code ?? ''] ?? 'agent.outcome.heldBack.other';
  return { key, vars: { tool: record.tool } };
}

/**
 * Held back because the same change was already made earlier and never confirmed, which is not a
 * safety refusal. The line says what the look-up found; only when nothing could be looked up does
 * it fall back to "done earlier, not confirmed".
 */
function earlierChangeNotice(record: ActionRecord): OutcomeNotice {
  const recheck = record.recheck!;
  const time = hhmm(recheck.at);
  if (recheck.outcome === 'review_opened') return { key: 'agent.outcome.heldBack.windowOpen', vars: { tool: record.tool, time } };
  // Known to have half-worked, or not said whether it worked: "already done" would claim more than
  // that, and a partial delete would hide the messages it missed. The earlier result's own line says it.
  if (recheck.outcome === 'partial' || recheck.outcome === 'uncertain') {
    return recheck.notice ?? { key: 'agent.outcome.heldBack.other', vars: { tool: record.tool } };
  }
  const found = recheck.verification?.status === 'verified' || recheck.verification?.status === 'not_found';
  if (found && recheck.verification?.notice) return recheck.verification.notice;
  return { key: 'agent.outcome.heldBack.doneEarlier', vars: { tool: record.tool, time } };
}

/**
 * A failed call that a later call to the SAME target then made, so one corrected attempt does not
 * read as two failures. Needs a target key on both: without one, two failures of the same tool may
 * be two different things, and hiding one would hide a real failure.
 */
function laterRetryWentThrough(record: ActionRecord, later: readonly ActionRecord[]): boolean {
  if (record.outcome !== 'failed' || record.targetKey === null) return false;
  return later.some((next) => next.verdict === 'ready'
    && next.confirmed !== 'denied'
    && next.serverId === record.serverId
    && next.tool === record.tool
    && next.targetKey === record.targetKey
    // Some target keys name only the message or the subject: a forward that failed to Alice and
    // then went to Bob shares one, and hiding the first would hide a real failure.
    && recipientsOf(next.args) === recipientsOf(record.args)
    && next.outcome !== undefined
    && next.outcome !== 'failed');
}

const RECIPIENT_ARGS = ['to', 'cc', 'bcc'] as const;

function recipientsOf(args: Record<string, unknown>): string {
  return RECIPIENT_ARGS
    .map((key) => {
      const value = args[key];
      const list = Array.isArray(value) ? value.map(String) : String(value ?? '').split(/[,;]/);
      return list.map((entry) => entry.trim().toLowerCase()).filter(Boolean).sort().join(',');
    })
    .join('|');
}

/** A later call of the same tool that passed the gate and was not declined. */
function laterCallGotPast(record: ActionRecord, later: readonly ActionRecord[]): boolean {
  return later.some((next) => next.verdict === 'ready'
    && next.confirmed !== 'denied'
    && next.serverId === record.serverId
    && next.tool === record.tool);
}

const UNSENT_KEYS: ReadonlySet<string> = new Set(Object.values(UNSENT_NOTICE_KEYS));

/**
 * The footer's line for one record, given the calls after it. A call that never reached the server
 * (the connector was down, or its session had just been renewed) is, like a hold, left to a later
 * call of the same tool that got past — otherwise the footer says "didn't run" for a change the run
 * then made after all.
 */
function footerNotice(record: ActionRecord, later: readonly ActionRecord[]): OutcomeNotice | null {
  const notice = recordNotice(record);
  if (notice && UNSENT_KEYS.has(notice.key) && laterCallGotPast(record, later)) return null;
  if (laterRetryWentThrough(record, later)) return null;
  return notice ?? heldBackNotice(record, later);
}

type Translate = (key: string, vars: Record<string, string>) => string;

/** `saveDraft` → "Save draft", `create_issue` → "Create issue": the last resort, never a raw id. */
export function readableToolId(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : id;
}

/**
 * What a result line calls the tool: Yobi's own translated name (connectors it describes), then
 * the server's own title, then the id spelled out.
 */
export function toolDisplayName(record: ActionRecord, translate: Translate): string {
  const key = toolTitleKey(record.serverId, record.tool);
  const named = key ? translate(key, {}).trim() : '';
  if (named && named !== key) return named;
  return record.title?.trim() || readableToolId(record.tool);
}

function noticeText(record: ActionRecord, notice: OutcomeNotice, translate: Translate): string {
  const vars = 'tool' in notice.vars ? { ...notice.vars, tool: toolDisplayName(record, translate) } : notice.vars;
  return translate(notice.key, vars).trim();
}

export function buildActionFooter(
  records: readonly ActionRecord[],
  translate: Translate,
): string {
  const lines = [...new Set(records
    .map((record, index) => {
      const notice = footerNotice(record, records.slice(index + 1));
      return notice ? noticeText(record, notice, translate) : '';
    })
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
