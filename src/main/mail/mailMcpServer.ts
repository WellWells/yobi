/**
 * In-process MCP server for the user's own mailbox (IMAP to read, the shared SMTP account to send),
 * backed by `mailService.ts`, which it takes as a parameter.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createToolServer } from '../mcp/inProcessServer';
import { SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, type ComposeArgs, type MailService } from './mailService';

export const MAIL_SERVER_NAME = 'mail';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const ID = { type: 'string', description: 'A message id from mail_search' } as const;
const IDS = { type: 'array', items: { type: 'string' }, description: 'Message ids from mail_search' } as const;

const COMPOSE_PROPERTIES = {
  to: { type: 'string', description: 'Recipients, comma-separated; for a reply, leave out to answer the sender' },
  cc: { type: 'string', description: 'Cc recipients, comma-separated' },
  bcc: { type: 'string', description: 'Bcc recipients, comma-separated' },
  subject: { type: 'string', description: 'For a reply, leave out for "Re: <original subject>"' },
  body: { type: 'string', description: 'The message in Markdown, in the language the user writes to this person in' },
  reply_to: { type: 'string', description: 'Id of the message this answers; threads it under that conversation' },
  attachments: { type: 'array', items: { type: 'string' }, description: 'Paths of local files to attach' },
  from: { type: 'string', description: "Which of the user's mail accounts sends it, by address; leave out for the account that received the mail it answers, else the default" },
} as const;

const ACCOUNT = { type: 'string', description: "One of the user's mail accounts, by address; leave out for all of them" } as const;

export const MAIL_TOOLS: Tool[] = [
  {
    name: 'mail_search',
    description:
      "Search the user's own mail (every account at once unless one is named); newest first. query uses Gmail search syntax: from:, to:, subject:, \"exact phrase\", is:unread, is:starred, has:attachment, after:YYYY-MM-DD, before:YYYY-MM-DD, newer_than:7d; on Gmail every Gmail operator works (label:, category:). Leave query out for the latest mail. Returns the total and up to 50 ids, senders, subjects and times — read a message with mail_read. When the result has \"truncated\", more matched than were listed: page on with offset or narrow the search before summing anything up.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail-style search; dates only when the user named them' },
        folder: { type: 'string', description: 'Folder path or role (inbox, sent, drafts, trash, spam, archive); default: all mail on Gmail, the inbox elsewhere' },
        limit: { type: 'number', description: `Messages to return, 1-${SEARCH_LIMIT_MAX}; default ${SEARCH_LIMIT_DEFAULT}` },
        offset: { type: 'number', description: 'Skip this many of the newest matches, to get the next page when the result says it was truncated' },
        account: ACCOUNT,
      },
    },
    annotations: { title: 'Search mail', ...READ_ONLY },
  },
  {
    name: 'mail_read',
    description: 'Read one message: sender, recipients, time, the text of the body (long bodies are cut and say so) and its attachments by name. Reading does not mark it read.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'] },
    annotations: { title: 'Read a message', ...READ_ONLY },
  },
  {
    name: 'mail_folders',
    description: "The mailbox's folders (Gmail: labels) with their roles and unread counts.",
    inputSchema: { type: 'object', properties: { account: ACCOUNT } },
    annotations: { title: 'List mail folders', ...READ_ONLY },
  },
  {
    name: 'mail_save_attachment',
    description: "Save one attachment of a message to the user's Downloads/Yobi folder and return its path. Programs, scripts and archives are refused.",
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        attachment: { type: 'string', description: 'The attachment name as mail_read lists it; may be left out when there is only one' },
      },
      required: ['id'],
    },
    annotations: { title: 'Save a mail attachment', ...WRITES },
  },
  {
    name: 'mail_draft',
    description: "Save a message in the user's Drafts folder without sending it; a reply (reply_to) is threaded under the original. The user can open and send it from their mail app, or you send it with mail_send.",
    inputSchema: { type: 'object', properties: COMPOSE_PROPERTIES, required: ['body'] },
    annotations: { title: 'Save a mail draft', ...WRITES },
  },
  {
    name: 'mail_send',
    description: 'Send a message from the user\'s address now. Pass the full message (to, subject, body); to send a draft you saved, pass the same content plus draft_id, and the draft is removed after sending.',
    inputSchema: {
      type: 'object',
      properties: { ...COMPOSE_PROPERTIES, draft_id: { type: 'string', description: 'Id of the draft this sends (from mail_draft), removed after sending' } },
      required: ['body'],
    },
    annotations: { title: 'Send mail', ...WRITES, openWorldHint: true },
  },
  {
    name: 'mail_update',
    description: 'Change messages: mark read or unread, star or unstar, archive, move to a folder, or add/remove Gmail labels.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: IDS,
        read: { type: 'boolean', description: 'true = mark read, false = mark unread' },
        starred: { type: 'boolean', description: 'true = star, false = unstar' },
        archive: { type: 'boolean', description: 'true = take out of the inbox' },
        move_to: { type: 'string', description: 'Folder path or role to move to' },
        add_labels: { type: 'array', items: { type: 'string' }, description: 'Gmail only' },
        remove_labels: { type: 'array', items: { type: 'string' }, description: 'Gmail only' },
      },
      required: ['ids'],
    },
    annotations: { title: 'Organize mail', ...WRITES },
  },
  {
    name: 'mail_trash',
    description: 'Move messages (or drafts) to the trash, where the mail service keeps them for a while before deleting them for good.',
    inputSchema: { type: 'object', properties: { ids: IDS }, required: ['ids'] },
    annotations: { title: 'Move mail to trash', ...WRITES, destructiveHint: true },
  },
];

export class MailArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailArgumentError';
  }
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') throw new MailArgumentError(`${key} must be a string`);
  return value;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (!value?.trim()) throw new MailArgumentError(`${key} is required`);
  return value;
}

/** A list may arrive as an array or as one comma-separated string. */
export function stringList(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!items) throw new MailArgumentError(`${key} must be a list`);
  return items.map((item) => String(item).trim()).filter(Boolean);
}

/**
 * The tools also take `attachments` as one comma-separated string, while the read sandbox only
 * checks a list: turn it into a list of paths before the sandbox runs, and refuse any other shape,
 * so no form of the argument reaches the composer unchecked.
 */
export function normalizeAttachmentArgs(args: Record<string, unknown>): { args: Record<string, unknown> } | { denied: string } {
  const raw = args.attachments;
  if (raw === undefined || raw === null || raw === '') return { args };
  const list = typeof raw === 'string' ? raw.split(',').map((item) => item.trim()).filter(Boolean) : raw;
  if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
    return { denied: 'attachments must be a list of local file paths' };
  }
  return { args: { ...args, attachments: list } };
}

/** true/false, also when a model writes them as strings. */
export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new MailArgumentError(`${key} must be true or false`);
}

function composeArgs(args: Record<string, unknown>): ComposeArgs {
  return {
    to: optionalString(args, 'to'),
    cc: optionalString(args, 'cc'),
    bcc: optionalString(args, 'bcc'),
    subject: optionalString(args, 'subject'),
    body: optionalString(args, 'body') ?? '',
    reply_to: optionalString(args, 'reply_to'),
    attachments: stringList(args, 'attachments'),
    from: optionalString(args, 'from'),
  };
}

async function dispatch(service: MailService, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'mail_search':
      return service.search({
        query: optionalString(args, 'query'),
        folder: optionalString(args, 'folder'),
        account: optionalString(args, 'account'),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        offset: typeof args.offset === 'number' ? args.offset : undefined,
      });
    case 'mail_read': return service.read(requiredString(args, 'id'));
    case 'mail_folders': return service.folders(optionalString(args, 'account'));
    case 'mail_save_attachment': {
      const which = args.attachment;
      return service.saveAttachment(requiredString(args, 'id'), typeof which === 'number' ? which : optionalString(args, 'attachment'));
    }
    case 'mail_draft': return service.draft(composeArgs(args));
    case 'mail_send': return service.send({ ...composeArgs(args), draft_id: optionalString(args, 'draft_id') });
    case 'mail_update':
      return service.update({
        ids: stringList(args, 'ids') ?? [],
        read: optionalBoolean(args, 'read'),
        starred: optionalBoolean(args, 'starred'),
        archive: optionalBoolean(args, 'archive'),
        move_to: optionalString(args, 'move_to'),
        add_labels: stringList(args, 'add_labels'),
        remove_labels: stringList(args, 'remove_labels'),
      });
    case 'mail_trash': return service.trash(stringList(args, 'ids') ?? []);
    default: throw new MailArgumentError(`Unknown tool: ${name}`);
  }
}

export function createMailMcpServer(service: MailService): Server {
  return createToolServer({
    name: MAIL_SERVER_NAME,
    tools: MAIL_TOOLS,
    dispatch: (name, args) => dispatch(service, name, args),
  });
}
