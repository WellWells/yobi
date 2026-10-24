/**
 * The IMAP operations the mail service is built from. `mailClient.ts` implements it with imapflow;
 * tests implement it in memory. UIDs are always IMAP UIDs, never sequence numbers.
 */
import type { SearchObject } from 'imapflow';
import type { AddressLike, BodyStructureLike } from './mailMessage';

/** RFC 6154 special-use flags, as the server reports them (`\Drafts`, `\Sent`, …). */
export type SpecialUse = '\\Inbox' | '\\All' | '\\Archive' | '\\Drafts' | '\\Flagged' | '\\Junk' | '\\Sent' | '\\Trash';

export interface MailFolder {
  path: string;
  name: string;
  specialUse?: SpecialUse;
  unread?: number;
  total?: number;
}

export interface RawMessage {
  uid: number;
  /** Gmail's X-GM-MSGID (or OBJECTID), the same across every label the message carries. */
  emailId?: string;
  messageId?: string;
  from?: AddressLike[];
  replyTo?: AddressLike[];
  to?: AddressLike[];
  subject?: string;
  date?: Date;
  flags: readonly string[];
  /** Gmail labels; empty elsewhere. */
  labels?: readonly string[];
  bodyStructure?: BodyStructureLike;
  size?: number;
}

export interface OpenFolder {
  readonly path: string;
  readonly uidValidity: string;
  search(criteria: SearchObject): Promise<number[]>;
  fetch(uids: readonly number[]): Promise<RawMessage[]>;
  /** Only the UID and Gmail's X-GM-MSGID: a few bytes a message, where `fetch` reads headers too. */
  emailIds?(uids: readonly number[]): Promise<Pick<RawMessage, 'uid' | 'emailId'>[]>;
  source(uid: number): Promise<Buffer | null>;
  addFlags(uids: readonly number[], flags: readonly string[]): Promise<void>;
  removeFlags(uids: readonly number[], flags: readonly string[]): Promise<void>;
  addLabels(uids: readonly number[], labels: readonly string[]): Promise<void>;
  removeLabels(uids: readonly number[], labels: readonly string[]): Promise<void>;
  move(uids: readonly number[], destination: string): Promise<void>;
}

export interface AppendResult {
  uid?: number;
  uidValidity?: string;
}

export interface MailBackend {
  /** The server speaks Gmail's extensions (X-GM-RAW, labels, X-GM-MSGID). */
  readonly gmail: boolean;
  folders(withCounts: boolean): Promise<MailFolder[]>;
  /** Selects the folder for the duration of `work`; calls are serialized per connection. */
  withFolder<T>(path: string, work: (folder: OpenFolder) => Promise<T>): Promise<T>;
  append(path: string, raw: Buffer, flags: readonly string[]): Promise<AppendResult>;
}
