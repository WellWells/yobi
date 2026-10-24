/**
 * The Mail connector's tools over the user's mailboxes: IMAP per account (`MailBackend`) and each
 * account's SMTP sign-in. Every message id carries its account, so reading, replying and moving
 * always reach the right mailbox. Every error says what to do next in words the model can act on;
 * nothing that fails to resolve comes back as an empty result.
 */
import type { SearchObject } from 'imapflow';
import type { MailBackend, MailFolder, OpenFolder, RawMessage, SpecialUse } from './mailBackend';
import type { ComposedMail, OutgoingMail, ReplyContext } from './mailCompose';
import { decodeMailId, encodeMailId, LEGACY_MAIL_ACCOUNT_ID, MailIdError, qualifyMailId, splitMailId, type MailRef } from './mailIds';
import {
  countAttachments, formatAddresses, listAttachments, replySubject, toMailDetail, toMailSummary,
  type AddressLike, type MailDetail, type MailSummary, type ParsedAttachmentLike, type ParsedMailLike,
} from './mailMessage';
import { LOCAL_BODY_SCAN_MAX, LOCAL_SCAN_MAX, localSearch } from './mailLocalSearch';
import { parseMailQuery, splitNonAsciiTerms, toGmailRaw, toImapSearches } from './mailQuery';

/**
 * 50 rows by default and at most (2026-10-23): a row measured 250-350 characters on a real Gmail,
 * so 50 still fit what the agent shows the model of one result (`BYOK_OBSERVATION_LIMIT` 16,000).
 * Anything left out is said in `truncated`, with the offset of the next page.
 */
export const SEARCH_LIMIT_DEFAULT = 50;
export const SEARCH_LIMIT_MAX = 50;
/**
 * A result longer than this loses rows from the end (and says so) rather than being cut mid-JSON
 * by the agent, which would hide how many messages went missing.
 */
export const SEARCH_RESULT_MAX_CHARS = 14_000;

/** The newest rows that fit in `maxChars` of JSON; always at least one. */
export function fitRows<T>(rows: readonly T[], maxChars: number): T[] {
  let used = 0;
  const kept: T[] = [];
  for (const row of rows) {
    used += JSON.stringify(row).length + 1;
    if (kept.length > 0 && used > maxChars) break;
    kept.push(row);
  }
  return kept;
}

/**
 * Newest first across mailboxes, each mailbox keeping its own (newest-arrival-first) order and only
 * the heads compared by date. Taking more from each mailbox never reorders what came before, so
 * offset pages fit together; sorting everything by date did not when a late arrival carried an old
 * Date (moved in, delivered late): one message came twice and another never.
 */
export function mergeNewest<T extends { date: string }>(lists: readonly (readonly T[])[]): T[] {
  const heads = lists.map(() => 0);
  const merged: T[] = [];
  for (;;) {
    let best = -1;
    for (let i = 0; i < lists.length; i++) {
      const row = lists[i][heads[i]];
      if (row && (best < 0 || row.date.localeCompare(lists[best][heads[best]].date) > 0)) best = i;
    }
    if (best < 0) return merged;
    merged.push(lists[best][heads[best]++]);
  }
}

/**
 * Gmail matches whose ids one skipping search looks up (ids there need a fetch; elsewhere they are
 * known from the UID). Past this the result says older matches were not checked.
 */
export const SKIP_SCAN_MAX = 2_000;

/** Internal to Yobi's own callers, never filled from a tool call. */
export interface SearchOptions {
  /**
   * Messages whose id this accepts are left out before anything is fetched (the read-new-mail
   * step's seen cache): `total` counts only the rest, and mail already handed on costs nothing.
   */
  skip?: (id: string) => boolean;
  /**
   * has:attachment off Gmail reads each candidate's BODYSTRUCTURE, and a message's attachments
   * never change: the read-new-mail step remembers the ones that had none. `known` passes a message
   * over unread; `found` hears of each one just read that carries none.
   */
  attachmentless?: { known: (id: string) => boolean; found: (id: string) => void };
}

/**
 * Messages one has:attachment search looks through off Gmail (no IMAP criterion knows about
 * attachments, so each is fetched and its BODYSTRUCTURE read). Past this the result says so.
 */
export const ATTACHMENT_SCAN_MAX = 1_000;
/** Smallest read of an attachment scan: a small limit must not cost hundreds of round trips. */
export const ATTACHMENT_SCAN_CHUNK_MIN = 100;

/**
 * The newest matches that carry an attachment, read in chunks of `limit * 5` (at least
 * `ATTACHMENT_SCAN_CHUNK_MIN`) until one more than `limit` is found (so the caller knows more
 * exist), every uid is read, or the scan cap is reached. `onNone` hears of each one read without.
 */
export async function scanForAttachments(opened: OpenFolder, uids: readonly number[], limit: number, onNone?: (message: RawMessage) => void): Promise<{ found: RawMessage[]; scanned: number }> {
  const chunk = Math.max(limit * 5, ATTACHMENT_SCAN_CHUNK_MIN);
  const max = Math.max(ATTACHMENT_SCAN_MAX, chunk);
  const found: RawMessage[] = [];
  let scanned = 0;
  while (scanned < uids.length && scanned < max && found.length <= limit) {
    const batch = uids.slice(scanned, Math.min(scanned + chunk, max));
    scanned += batch.length;
    const fetched = (await opened.fetch(batch)).sort((a, b) => b.uid - a.uid);
    for (const message of fetched) {
      if (countAttachments(message.bodyStructure) > 0) found.push(message);
      else onNone?.(message);
    }
  }
  return { found, scanned };
}

export const UPDATE_IDS_MAX = 50;
/** How long a non-Gmail server gets to file a sent message itself before Yobi files a copy. */
export const SENT_COPY_WAIT_MS = 1_500;

/** Why no mailbox could be used, for callers that word it themselves (the flow step). */
export type MailAccountProblem = 'noAccount' | 'sendOnly' | 'unknownAccount';

export class MailToolError extends Error {
  constructor(message: string, readonly reason?: MailAccountProblem) {
    super(message);
    this.name = 'MailToolError';
  }
}

export interface ParsedMail extends ParsedMailLike {
  messageId?: string;
  references?: string | string[];
  replyTo?: readonly AddressLike[];
  attachments?: readonly (ParsedAttachmentLike & { content?: Buffer })[];
}

/** An account as the service sees it: who it is and whether it can read mail. */
export interface MailAccountRef {
  id: string;
  address: string;
  canRead: boolean;
  /**
   * Its mail service files what its SMTP sends in Sent by itself (Gmail, Outlook.com, Microsoft
   * 365), so Yobi never adds a copy: Outlook files it a few seconds later than Yobi used to look,
   * and every mail sent from it ended up in Sent twice (2026-10-23, live).
   */
  serverFilesSent?: boolean;
}

export interface MailServiceDeps {
  /** Every usable account, the default first. */
  accounts: () => MailAccountRef[];
  backend: (accountId: string) => Promise<MailBackend>;
  compose: (mail: OutgoingMail) => Promise<ComposedMail>;
  send: (accountId: string, mail: OutgoingMail) => Promise<void>;
  parse: (raw: Buffer) => Promise<ParsedMail>;
  /** Stores an attachment for the user and returns where; refuses programs. */
  saveFile: (name: string, content: Buffer) => Promise<string>;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
}

export interface SearchArgs { query?: string; folder?: string; limit?: number; account?: string; offset?: number }
export interface ComposeArgs {
  to?: string; cc?: string; bcc?: string; subject?: string; body?: string;
  reply_to?: string; attachments?: readonly string[];
  /** The account it goes out from, by address or id; blank = the account of `reply_to`, else the default. */
  from?: string;
}
export interface SendArgs extends ComposeArgs { draft_id?: string }
export interface UpdateArgs {
  ids: readonly string[]; read?: boolean; starred?: boolean;
  add_labels?: readonly string[]; remove_labels?: readonly string[]; move_to?: string; archive?: boolean;
}

export interface MailSearchResult {
  total: number;
  messages: MailSummary[];
  /** Only for one account: the folder searched. */
  folder?: string;
  /** Accounts that could not be searched, so the model never reads their silence as "no mail". */
  failed?: { account: string; error: string }[];
  /** Said when the search could only cover part of a mailbox (non-English text on Exchange). */
  note?: string;
  /** Where this page starts, when not at the newest. */
  offset?: number;
  /** Said whenever matches were left out of `messages`: how many, and how to get the rest. */
  truncated?: string;
}

const ROLE_ALIASES: Readonly<Record<string, SpecialUse>> = {
  sent: '\\Sent', drafts: '\\Drafts', draft: '\\Drafts', trash: '\\Trash', bin: '\\Trash', junk: '\\Junk', spam: '\\Junk',
  archive: '\\Archive', all: '\\All', 'all mail': '\\All', starred: '\\Flagged', flagged: '\\Flagged',
};

const ROLE_NAMES: Readonly<Record<SpecialUse, string>> = {
  '\\Inbox': 'inbox', '\\All': 'all', '\\Archive': 'archive', '\\Drafts': 'drafts', '\\Flagged': 'starred',
  '\\Junk': 'spam', '\\Sent': 'sent', '\\Trash': 'trash',
};

export function intersectAll(lists: readonly (readonly number[])[]): number[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  const sets = rest.map((list) => new Set(list));
  return first.filter((uid) => sets.every((set) => set.has(uid)));
}

export function findFolder(folders: readonly MailFolder[], wanted: string): MailFolder | undefined {
  const key = wanted.trim().toLowerCase();
  if (!key) return undefined;
  if (key === 'inbox') return folders.find((f) => f.path.toUpperCase() === 'INBOX') ?? folders.find((f) => f.specialUse === '\\Inbox');
  const exact = folders.find((f) => f.path === wanted.trim());
  if (exact) return exact;
  const role = ROLE_ALIASES[key];
  if (role) {
    const special = folders.find((f) => f.specialUse === role);
    if (special) return special;
  }
  return folders.find((f) => f.path.toLowerCase() === key || f.name.toLowerCase() === key);
}

function folderList(folders: readonly MailFolder[]): string {
  return folders.slice(0, 30).map((f) => f.path).join(', ');
}

function hasFlag(message: RawMessage, flag: string): boolean {
  return message.flags.some((f) => f.toLowerCase() === flag.toLowerCase());
}

/** One account, connected. */
interface Mailbox {
  account: MailAccountRef;
  backend: MailBackend;
}

export function createMailService(deps: MailServiceDeps) {
  function accountList(): string {
    return deps.accounts().map((account) => account.address).join(', ') || 'none';
  }

  /** An account named by address or id; blank = the default. */
  function accountNamed(ref: string | undefined): MailAccountRef {
    const accounts = deps.accounts();
    const key = (ref ?? '').trim().toLowerCase();
    if (!key) {
      if (accounts.length === 0) throw new MailToolError('No mail account is set up. The user adds one in Settings › Connectors › Mail.', 'noAccount');
      return accounts[0];
    }
    const found = accounts.find((account) => account.id === key || account.address.toLowerCase() === key);
    if (!found) throw new MailToolError(`No mail account "${ref}". Accounts: ${accountList()}`, 'unknownAccount');
    return found;
  }

  async function open(account: MailAccountRef): Promise<Mailbox> {
    if (!account.canRead) throw new MailToolError(`${account.address} can only send (no incoming server), so its mail cannot be read`, 'sendOnly');
    return { account, backend: await deps.backend(account.id) };
  }

  /**
   * The mailbox a message id belongs to, and the id inside it. An id without a mailbox is from before
   * multiple mailboxes: the upgraded account's, or the only one there is — never "the default now",
   * where the same folder and UID could be someone else's message.
   */
  async function mailboxOf(id: string): Promise<{ box: Mailbox; messageId: string }> {
    const { accountId, messageId } = splitMailId(id);
    const accounts = deps.accounts();
    if (!accountId) {
      const owner = accounts.find((entry) => entry.id === LEGACY_MAIL_ACCOUNT_ID) ?? (accounts.length === 1 ? accounts[0] : undefined);
      if (!owner) {
        if (accounts.length === 0) accountNamed('');
        throw new MailIdError(`"${id}" does not say which mailbox it is from; search again and use an id from its results`);
      }
      return { box: await open(owner), messageId };
    }
    const account = accounts.find((entry) => entry.id === accountId);
    if (!account) throw new MailIdError(`Message id "${id}" belongs to a mail account that is no longer set up; search again`);
    return { box: await open(account), messageId };
  }

  async function folderFor(backend: MailBackend, wanted: string | undefined, fallback: SpecialUse | 'INBOX'): Promise<MailFolder> {
    const folders = await backend.folders(false);
    if (wanted?.trim()) {
      const found = findFolder(folders, wanted);
      if (!found) throw new MailToolError(`No folder "${wanted}". Folders: ${folderList(folders)}`);
      return found;
    }
    const found = fallback === 'INBOX' ? findFolder(folders, 'inbox') : folders.find((f) => f.specialUse === fallback);
    if (!found) {
      throw new MailToolError(`This mailbox has no ${fallback === 'INBOX' ? 'inbox' : ROLE_NAMES[fallback]} folder. Folders: ${folderList(folders)}`);
    }
    return found;
  }

  function idOf(box: Mailbox, folder: OpenFolder, message: Pick<RawMessage, 'uid' | 'emailId'>): string {
    const ref: MailRef = box.backend.gmail && message.emailId
      ? { kind: 'gmail', emailId: message.emailId }
      : { kind: 'imap', folder: folder.path, uidValidity: folder.uidValidity, uid: message.uid };
    return qualifyMailId(box.account.id, encodeMailId(ref));
  }

  /** Opens the folder holding message `id` in its own mailbox and runs `work` on it. */
  async function withMessage<T>(id: string, work: (box: Mailbox, folder: OpenFolder, uid: number) => Promise<T>): Promise<T> {
    const { box, messageId } = await mailboxOf(id);
    const ref = decodeMailId(messageId);
    if (ref.kind === 'imap') {
      return box.backend.withFolder(ref.folder, async (folder) => {
        if (folder.uidValidity !== ref.uidValidity) {
          throw new MailIdError(`Message id "${id}" is out of date (the folder was rebuilt); search again`);
        }
        // A STORE or MOVE on a UID that is gone succeeds silently: check first, or a second move of
        // the same message would be reported as done.
        if (!(await folder.search({ uid: String(ref.uid) })).includes(ref.uid)) {
          throw new MailIdError(`Message "${id}" is no longer in ${ref.folder} (moved or deleted); search again`);
        }
        return work(box, folder, ref.uid);
      });
    }
    const folders = await box.backend.folders(false);
    for (const role of ['\\All', '\\Trash', '\\Junk'] as const) {
      const holder = folders.find((f) => f.specialUse === role);
      if (!holder) continue;
      const result = await box.backend.withFolder(holder.path, async (folder) => {
        const [uid] = await folder.search({ emailId: ref.emailId });
        return uid === undefined ? null : { value: await work(box, folder, uid) };
      });
      if (result) return result.value;
    }
    throw new MailIdError(`Message "${id}" is gone (deleted or moved out of reach); search again`);
  }

  async function readParsed(id: string): Promise<{ box: Mailbox; parsed: ParsedMail }> {
    const found = await withMessage(id, async (box, folder, uid) => ({ box, raw: await folder.source(uid) }));
    if (!found.raw) throw new MailIdError(`Message "${id}" is gone; search again`);
    return { box: found.box, parsed: await deps.parse(found.raw) };
  }

  /**
   * The matches `skip` does not accept, newest first. Off Gmail the id is known from the UID, so
   * nothing is fetched; Gmail ids need a lookup, of the newest `SKIP_SCAN_MAX` at most.
   */
  async function unskipped(box: Mailbox, opened: OpenFolder, uids: readonly number[], skip: (id: string) => boolean): Promise<{ uids: number[]; checked: number }> {
    if (!box.backend.gmail) return { uids: uids.filter((uid) => !skip(idOf(box, opened, { uid }))), checked: uids.length };
    const window = uids.slice(0, SKIP_SCAN_MAX);
    const known = opened.emailIds ? await opened.emailIds(window) : await opened.fetch(window);
    const byUid = new Map(known.map((m) => [m.uid, m]));
    return {
      uids: window.filter((uid) => {
        const found = byUid.get(uid);
        return found !== undefined && !skip(idOf(box, opened, found));
      }),
      checked: window.length,
    };
  }

  /**
   * One mailbox's newest `limit` matches, in the mailbox's own order (newest arrival first).
   * `atLeast` = `total` is only a lower bound (has:attachment off Gmail, or a skipping search on
   * Gmail, where the count is known only as far as the scan went).
   */
  async function searchOne(box: Mailbox, args: SearchArgs, limit: number, label: boolean, options: SearchOptions = {}): Promise<{ folder: string; total: number; atLeast?: boolean; messages: MailSummary[]; note?: string }> {
    const { backend } = box;
    const folder = await folderFor(backend, args.folder, backend.gmail ? '\\All' : 'INBOX');
    const query = (args.query ?? '').trim();
    let criteria: SearchObject[];
    let attachmentsOnly = false;
    let split: ReturnType<typeof splitNonAsciiTerms> | null = null;
    if (backend.gmail) {
      const raw = toGmailRaw(query);
      criteria = [raw ? { gmraw: raw } : { all: true }];
    } else {
      const parsed = parseMailQuery(query, deps.now());
      criteria = toImapSearches(parsed);
      attachmentsOnly = parsed.hasAttachment === true;
      split = splitNonAsciiTerms(parsed);
    }
    return backend.withFolder(folder.path, async (opened) => {
      const run = async (list: readonly SearchObject[]): Promise<number[]> => {
        const lists: number[][] = [];
        for (const criterion of list) lists.push(await opened.search(criterion));
        return intersectAll(lists).sort((a, b) => b - a);
      };
      let uids = await run(criteria);
      let note: string | undefined;
      // Nothing found for non-English text may only mean the server cannot search it (Exchange):
      // check the newest messages here before answering "no such mail".
      if (uids.length === 0 && split?.local) {
        const pool = await run(toImapSearches(split.server));
        const candidates = (await opened.fetch(pool.slice(0, LOCAL_SCAN_MAX))).sort((a, b) => b.uid - a.uid);
        const found = await localSearch(candidates, split.local, async (uid) => {
          const raw = await opened.source(uid);
          return raw ? (await deps.parse(raw)).text ?? '' : '';
        });
        uids = found.uids;
        if (pool.length > LOCAL_SCAN_MAX || !found.complete) {
          note = `This mail server cannot search non-English text, so Yobi checked the newest messages itself (${LOCAL_SCAN_MAX} by sender, recipients and subject, ${LOCAL_BODY_SCAN_MAX} by body); older ones were not searched. Narrow the dates to search further back.`;
        }
      }
      let atLeast = false;
      const { skip, attachmentless } = options;
      if (skip) {
        const kept = await unskipped(box, opened, uids, skip);
        if (kept.checked < uids.length) {
          atLeast = true;
          const cut = `Only the newest ${kept.checked} matches were checked for mail not yet handed on; older ones were not. Narrow the dates to search further back.`;
          note = note ? `${note} ${cut}` : cut;
        }
        uids = kept.uids;
      }
      let messages: RawMessage[];
      let total = uids.length;
      if (attachmentsOnly) {
        // Mail already known to carry no attachment is passed over unread: it could not match.
        const candidates = attachmentless ? uids.filter((uid) => !attachmentless.known(idOf(box, opened, { uid }))) : uids;
        const scan = await scanForAttachments(opened, candidates, limit, attachmentless ? (m) => attachmentless.found(idOf(box, opened, m)) : undefined);
        messages = scan.found.slice(0, limit);
        total = scan.found.length;
        if (scan.scanned < candidates.length) {
          // More matches than the page proves there are more to page to; fewer means the scan ran
          // out of room, and paging would find nothing new.
          atLeast = true;
          if (scan.found.length <= limit) {
            const cut = `Only the newest ${scan.scanned} messages were checked for an attachment; older ones were not. Narrow the dates to search further back.`;
            note = note ? `${note} ${cut}` : cut;
          }
        }
      } else {
        messages = (await opened.fetch(uids.slice(0, limit))).sort((a, b) => b.uid - a.uid);
      }
      const own = box.account.address.toLowerCase();
      return {
        folder: folder.path,
        total,
        ...(atLeast ? { atLeast } : {}),
        messages: messages.map((m) => {
          const summary = toMailSummary({
            id: idOf(box, opened, m), from: m.from, replyTo: m.replyTo, to: m.to, subject: m.subject, date: m.date,
            unread: !hasFlag(m, '\\Seen'), starred: hasFlag(m, '\\Flagged'),
            attachments: countAttachments(m.bodyStructure), labels: m.labels,
          });
          // Mail to the mailbox itself says nothing by naming it: shorter rows, more of them read.
          const toOnlySelf = (m.to ?? []).length === 1 && (m.to?.[0]?.address ?? '').toLowerCase() === own;
          if (toOnlySelf) delete summary.to;
          return { ...summary, ...(label ? { account: box.account.address } : {}) };
        }),
        ...(note ? { note } : {}),
      };
    });
  }

  /**
   * One account when named, otherwise every account that can read mail, newest first across all.
   * An account that fails is listed in `failed` and the others still answer.
   */
  async function search(args: SearchArgs, options: SearchOptions = {}): Promise<MailSearchResult> {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? SEARCH_LIMIT_DEFAULT), 1), SEARCH_LIMIT_MAX);
    const offset = Math.max(Math.floor(args.offset ?? 0), 0);
    // Each mailbox gives its newest `offset + limit`; the page is cut from the merged list.
    const take = offset + limit;
    let readable: MailAccountRef[];
    if (args.account?.trim()) readable = [accountNamed(args.account)];
    else {
      readable = deps.accounts().filter((account) => account.canRead);
      if (readable.length === 0) {
        if (deps.accounts().length === 0) {
          throw new MailToolError('No mail account is set up. The user adds one in Settings › Connectors › Mail.', 'noAccount');
        }
        throw new MailToolError(`No mail account here can read mail (${accountList()} can only send)`, 'sendOnly');
      }
    }
    const several = readable.length > 1;
    let total = 0;
    let atLeast = false;
    let folder: string | undefined;
    const lists: MailSummary[][] = [];
    const failed: { account: string; error: string }[] = [];
    const notes: string[] = [];
    for (const account of readable) {
      try {
        const result = await searchOne(await open(account), args, take, several, options);
        total += result.total;
        if (result.atLeast) atLeast = true;
        folder = result.folder;
        lists.push(result.messages);
        if (result.note) notes.push(several ? `${account.address}: ${result.note}` : result.note);
      } catch (err) {
        if (!several) throw err;
        failed.push({ account: account.address, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (several && failed.length === readable.length) {
      throw new MailToolError(`No mailbox could be searched: ${failed.map((f) => `${f.account}: ${f.error}`).join('; ')}`);
    }
    const messages = fitRows(mergeNewest(lists).slice(offset, take), SEARCH_RESULT_MAX_CHARS);
    const shownTo = offset + messages.length;
    const count = atLeast ? `at least ${total}` : String(total);
    return {
      ...(several ? {} : { folder }),
      total,
      ...(offset > 0 ? { offset } : {}),
      messages,
      ...(total > shownTo ? {
        truncated: `Only messages ${offset + 1}-${shownTo} of ${count} are listed, newest first; the rest were cut. Narrow the search (dates, sender) or call again with offset: ${shownTo} for the next ones. Do not describe all ${count} from this page alone.`,
      } : {}),
      ...(failed.length > 0 ? { failed } : {}),
      ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    };
  }

  async function read(id: string): Promise<MailDetail & { account?: string }> {
    const { box, parsed } = await readParsed(id);
    const detail = toMailDetail(id, parsed);
    return deps.accounts().length > 1 ? { ...detail, account: box.account.address } : detail;
  }

  async function folders(account?: string): Promise<Record<string, unknown>> {
    const describe = async (box: Mailbox) => (await box.backend.folders(true)).map((f) => ({
      path: f.path,
      ...(f.specialUse ? { role: ROLE_NAMES[f.specialUse] } : f.path.toUpperCase() === 'INBOX' ? { role: 'inbox' } : {}),
      ...(f.unread !== undefined ? { unread: f.unread } : {}),
      ...(f.total !== undefined ? { total: f.total } : {}),
    }));
    const readable = deps.accounts().filter((entry) => entry.canRead);
    if (account?.trim() || readable.length <= 1) {
      return { folders: await describe(await open(account?.trim() ? accountNamed(account) : (readable[0] ?? accountNamed('')))) };
    }
    const accounts: Record<string, unknown>[] = [];
    for (const entry of readable) {
      try {
        accounts.push({ account: entry.address, folders: await describe(await open(entry)) });
      } catch (err) {
        accounts.push({ account: entry.address, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { accounts };
  }

  async function saveAttachment(id: string, which: string | number | undefined): Promise<{ saved_to: string; name: string; size: number }> {
    const { parsed } = await readParsed(id);
    const named = listAttachments(parsed);
    if (named.length === 0) throw new MailToolError('This message has no attachments');
    const names = named.map((a) => a.name).join(', ');
    let pick = named.length === 1 && (which === undefined || which === '') ? named[0] : undefined;
    if (!pick && typeof which === 'number') pick = named.find((a) => a.index === which);
    if (!pick && typeof which === 'string' && which.trim()) {
      const key = which.trim().toLowerCase();
      pick = named.find((a) => a.name.toLowerCase() === key) ?? named.find((a) => a.name.toLowerCase().includes(key));
    }
    if (!pick) throw new MailToolError(`Say which attachment to save; this message has: ${names}`);
    const content = parsed.attachments?.[pick.index]?.content;
    if (!content) throw new MailToolError(`Attachment "${pick.name}" could not be read`);
    const savedTo = await deps.saveFile(pick.name, content);
    return { saved_to: savedTo, name: pick.name, size: content.length };
  }

  /**
   * The mail a draft or send call describes, the account it goes out from (`from`, else the account
   * that received the mail it answers, else the default) and reply headers from the original.
   */
  async function outgoing(args: ComposeArgs): Promise<{ sender: MailAccountRef; mail: OutgoingMail }> {
    let reply: ReplyContext | undefined;
    let defaultTo = '';
    let receivedBy: MailAccountRef | undefined;
    if (args.reply_to?.trim()) {
      const { box, parsed: original } = await readParsed(args.reply_to);
      receivedBy = box.account;
      reply = { messageId: original.messageId, references: original.references, subject: original.subject };
      defaultTo = formatAddresses(original.replyTo && original.replyTo.length > 0 ? original.replyTo : original.from);
    }
    const sender = args.from?.trim() ? accountNamed(args.from) : (receivedBy ?? accountNamed(''));
    const to = args.to?.trim() || defaultTo;
    if (!to) throw new MailToolError('Say who the mail is to ("to")');
    const subject = args.subject?.trim() || (reply ? replySubject(reply.subject) : '');
    if (!subject) throw new MailToolError('Give the mail a subject');
    return {
      sender,
      mail: {
        from: sender.address,
        to,
        subject,
        body: args.body ?? '',
        ...(args.cc?.trim() ? { cc: args.cc.trim() } : {}),
        ...(args.bcc?.trim() ? { bcc: args.bcc.trim() } : {}),
        ...(args.attachments && args.attachments.length > 0 ? { attachments: args.attachments.map((path) => ({ path })) } : {}),
        ...(reply ? { replyTo: reply } : {}),
      },
    };
  }

  async function idByMessageId(box: Mailbox, folderPath: string, messageId: string): Promise<string | undefined> {
    return box.backend.withFolder(folderPath, async (folder) => {
      const [uid] = (await folder.search({ header: { 'message-id': messageId } })).sort((a, b) => b - a);
      if (uid === undefined) return undefined;
      const [message] = await folder.fetch([uid]);
      return message ? idOf(box, folder, message) : undefined;
    });
  }

  async function draft(args: ComposeArgs): Promise<Record<string, unknown>> {
    const { sender, mail } = await outgoing(args);
    const box = await open(sender);
    const drafts = await folderFor(box.backend, undefined, '\\Drafts');
    const composed = await deps.compose(mail);
    const appended = await box.backend.append(drafts.path, composed.raw, ['\\Draft', '\\Seen']);
    const id = !box.backend.gmail && appended.uid !== undefined && appended.uidValidity
      ? qualifyMailId(sender.id, encodeMailId({ kind: 'imap', folder: drafts.path, uidValidity: appended.uidValidity, uid: appended.uid }))
      : await idByMessageId(box, drafts.path, composed.messageId);
    return {
      saved: 'draft', ...(id ? { id } : {}), from: sender.address, folder: drafts.path,
      to: mail.to, ...(mail.cc ? { cc: mail.cc } : {}), subject: mail.subject, message_id: composed.messageId,
    };
  }

  async function trashIds(ids: readonly string[]): Promise<{ trash: string[]; moved: number }> {
    const trashFolders = new Set<string>();
    let moved = 0;
    for (const id of ids) {
      await withMessage(id, async (box, folder, uid) => {
        const trash = await folderFor(box.backend, undefined, '\\Trash');
        trashFolders.add(trash.path);
        if (folder.path !== trash.path) await folder.move([uid], trash.path);
      });
      moved++;
    }
    return { trash: [...trashFolders], moved };
  }

  /** Only a draft: `draft_id` must never be a way to trash some other message unasked. */
  async function trashDraft(id: string): Promise<void> {
    await withMessage(id, async (box, folder, uid) => {
      const drafts = await folderFor(box.backend, undefined, '\\Drafts');
      const trash = await folderFor(box.backend, undefined, '\\Trash');
      const [message] = await folder.fetch([uid]);
      // Gmail's `\Draft` label arrives as the flag (`toRaw` in mailClient.ts).
      if (folder.path !== drafts.path && !(message && hasFlag(message, '\\Draft'))) {
        throw new MailToolError(`"${id}" is not a draft, so it was left where it is`);
      }
      if (folder.path !== trash.path) await folder.move([uid], trash.path);
    });
  }

  async function send(args: SendArgs): Promise<Record<string, unknown>> {
    const { sender, mail } = await outgoing(args);
    const composed = await deps.compose(mail);
    await deps.send(sender.id, { ...mail, messageId: composed.messageId });
    const notes: string[] = [];
    if (args.draft_id?.trim()) {
      try {
        await trashDraft(args.draft_id);
      } catch (err) {
        notes.push(`Sent, but the draft could not be removed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Gmail and Microsoft file what their SMTP sends; other servers may not, so look and file a copy if absent.
    if (sender.canRead && !sender.serverFilesSent) {
      try {
        const box = await open(sender);
        if (!box.backend.gmail) {
          const sent = (await box.backend.folders(false)).find((f) => f.specialUse === '\\Sent');
          if (sent) {
            await deps.wait(SENT_COPY_WAIT_MS);
            const filed = await idByMessageId(box, sent.path, composed.messageId).catch(() => undefined);
            if (!filed) await box.backend.append(sent.path, composed.raw, ['\\Seen']);
          }
        }
      } catch {
        notes.push('Sent, but no copy was saved in Sent');
      }
    }
    return {
      sent: true, from: sender.address, to: mail.to, ...(mail.cc ? { cc: mail.cc } : {}), subject: mail.subject, message_id: composed.messageId,
      ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    };
  }

  async function update(args: UpdateArgs): Promise<Record<string, unknown>> {
    if (args.ids.length === 0) throw new MailToolError('Give the ids of the messages to change');
    if (args.ids.length > UPDATE_IDS_MAX) throw new MailToolError(`At most ${UPDATE_IDS_MAX} messages per call`);
    const labels = [...(args.add_labels ?? []), ...(args.remove_labels ?? [])];
    const anything = args.read !== undefined || args.starred !== undefined || labels.length > 0 || Boolean(args.move_to?.trim()) || args.archive === true;
    if (!anything) throw new MailToolError('Say what to change: read, starred, add_labels, remove_labels, archive or move_to');
    const destinations = new Set<string>();
    for (const id of args.ids) {
      await withMessage(id, async (box, folder, uid) => {
        const { backend } = box;
        if (labels.length > 0 && !backend.gmail) throw new MailToolError('Labels exist only on Gmail; use move_to with a folder instead');
        const destination = args.move_to?.trim()
          ? await folderFor(backend, args.move_to, 'INBOX')
          : args.archive && !backend.gmail ? await folderFor(backend, undefined, '\\Archive') : undefined;
        if (args.read !== undefined) await (args.read ? folder.addFlags([uid], ['\\Seen']) : folder.removeFlags([uid], ['\\Seen']));
        if (args.starred !== undefined) await (args.starred ? folder.addFlags([uid], ['\\Flagged']) : folder.removeFlags([uid], ['\\Flagged']));
        if (args.add_labels?.length) await folder.addLabels([uid], args.add_labels);
        if (args.remove_labels?.length) await folder.removeLabels([uid], args.remove_labels);
        if (args.archive && backend.gmail) await folder.removeLabels([uid], ['\\Inbox']);
        if (destination) {
          destinations.add(destination.path);
          if (folder.path !== destination.path) await folder.move([uid], destination.path);
        }
      });
    }
    return { updated: args.ids.length, ...(destinations.size > 0 ? { folder: [...destinations].join(', ') } : {}) };
  }

  async function trash(ids: readonly string[]): Promise<Record<string, unknown>> {
    if (ids.length === 0) throw new MailToolError('Give the ids of the messages to move to the trash');
    if (ids.length > UPDATE_IDS_MAX) throw new MailToolError(`At most ${UPDATE_IDS_MAX} messages per call`);
    const result = await trashIds(ids);
    return { moved_to_trash: result.moved, folder: result.trash.join(', ') };
  }

  return { search, read, folders, saveAttachment, draft, send, update, trash };
}

export type MailService = ReturnType<typeof createMailService>;
