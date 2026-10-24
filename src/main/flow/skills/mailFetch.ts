/**
 * The "read new mail" step: messages in one folder that match the step's conditions, newest
 * first. With "only new" on, a message is reported once — the seen cache is keyed on its id and
 * records only what this run hands on, so mail held back by the limit or a failed read comes again
 * next run; the search leaves out mail already handed on before fetching anything, so older new
 * mail is reached and a run with nothing new costs one search. The first run reads only the
 * look-back window, never the whole mailbox.
 */
import { sendLog } from '../../helpers';
import { makeCheckpointStore, type CheckpointStore } from '../checkpoint';
import { cacheWindowMs, dedupeLinks, DEFAULT_CACHE_DAYS, readSeenEntries, type SeenCheckpoint, type SeenEntry } from '../seenCache';
import { FlowUserError } from '../userError';
import { clampIntField } from './numberField';
import { envelope } from './dataSources';
import { LEGACY_MAIL_ACCOUNT_ID, splitMailId } from '../../mail/mailIds';
import type { MailService } from '../../mail/mailService';
import type { MailSummary } from '../../mail/mailMessage';

export const MAIL_FETCH_DEFAULT_DAYS = 1;
export const MAIL_FETCH_MAX_DAYS = 60;
export const MAIL_FETCH_DEFAULT_LIMIT = 10;
export const MAIL_FETCH_MAX_LIMIT = 20;
export const MAIL_FETCH_BODY_CHARS = 4_000;
/** Searches one step may run: every sender × every keyword, each one IMAP SEARCH. */
const MAX_SEARCHES = 12;
/** Mail remembered as carrying no attachment ("only with attachments" off Gmail), newest kept. */
export const MAIL_FETCH_NO_ATTACHMENT_MAX = 5_000;

/**
 * The seen cache, plus the mail an "only with attachments" search read and found without one: off
 * Gmail each candidate is fetched to look, and attachments never change, so it is never read again.
 */
export interface MailFetchCheckpoint extends SeenCheckpoint {
  noAttachment?: SeenEntry[];
}

export interface MailRecord {
  id: string;
  /** With several mailboxes read together: the one that received it. */
  account?: string;
  from: string;
  subject: string;
  date: string;
  body?: string;
  attachments?: string;
}

export interface MailFetchDeps {
  service: () => Promise<MailService>;
  checkpoints: CheckpointStore<MailFetchCheckpoint>;
  log: (line: string) => void;
}

/** Comma-separated words, trimmed, blanks dropped. */
export function splitTerms(raw: string | undefined): string[] {
  return (raw ?? '').split(/[,，、]/).map((term) => term.trim()).filter(Boolean);
}

function quoted(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '')}"` : value;
}

/** One Gmail-syntax query per sender × keyword pair; together they mean "any of them". */
export function mailFetchQueries(config: Record<string, string>): string[] {
  const days = clampIntField(config.days, MAIL_FETCH_DEFAULT_DAYS, 1, MAIL_FETCH_MAX_DAYS);
  const fixed = [
    `newer_than:${days}d`,
    ...(config.unreadOnly === 'true' ? ['is:unread'] : []),
    ...(config.attachmentsOnly === 'true' ? ['has:attachment'] : []),
  ];
  const senders = splitTerms(config.from);
  const keywords = splitTerms(config.keywords);
  const queries: string[] = [];
  for (const sender of senders.length > 0 ? senders : ['']) {
    for (const keyword of keywords.length > 0 ? keywords : ['']) {
      queries.push([
        ...(sender ? [`from:${quoted(sender)}`] : []),
        ...(keyword ? [quoted(keyword)] : []),
        ...fixed,
      ].join(' '));
    }
  }
  if (queries.length > MAX_SEARCHES) {
    throw new FlowUserError('flow.error.mailTooManyTerms', { max: String(MAX_SEARCHES) }, `mail_fetch: senders × keywords may make at most ${MAX_SEARCHES} searches`);
  }
  return queries;
}

function setupError(err: unknown, account: string): FlowUserError | null {
  const reason = (err as { reason?: string } | null)?.reason;
  if (reason === 'noAccount') return new FlowUserError('flow.error.mailNoAccount', {}, 'mail_fetch: no mail account is set up');
  if (reason === 'sendOnly') return new FlowUserError('flow.error.mailSendOnly', {}, 'mail_fetch: the mail account can only send (no IMAP server)');
  if (reason === 'unknownAccount') {
    return new FlowUserError('flow.error.mailAccountUnknown', { account }, `mail_fetch: no mail account "${account}" in Settings › Connectors › Mail`);
  }
  return null;
}

/** Entries still inside the window, oldest first: link → when it was recorded. */
function recentEntries(raw: unknown, nowIso: string, windowMs: number): Map<string, string> {
  const now = Date.parse(nowIso);
  const live = readSeenEntries({ seen: Array.isArray(raw) ? raw : [] }, nowIso).filter((entry) => now - Date.parse(entry.seenAt) <= windowMs);
  return new Map(live.map((entry) => [entry.link, entry.seenAt]));
}

function textOf(records: readonly MailRecord[]): string {
  return records.map((mail) => [
    ...(mail.account ? [`Account: ${mail.account}`] : []),
    `From: ${mail.from}`,
    `Subject: ${mail.subject}`,
    `Date: ${mail.date}`,
    ...(mail.attachments ? [`Attachments: ${mail.attachments}`] : []),
    ...(mail.body !== undefined ? ['', mail.body] : []),
  ].join('\n')).join('\n\n---\n\n');
}

export async function runMailFetch(config: Record<string, string>, stepId: string, deps: MailFetchDeps): Promise<string> {
  const limit = clampIntField(config.limit, MAIL_FETCH_DEFAULT_LIMIT, 1, MAIL_FETCH_MAX_LIMIT);
  const queries = mailFetchQueries(config);
  const folder = (config.folder ?? '').trim() || 'inbox';
  const onlyNew = config.onlyNew !== 'false';
  const attachmentsOnly = config.attachmentsOnly === 'true';
  const withBody = config.withBody !== 'false';
  // One account by its address, or every account that can read mail when blank.
  const account = (config.account ?? '').trim();
  const service = await deps.service();

  // Only mail actually handed on is marked seen: what the limit held back, or a body that could not
  // be read, comes again next run instead of being dropped for good.
  const days = clampIntField(config.days, MAIL_FETCH_DEFAULT_DAYS, 1, MAIL_FETCH_MAX_DAYS);
  const nowIso = new Date().toISOString();
  // The cache has to outlive the look-back window, or old mail would come back as new.
  const windowMs = cacheWindowMs(String(Math.max(DEFAULT_CACHE_DAYS, days + 1)));
  const checkpoint = onlyNew || attachmentsOnly ? await deps.checkpoints.load(stepId) : null;
  const previous = readSeenEntries(checkpoint, nowIso);
  const seen = new Set(onlyNew ? previous.map((entry) => entry.link) : []);
  // Ids saved before multiple mailboxes have no mailbox prefix; they are the upgraded account's.
  const wasSeen = (id: string): boolean => {
    if (seen.has(id)) return true;
    const { accountId, messageId } = splitMailId(id);
    return accountId === LEGACY_MAIL_ACCOUNT_ID && seen.has(messageId);
  };
  // Without this, mail with no attachment was read again on every run (up to a thousand a search)
  // and attachment mail older than that was never reached.
  const noAttachment = attachmentsOnly ? recentEntries(checkpoint?.noAttachment, nowIso, windowMs) : new Map<string, string>();
  const options = {
    ...(onlyNew ? { skip: wasSeen } : {}),
    ...(attachmentsOnly ? { attachmentless: { known: (id: string) => noAttachment.has(id), found: (id: string) => { noAttachment.set(id, nowIso); } } } : {}),
  };

  let found: MailSummary[];
  try {
    const byId = new Map<string, MailSummary>();
    const failed = new Map<string, string>();
    const notes = new Set<string>();
    for (const query of queries) {
      // The search leaves out mail already handed on before fetching: the newest matches may all be
      // seen, and only the rest can hold the `limit` new ones (older new mail in the window too).
      const result = await service.search({ query, folder, limit, ...(account ? { account } : {}) }, options);
      for (const message of result.messages) byId.set(message.id, message);
      for (const failure of result.failed ?? []) failed.set(failure.account, failure.error);
      if (result.note) notes.add(result.note);
    }
    for (const note of notes) deps.log(`📭 [Flow] Mail: ${note}`);
    // A mailbox that could not be read fails the step: carrying on would report "no new mail" for
    // it, and a stop-if-empty step would end the run quietly. Nothing is marked seen, so the mail
    // the other mailboxes had comes again on the next run.
    if (failed.size > 0) throw new Error([...failed].map(([address, error]) => `${address}: ${error}`).join('; '));
    found = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    throw setupError(err, account) ?? new FlowUserError('flow.error.mailReadFailed', { error: err instanceof Error ? err.message : String(err) }, `mail_fetch: ${err instanceof Error ? err.message : String(err)}`);
  }

  const picked = found.filter((message) => !wasSeen(message.id)).slice(0, limit);

  const records: MailRecord[] = [];
  for (const message of picked) {
    const record: MailRecord = {
      id: message.id, ...(message.account ? { account: message.account } : {}),
      from: message.from, subject: message.subject, date: message.date,
    };
    if (withBody) {
      try {
        const detail = await service.read(message.id);
        const cut = Boolean(detail.truncated) || detail.body.length > MAIL_FETCH_BODY_CHARS;
        const body = detail.body.slice(0, MAIL_FETCH_BODY_CHARS);
        record.body = cut ? `${body}\n[…]` : body;
        if (detail.attachments?.length) record.attachments = detail.attachments.map((a) => a.name).join(', ');
      } catch (err) {
        deps.log(`📭 [Flow] Mail: skipped one message for now, its text could not be read: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    records.push(record);
  }
  if (onlyNew || attachmentsOnly) {
    // With "only new" off the seen cache is kept as it was, for when it is turned back on.
    const entries = onlyNew ? dedupeLinks(records.map((record) => record.id), previous, nowIso, windowMs).entries : previous;
    const remembered = [...noAttachment].slice(-MAIL_FETCH_NO_ATTACHMENT_MAX).map(([link, seenAt]) => ({ link, seenAt }));
    await deps.checkpoints.save(stepId, { seen: entries, ...(remembered.length > 0 ? { noAttachment: remembered } : {}), updatedAt: nowIso });
  }
  deps.log(`📬 [Flow] Mail: ${found.length} found${onlyNew ? ' not yet handed on' : ''}, ${records.length} returned`);
  return envelope(JSON.stringify(records), { text: textOf(records), count: String(records.length) });
}

const mailCheckpoints = makeCheckpointStore<MailFetchCheckpoint>('mail_fetch');

export function execMailFetch(config: Record<string, string>, stepId: string): Promise<string> {
  return runMailFetch(config, stepId, {
    // Loaded on first use: imapflow and mailparser stay off the startup path.
    service: async () => (await import('../../mail/mailConnection')).sharedMailService(),
    checkpoints: mailCheckpoints,
    log: sendLog,
  });
}
