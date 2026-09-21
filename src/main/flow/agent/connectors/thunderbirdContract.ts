import { asRecord, embeddedError, failedResult, parseJsonValue } from '../toolContracts';
import type {
  ActionBoundary, Args, ConfirmPolicy, ContractCheck, DescribedRow, Fact, GateReason, InterpretedResult,
  LedgerView, ReadCaller, ToolContract, ToolRisk, VerificationResult,
} from '../toolContracts';
import {
  accountForFolder, emailsIn, extractThunderbirdFacts, findIdentity, identities, identityLabel,
  isOwnAuthor, mentionedByUser, messageLabel, normalizeSubject, rowsOf, TB_MESSAGE,
} from './thunderbirdFacts';
import type { MailIdentity } from './thunderbirdFacts';

type Kind = 'read' | 'draft' | 'compose' | 'dialog' | 'mutate' | 'destroy';

const COMPOSING_TOOLS = new Set(['saveDraft', 'sendMail', 'replyToMessage', 'forwardMessage']);

/**
 * Every tool the pinned add-on (v0.7.4) lists, by what it does. `tools/list` strips the add-on's own
 * `crud` field, so this table is the only place the difference between opening a window and sending
 * mail is written down. `test/thunderbirdContract.test.ts` fails when a tag bump adds a tool.
 */
export const THUNDERBIRD_TOOL_KINDS: Readonly<Record<string, Kind>> = {
  listAccounts: 'read', listFolders: 'read', searchMessages: 'read', getMessage: 'read', getMessages: 'read',
  getRecentMessages: 'read', listCalendars: 'read', listEvents: 'read', listTasks: 'read', listCategories: 'read',
  searchContacts: 'read', getContact: 'read', listFilters: 'read', getAccountAccess: 'read', displayMessage: 'read',
  saveDraft: 'draft',
  sendMail: 'compose', replyToMessage: 'compose', forwardMessage: 'compose',
  createEvent: 'dialog', createTask: 'dialog',
  updateMessage: 'mutate', createFolder: 'mutate', renameFolder: 'mutate', moveFolder: 'mutate',
  createContact: 'mutate', updateContact: 'mutate', updateEvent: 'mutate', updateTask: 'mutate',
  createFilter: 'mutate', updateFilter: 'mutate', reorderFilters: 'mutate', applyFilters: 'mutate',
  deleteMessages: 'destroy', deleteFolder: 'destroy', emptyTrash: 'destroy', emptyJunk: 'destroy',
  deleteEvent: 'destroy', deleteContact: 'destroy', deleteFilter: 'destroy',
};

export const THUNDERBIRD_NOTES = [
  'THUNDERBIRD NOTES:',
  '- replyToMessage, forwardMessage and sendMail only OPEN a window for the user to edit, save or send; they save nothing. saveDraft saves a NEW message that is not threaded under the original.',
  '- A reply goes out from the account that received the original unless "from" says otherwise; saveDraft and sendMail without "from" use the app\'s default account.',
  '- To write in the user\'s own voice, first read 2-3 messages they sent: searchMessages with "from:<their address>".',
].join('\n');

const OVERLAP_CHARS = 80;
const VERIFY_SKEW_MS = 120_000;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function hhmm(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function riskOf(kind: Kind, args: Args): ToolRisk {
  const direct = args.skipReview === true;
  switch (kind) {
    case 'read': return 'read';
    case 'draft': return 'reversible';
    case 'compose': return direct ? 'external' : 'reversible';
    case 'dialog': return direct ? 'mutating' : 'reversible';
    case 'mutate': return 'mutating';
    default: return 'destructive';
  }
}

const BOUNDARY: Record<ToolRisk, ActionBoundary | null> = {
  read: null, reversible: 'draft', mutating: 'modify', external: 'send', destructive: 'delete',
};

/** A window the user reviews needs no dialog of its own: the window IS the review. */
function confirmOf(risk: ToolRisk): ConfirmPolicy {
  if (risk === 'read' || risk === 'reversible') return 'never';
  return risk === 'mutating' ? 'ask' : 'always';
}

function prioritized(ledger: LedgerView): MailIdentity[] {
  const words = ledger.userWords.toLowerCase();
  const all = identities(ledger);
  const named = (identity: MailIdentity): boolean => words.includes(identity.email.toLowerCase())
    || [identity.name, identity.email.split('@')[0]].some((part) => part.length >= 3 && words.includes(part.toLowerCase()));
  return [...all.filter(named), ...all.filter((identity) => !named(identity))];
}

function identityChoices(ledger: LedgerView): string[] {
  return prioritized(ledger).slice(0, 4).map(identityLabel);
}

function targetFact(ledger: LedgerView, args: Args): Fact | undefined {
  const id = str(args.messageId);
  return id ? ledger.fact(TB_MESSAGE, id) : undefined;
}

function checkTarget(id: string, folderPath: string, ledger: LedgerView, reasons: GateReason[]): Fact | undefined {
  const fact = ledger.fact(TB_MESSAGE, id);
  if (!fact) {
    if (!ledger.hasValue(id)) {
      reasons.push({
        code: 'target_unobserved',
        message: `"messageId" is "${clip(id, 70)}", which is not the id of any message a tool returned. Find the message with searchMessages or getRecentMessages and use its exact "id".`,
      });
    }
    return undefined;
  }
  const folders = (fact.fields.folders ?? '').split('\n').filter(Boolean);
  if (folderPath && folders.length > 0 && !folders.includes(folderPath)) {
    reasons.push({
      code: 'folder_mismatch',
      message: `That message was found in ${folders.map((folder) => `"${folder}"`).join(' or ')}, not in "${folderPath}". Use one of those as "folderPath".`,
    });
  }
  return fact;
}

function sameThread(a: Fact, b: Fact): boolean {
  return normalizeSubject(a.fields.subject ?? '') === normalizeSubject(b.fields.subject ?? '');
}

function newest(facts: readonly Fact[]): Fact[] {
  return [...facts].sort((a, b) => (Date.parse(b.fields.date ?? '') || 0) - (Date.parse(a.fields.date ?? '') || 0));
}

/**
 * A reply target the user did not point at is a guess, however plausible. Allowed without a question
 * when the user's words name it, or when it is the only message the model has seen that is not the
 * user's own — and a newer message in the same thread is surfaced rather than silently skipped.
 */
function checkAmbiguity(chosen: Fact, ledger: LedgerView, reasons: GateReason[]): void {
  const candidates = ledger.facts(TB_MESSAGE).filter((fact) => fact === chosen || !isOwnAuthor(ledger, fact.fields.author ?? ''));
  const matched = candidates.filter((fact) => mentionedByUser(ledger, fact));
  if (matched.includes(chosen)) {
    const otherThreads = matched.filter((fact) => fact !== chosen && !sameThread(fact, chosen));
    const newer = matched.filter((fact) => fact !== chosen && sameThread(fact, chosen)
      && (Date.parse(fact.fields.date ?? '') || 0) > (Date.parse(chosen.fields.date ?? '') || 0));
    if (otherThreads.length === 0 && newer.length === 0) return;
    reasons.push({
      code: 'target_ambiguous',
      message: otherThreads.length > 0
        ? 'More than one message matches what the user wrote. Ask which one they mean.'
        : 'A newer message in the same thread exists. Reply to the newest unless the user meant this one; if unsure, ask.',
      choices: newest([chosen, ...otherThreads, ...newer]).slice(0, 4).map(messageLabel),
    });
    return;
  }
  if (candidates.length <= 1) return;
  reasons.push({
    code: 'target_ambiguous',
    message: matched.length > 0
      ? 'What the user wrote points to a different message than this one.'
      : `Nothing the user wrote names this message, and ${candidates.length} messages were found. Ask which one they mean.`,
    choices: newest(matched.length > 0 ? matched : candidates).slice(0, 4).map(messageLabel),
  });
}

function checkActor(tool: string, args: Args, ledger: LedgerView, reasons: GateReason[], needs: ContractCheck['needs']): void {
  const all = identities(ledger);
  if (all.length === 0) {
    needs!.push({ tool: 'listAccounts', args: {} });
    return;
  }
  const from = str(args.from).trim();
  const isReply = tool === 'replyToMessage' || tool === 'forwardMessage';
  const derived = isReply && str(args.folderPath) ? accountForFolder(ledger, str(args.folderPath)) : undefined;
  const words = ledger.userWords.toLowerCase();
  if (from) {
    const identity = findIdentity(ledger, from);
    if (!identity) {
      reasons.push({ code: 'actor_unknown', message: `"from" is "${clip(from, 60)}", which is not one of the user's accounts.`, choices: identityChoices(ledger) });
      return;
    }
    const grounded = all.length === 1 || words.includes(identity.email.toLowerCase()) || derived?.email === identity.email;
    if (grounded) return;
    reasons.push({
      code: 'actor_unresolved',
      message: `Nothing the user wrote says to send as ${identityLabel(identity)}${derived ? `, and the message was received by ${identityLabel(derived)}` : ''}. Ask which account to use.`,
      choices: identityChoices(ledger),
    });
    return;
  }
  if (isReply || all.length === 1) return;
  const named = all.filter((identity) => words.includes(identity.email.toLowerCase()));
  if (named.length === 1) {
    reasons.push({ code: 'actor_missing', message: `"from" is empty, so the app's default account would be used. The user named ${identityLabel(named[0])}: pass "from": "${named[0].email}".` });
    return;
  }
  reasons.push({
    code: 'actor_unresolved',
    message: `"from" is empty, so the app's default account would be used, and ${all.length} accounts could send this. Ask which one.`,
    choices: identityChoices(ledger),
  });
}

function sharesLongPassage(body: string, original: string): boolean {
  const a = body.replace(/\s+/g, ' ');
  const b = original.replace(/\s+/g, ' ');
  for (let i = 0; i + OVERLAP_CHARS <= a.length; i += 20) {
    if (b.includes(a.slice(i, i + OVERLAP_CHARS))) return true;
  }
  return false;
}

function checkContent(target: Fact, args: Args, reasons: GateReason[]): void {
  const body = str(args.body);
  if (!body) return;
  const lower = body.toLowerCase();
  const senderAddress = emailsIn(target.fields.author ?? '').find((email) => lower.includes(email));
  if (senderAddress) {
    reasons.push({
      code: 'content_suspect',
      message: `The body contains ${senderAddress}, the original sender's own address — it reads like their message pasted back, not a reply. Write the reply the user asked for; if their words are unclear, ask.`,
    });
    return;
  }
  if (target.fields.body && sharesLongPassage(body, target.fields.body)) {
    reasons.push({ code: 'content_suspect', message: 'The body repeats a long passage of the original message word for word. Write the reply itself, not a copy.' });
  }
}

function checkDelete(args: Args, ledger: LedgerView, reasons: GateReason[]): void {
  const ids = Array.isArray(args.messageIds) ? args.messageIds.filter((id): id is string => typeof id === 'string') : [];
  const folderPath = str(args.folderPath);
  const unseen = ids.filter((id) => !ledger.fact(TB_MESSAGE, id) && !ledger.hasValue(id));
  if (unseen.length > 0) {
    reasons.push({ code: 'target_unobserved', message: `${unseen.length} of these ids came from no tool result (e.g. "${clip(unseen[0], 60)}"). Delete only messages a (read) tool returned.` });
  }
  const elsewhere = ids.map((id) => ledger.fact(TB_MESSAGE, id)).filter((fact): fact is Fact => {
    if (!fact) return false;
    const folders = (fact.fields.folders ?? '').split('\n').filter(Boolean);
    return folders.length > 0 && !folders.includes(folderPath);
  });
  if (elsewhere.length > 0) {
    reasons.push({
      code: 'split_required',
      message: `${elsewhere.length} of these messages are not in "${folderPath}" (e.g. "${elsewhere[0].fields.subject}" is in "${elsewhere[0].fields.folderPath}"). deleteMessages works on one folder per call — call it once per folder.`,
    });
  }
}

function checkFor(tool: string, kind: Kind) {
  return (args: Args, ledger: LedgerView): ContractCheck => {
    const reasons: GateReason[] = [];
    const needs: NonNullable<ContractCheck['needs']> = [];
    if (tool === 'deleteMessages') {
      checkDelete(args, ledger, reasons);
      return { reasons };
    }
    const id = str(args.messageId);
    const target = id ? checkTarget(id, str(args.folderPath), ledger, reasons) : undefined;
    if (target && (tool === 'replyToMessage' || tool === 'forwardMessage')) {
      checkAmbiguity(target, ledger, reasons);
      checkContent(target, args, reasons);
    }
    if (kind === 'draft' || kind === 'compose') checkActor(tool, args, ledger, reasons, needs);
    return { reasons, needs };
  };
}

function interpretFor(tool: string, kind: Kind) {
  return (text: string, isError: boolean, args: Args, ledger: LedgerView): InterpretedResult => {
    if (isError) return failedResult(text, tool);
    const embedded = embeddedError(text);
    if (embedded) return failedResult(embedded, tool);
    if (kind === 'read') return { outcome: 'succeeded', summary: '' };
    const obj = asRecord(parseJsonValue(text));
    const message = str(obj?.message);
    if (/failed to attach/i.test(message)) {
      return { outcome: 'partial', summary: message, notice: { key: 'agent.outcome.partial', vars: { tool, detail: message } } };
    }
    if (kind === 'compose' && /window opened/i.test(message)) {
      const target = targetFact(ledger, args);
      const key = tool === 'sendMail' ? 'agent.outcome.composeWindow'
        : tool === 'forwardMessage' ? 'agent.outcome.forwardWindow'
          : args.replyAll === true ? 'agent.outcome.replyAllWindow' : 'agent.outcome.replyWindow';
      return {
        outcome: 'review_opened',
        summary: 'a compose window is open in Thunderbird for the user to edit, save or send. No draft was saved and nothing was sent',
        notice: { key, vars: { target: target ? messageLabel(target) : str(args.to) || str(args.messageId) } },
      };
    }
    if (kind === 'dialog' && args.skipReview !== true) {
      return { outcome: 'review_opened', summary: 'a dialog is open in Thunderbird for the user to review; nothing is saved yet', notice: { key: 'agent.outcome.dialogWindow', vars: {} } };
    }
    if (kind === 'draft' || (kind === 'compose' && /sent/i.test(message))) {
      return {
        outcome: 'claimed',
        summary: `the tool says "${message || 'done'}" but returned nothing to confirm it with`,
        notice: { key: 'agent.outcome.unverified', vars: { tool } },
      };
    }
    if (tool === 'deleteMessages' && obj) {
      const done = typeof obj.deleted === 'number' ? obj.deleted : 0;
      const missing = Array.isArray(obj.notFound) ? obj.notFound.length : 0;
      if (missing > 0 && done === 0) return { ...failedResult('none of the messages were found in that folder', tool), failure: 'not_found' };
      if (missing > 0) {
        return {
          outcome: 'partial',
          summary: `${done} deleted; ${missing} not found in that folder`,
          notice: { key: 'agent.outcome.deletePartial', vars: { done: String(done), missing: String(missing) } },
        };
      }
    }
    if (obj?.success === true) return { outcome: 'succeeded', summary: '' };
    return { outcome: 'uncertain', summary: 'the answer does not say whether it worked', notice: { key: 'agent.outcome.uncertain', vars: { tool } } };
  };
}

function actingIdentity(tool: string, args: Args, ledger: LedgerView): MailIdentity | undefined {
  const from = str(args.from);
  if (from) return findIdentity(ledger, from);
  if (tool === 'replyToMessage' || tool === 'forwardMessage') return accountForFolder(ledger, str(args.folderPath));
  const all = identities(ledger);
  return all.length === 1 ? all[0] : undefined;
}

/**
 * Looks the saved message up by subject instead of trusting "Draft saved". Searching across folders
 * rather than one Drafts path is what lets it also answer "where did the earlier one go" when the
 * earlier call never said which account it used.
 */
async function verifyStored(tool: string, args: Args, at: string, ledger: LedgerView, read: ReadCaller): Promise<VerificationResult> {
  const drafts = tool === 'saveDraft';
  const original = targetFact(ledger, args);
  const subject = drafts || tool === 'sendMail' ? str(args.subject) : str(original?.fields.subject);
  if (!subject.trim()) return { status: 'unavailable', evidence: 'there is no subject to look it up by', notice: { key: 'agent.outcome.unverified', vars: { tool } } };
  if (identities(ledger).length === 0) await read('listAccounts', {});
  const since = (Date.parse(at) || Date.now()) - VERIFY_SKEW_MS;
  const result = await read('searchMessages', {
    query: `subject:${normalizeSubject(subject)}`,
    startDate: new Date(since - 86_400_000).toISOString().slice(0, 10),
    maxResults: 30,
  });
  if (result.isError || embeddedError(result.text)) {
    return { status: 'unavailable', evidence: 'the lookup failed', notice: { key: 'agent.outcome.unverified', vars: { tool } } };
  }
  const expected = actingIdentity(tool, args, ledger);
  const match = rowsOf(parseJsonValue(result.text)).find((row) => normalizeSubject(str(row.subject)) === normalizeSubject(subject)
    && isOwnAuthor(ledger, str(row.author))
    && (!expected || emailsIn(str(row.author)).includes(expected.email.toLowerCase()))
    && (Date.parse(str(row.date)) || 0) >= since);
  const where = drafts ? 'Drafts' : 'Sent';
  if (!match) {
    const account = expected ? identityLabel(expected) : 'any account';
    return {
      status: 'not_found',
      evidence: `no message "${subject}" from ${account} saved since ${hhmm(new Date(since).toISOString())} was found`,
      notice: { key: drafts ? 'agent.outcome.draftNotFound' : 'agent.outcome.sentNotFound', vars: { account, subject } },
    };
  }
  const locations = [str(match.folderPath), ...(Array.isArray(match.dupLocations) ? match.dupLocations.map(str) : [])].filter(Boolean);
  const folder = locations.find((path) => /draft|草稿|sent|寄件/i.test(path)) ?? locations[0] ?? '';
  const folderName = decodeURIComponent(folder.split('/').pop() ?? folder);
  const account = str(match.author).replace(/"/g, '').trim();
  return {
    status: 'verified',
    evidence: `${where}: "${str(match.subject)}" from ${account} is in "${folderName}" (${hhmm(str(match.date))})`,
    notice: { key: drafts ? 'agent.outcome.draftVerified' : 'agent.outcome.sentVerified', vars: { account, folder: folderName, subject: str(match.subject) } },
  };
}

function targetKeyFor(tool: string) {
  return (args: Args): string | null => {
    switch (tool) {
      case 'saveDraft': return str(args.subject).trim() ? `draft:${normalizeSubject(str(args.subject))}` : null;
      case 'replyToMessage': return str(args.messageId) ? `reply:${str(args.messageId)}` : null;
      case 'forwardMessage': return str(args.messageId) ? `forward:${str(args.messageId)}` : null;
      case 'sendMail': return `mail:${str(args.to).toLowerCase()}:${normalizeSubject(str(args.subject))}`;
      case 'deleteMessages': return Array.isArray(args.messageIds) ? `delete:${[...args.messageIds].map(String).sort().join(',')}` : null;
      default: return null;
    }
  };
}

function recipientCount(fact: Fact, ledger: LedgerView): number {
  const own = new Set(identities(ledger).map((identity) => identity.email.toLowerCase()));
  return new Set(emailsIn(`${fact.fields.recipients ?? ''},${fact.fields.cc ?? ''}`).filter((email) => !own.has(email))).size;
}

function describeFor(tool: string) {
  return (args: Args, ledger: LedgerView): DescribedRow[] => {
    const rows: DescribedRow[] = [];
    const direct = args.skipReview === true;
    const actionKey: Record<string, string> = {
      saveDraft: 'agent.mcp.confirm.action.saveDraft',
      replyToMessage: direct ? 'agent.mcp.confirm.action.sendReply' : args.replyAll === true ? 'agent.mcp.confirm.action.replyAllWindow' : 'agent.mcp.confirm.action.replyWindow',
      forwardMessage: direct ? 'agent.mcp.confirm.action.sendForward' : 'agent.mcp.confirm.action.forwardWindow',
      sendMail: direct ? 'agent.mcp.confirm.action.sendMail' : 'agent.mcp.confirm.action.composeWindow',
      deleteMessages: 'agent.mcp.confirm.action.deleteMessages',
    };
    if (actionKey[tool]) rows.push({ key: 'action', value: tool, valueKey: actionKey[tool] });
    if (COMPOSING_TOOLS.has(tool)) {
      const identity = actingIdentity(tool, args, ledger);
      rows.push(identity ? { key: 'account', value: identityLabel(identity) } : { key: 'account', value: '', valueKey: 'agent.mcp.confirm.defaultAccount' });
    }
    const target = targetFact(ledger, args);
    if (target) rows.push({ key: 'target', value: messageLabel(target) });
    if (tool === 'replyToMessage' && target) {
      // Everyone on the original except the user; the sender is not among them, so a plain reply
      // leaves all of them out and a reply-all reaches them plus the sender.
      const others = recipientCount(target, ledger);
      if (args.replyAll === true) rows.push({ key: 'recipients', value: '', valueKey: 'agent.mcp.confirm.recipientsAll', vars: { count: String(others + 1) } });
      else if (others > 0) rows.push({ key: 'recipients', value: '', valueKey: 'agent.mcp.confirm.recipientsDropped', vars: { count: String(others) } });
    } else if (str(args.to) || str(args.cc)) {
      rows.push({ key: 'recipients', value: [str(args.to), str(args.cc)].filter(Boolean).join(', ') });
    }
    if (Array.isArray(args.messageIds)) {
      const labels = args.messageIds.map((id) => ledger.fact(TB_MESSAGE, String(id))).map((fact, index) => (fact ? messageLabel(fact) : String((args.messageIds as unknown[])[index])));
      rows.push({ key: 'items', value: labels.join('\n') });
    }
    if (str(args.body)) rows.push({ key: 'content', value: clip(str(args.body), 300) });
    return rows;
  };
}

function labelFor(tool: string) {
  return (args: Args, ledger: LedgerView): string => {
    const identity = actingIdentity(tool, args, ledger);
    const target = targetFact(ledger, args);
    switch (tool) {
      case 'saveDraft':
        return `saveDraft as ${identity ? identityLabel(identity) : 'the default account'}, subject "${clip(str(args.subject), 60)}"${str(args.to) ? ` to ${str(args.to)}` : ', no recipient'}`;
      case 'replyToMessage':
        return `replyToMessage${args.replyAll === true ? ' (reply all)' : ''} to ${target ? messageLabel(target) : str(args.messageId)}`;
      case 'forwardMessage':
        return `forwardMessage ${target ? messageLabel(target) : str(args.messageId)} to ${str(args.to)}`;
      case 'sendMail':
        return `sendMail to ${str(args.to)}, subject "${clip(str(args.subject), 60)}"`;
      case 'deleteMessages':
        return `deleteMessages ${Array.isArray(args.messageIds) ? args.messageIds.length : 0} message(s)`;
      default:
        return tool;
    }
  };
}

function contractFor(tool: string, kind: Kind): ToolContract {
  const stored = tool === 'saveDraft' || kind === 'compose';
  return {
    risk: (args) => riskOf(kind, args),
    boundary: (args) => BOUNDARY[riskOf(kind, args)],
    confirm: (args) => confirmOf(riskOf(kind, args)),
    interpret: interpretFor(tool, kind),
    targetKey: targetKeyFor(tool),
    ...(kind === 'read' ? {} : { check: checkFor(tool, kind), describe: describeFor(tool), label: labelFor(tool) }),
    extractFacts: (args, text) => extractThunderbirdFacts(tool, args, text),
    ...(stored ? { verify: (args: Args, at: string, ledger: LedgerView, read: ReadCaller) => verifyStored(tool, args, at, ledger, read) } : {}),
  };
}

export const THUNDERBIRD_CONTRACTS: Readonly<Record<string, ToolContract>> = Object.fromEntries(
  Object.entries(THUNDERBIRD_TOOL_KINDS).map(([tool, kind]) => [tool, contractFor(tool, kind)]),
);
