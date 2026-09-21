import { asRecord, parseJsonValue } from '../toolContracts';
import type { Args, Fact, LedgerView } from '../toolContracts';

/**
 * What the Thunderbird add-on's read tools tell us about the user's mailbox, reduced to the three
 * things the gate reasons about: who the user can send as, where folders are, and which messages
 * the model has actually seen. Shapes are the add-on's own (v0.7.4 `api.js`), not guesses.
 */
export const TB_IDENTITY = 'tb.identity';
export const TB_FOLDER = 'tb.folder';
export const TB_MESSAGE = 'tb.message';

export interface MailIdentity {
  email: string;
  name: string;
  accountId: string;
  identityId: string;
}

const BODY_LIMIT = 6_000;

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function rowsOf(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : asRecord(value)?.messages;
  return Array.isArray(list) ? list.map(asRecord).filter((row): row is Record<string, unknown> => row !== null) : [];
}

function messageFact(row: Record<string, unknown>, folderPath: string): Fact | null {
  const id = str(row.id ?? row.messageId);
  if (!id) return null;
  const primary = str(row.folderPath) || folderPath;
  const dups = Array.isArray(row.dupLocations) ? row.dupLocations.map(str).filter(Boolean) : [];
  const body = str(row.body);
  return {
    kind: TB_MESSAGE,
    key: id,
    source: 'tool',
    fields: {
      id,
      subject: str(row.subject),
      author: str(row.author),
      recipients: str(row.recipients),
      cc: str(row.ccList),
      date: str(row.date),
      folderPath: primary,
      folders: [primary, ...dups].filter(Boolean).join('\n'),
      ...(body ? { body: body.slice(0, BODY_LIMIT) } : {}),
    },
  };
}

export function extractThunderbirdFacts(tool: string, args: Args, text: string): Fact[] {
  const value = parseJsonValue(text);
  if (value === undefined) return [];
  switch (tool) {
    case 'listAccounts':
      return (Array.isArray(value) ? value : []).flatMap((raw) => {
        const account = asRecord(raw);
        const identities = Array.isArray(account?.identities) ? account!.identities : [];
        return identities.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry && str(entry.email)))
          .map((entry) => ({
            kind: TB_IDENTITY,
            key: str(entry.email),
            source: 'runtime' as const,
            fields: { email: str(entry.email), name: str(entry.name), accountId: str(account!.id), identityId: str(entry.id) },
          }));
      });
    case 'listFolders':
      return (Array.isArray(value) ? value : []).map(asRecord)
        .filter((folder): folder is Record<string, unknown> => Boolean(folder && str(folder.path)))
        .map((folder) => ({
          kind: TB_FOLDER,
          key: str(folder.path),
          source: 'runtime' as const,
          fields: { path: str(folder.path), type: str(folder.type), accountId: str(folder.accountId), name: str(folder.name) },
        }));
    case 'searchMessages':
    case 'getRecentMessages':
    case 'getMessages':
      return rowsOf(value).map((row) => messageFact(row, '')).filter((fact): fact is Fact => fact !== null);
    case 'getMessage': {
      const fact = asRecord(value) ? messageFact(asRecord(value)!, str(args.folderPath)) : null;
      return fact ? [fact] : [];
    }
    default:
      return [];
  }
}

export function identities(ledger: LedgerView): MailIdentity[] {
  return ledger.facts(TB_IDENTITY).map((fact) => ({
    email: fact.fields.email ?? fact.key,
    name: fact.fields.name ?? '',
    accountId: fact.fields.accountId ?? '',
    identityId: fact.fields.identityId ?? '',
  }));
}

export function findIdentity(ledger: LedgerView, from: string): MailIdentity | undefined {
  const wanted = from.trim().toLowerCase();
  const bare = wanted.match(/<([^>]+)>/)?.[1] ?? wanted;
  return identities(ledger).find((identity) => identity.email.toLowerCase() === bare || identity.identityId.toLowerCase() === bare);
}

export function identityLabel(identity: MailIdentity): string {
  return identity.name ? `${identity.name} <${identity.email}>` : identity.email;
}

/** The accounts the user can send as, once a lookup has read them. '' before that. */
export function renderIdentityContext(ledger: LedgerView): string {
  const all = identities(ledger);
  return all.length === 0 ? '' : `thunderbird accounts: ${all.map((identity) => `${identityLabel(identity)} [${identity.accountId}]`).join(' · ')}`;
}

/** The identity whose account owns a folder — what the add-on itself sends a reply as. */
export function accountForFolder(ledger: LedgerView, folderPath: string): MailIdentity | undefined {
  const all = identities(ledger);
  const accountId = ledger.fact(TB_FOLDER, folderPath)?.fields.accountId;
  if (accountId) {
    const owned = all.filter((identity) => identity.accountId === accountId);
    if (owned.length > 0) return owned[0];
  }
  const user = folderPath.match(/^[a-z]+:\/\/([^@/]+)@/i)?.[1];
  if (!user) return undefined;
  const decoded = decodeURIComponent(user).toLowerCase();
  const exact = all.find((identity) => identity.email.toLowerCase() === decoded);
  if (exact) return exact;
  const byLocal = all.filter((identity) => identity.email.toLowerCase().split('@')[0] === decoded);
  return byLocal.length === 1 ? byLocal[0] : undefined;
}

export function draftsFolderFor(ledger: LedgerView, accountId: string, type: 'drafts' | 'sent'): string | undefined {
  return ledger.facts(TB_FOLDER).find((fact) => fact.fields.accountId === accountId && fact.fields.type === type)?.fields.path;
}

export function emailsIn(text: string): string[] {
  return (text.match(/[^\s<>,;:"'()]+@[^\s<>,;:"'()]+\.[a-z]{2,}/gi) ?? []).map((email) => email.toLowerCase());
}

export function isOwnAuthor(ledger: LedgerView, author: string): boolean {
  const own = new Set(identities(ledger).map((identity) => identity.email.toLowerCase()));
  return emailsIn(author).some((email) => own.has(email));
}

export function normalizeSubject(subject: string): string {
  let current = subject.trim();
  for (;;) {
    const next = current.replace(/^(re|fwd?|fw|回覆|回复|轉寄|转发)\s*[:：]\s*/i, '');
    if (next === current) break;
    current = next;
  }
  return current.replace(/\s+/g, ' ').toLowerCase();
}

const STOP_TOKENS = new Set(['thanks', 'regards', 'dear', 'hello', 'http', 'https', 'www', 'mail', 'gmail', 'outlook']);

/** Tokens distinctive enough that finding one in the user's words means they named this message. */
export function distinctiveTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = (lower.match(/[a-z0-9][a-z0-9_-]{3,}/g) ?? []).filter((token) => !STOP_TOKENS.has(token));
  const cjk = (text.match(/[㐀-鿿]{3,}/g) ?? []).flatMap((run) =>
    Array.from({ length: run.length - 2 }, (_unused, index) => run.slice(index, index + 3)));
  return [...new Set([...latin, ...cjk])];
}

export function mentionedByUser(ledger: LedgerView, fact: Fact): boolean {
  const words = ledger.userWords.toLowerCase();
  if (words.includes(fact.key.toLowerCase())) return true;
  const tokens = distinctiveTokens(`${fact.fields.subject ?? ''} ${fact.fields.author ?? ''}`);
  return tokens.some((token) => words.includes(token));
}

export function authorName(author: string): string {
  const name = author.replace(/<[^>]*>/g, '').replace(/"/g, '').trim();
  return name || (emailsIn(author)[0] ?? author);
}

export function messageLabel(fact: Fact): string {
  const date = new Date(fact.fields.date ?? '');
  const when = Number.isNaN(date.getTime())
    ? ''
    : ` (${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')})`;
  return `${authorName(fact.fields.author ?? '')} — ${fact.fields.subject || '(no subject)'}${when}`;
}
