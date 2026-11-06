/**
 * The people list: the user
 * first, then contacts with a 1:1 chat (most recently active first), then the other contacts;
 * with `includeMembers` the rest are merged with the open-chat members LINE has seen, latest
 * sender first. A query equal to an id returns that person from any source; otherwise it filters
 * by name substring (display name, nickname or own name), ignoring case.
 */
import { saneLimit } from './schema';

/** The default page size. */
export const DEFAULT_CONTACTS_LIMIT = 200;

/** One person (optional fields only when set). */
export interface ContactSummary {
  contact_id: string;
  /** The name chats and senders show: the user's nickname for them if set, else their own name. */
  display_name: string;
  is_me?: boolean;
  /** Their own name, only when it differs from display_name. */
  profile_name?: string;
  /** The name the user gave them, only when set. */
  nickname?: string;
  /** Their 1:1 chat, when one exists. */
  chat_id?: string;
  /** Contacts only. */
  type?: 'friend' | 'official' | 'other';
  source: 'me' | 'contact' | 'open_chat_member';
  /** Open-chat members: the community's name. */
  community?: string;
}

export interface ContactSource {
  own: ReadonlySet<string>;
  official: ReadonlySet<string>;
  /** Every chat's activity time (ms), keyed by chat_id; a key means the chat exists. */
  chatActivity: ReadonlyMap<string, number>;
  profile: readonly { mid: string; name: string }[];
  /** Contacts whose _status says friend (or a friend the user blocked). */
  friends: ReadonlySet<string>;
  /** _contact rows with an id, in table order. */
  contacts: readonly { mid: string; name: string; nick: string }[];
  /** Open-chat members, read only when a query or includeMembers needs them. */
  members(): { mid: string; name: string; community: string }[];
  /** Each sender's newest plain message (ms), read only with includeMembers. */
  lastSent(): ReadonlyMap<string, number>;
}

export interface ContactList {
  contacts: ContactSummary[];
  /** Matching open-chat members not listed: left out without includeMembers, or cut by the limit. */
  moreMembers: number;
}

// Go field order; empty optional fields are left out (omitempty), contact_id/display_name/source never.
function entry(f: ContactSummary): ContactSummary {
  return {
    contact_id: f.contact_id,
    display_name: f.display_name,
    ...(f.is_me ? { is_me: true } : {}),
    ...(f.profile_name ? { profile_name: f.profile_name } : {}),
    ...(f.nickname ? { nickname: f.nickname } : {}),
    ...(f.chat_id ? { chat_id: f.chat_id } : {}),
    ...(f.type ? { type: f.type } : {}),
    source: f.source,
    ...(f.community ? { community: f.community } : {}),
  };
}

export function listContacts(
  opts: { query?: string; limit?: number; includeMembers?: boolean },
  src: ContactSource,
): ContactList {
  const chatOf = (id: string): string => (src.chatActivity.has(id) ? id : '');
  const me = src.profile.map((p) => entry({
    contact_id: p.mid, display_name: p.name || p.mid, is_me: true, chat_id: chatOf(p.mid), source: 'me',
  }));
  const withChat: ContactSummary[] = [];
  const rest: ContactSummary[] = [];
  for (const c of src.contacts) {
    const display = (c.nick || c.name) || c.mid;
    const type = src.official.has(c.mid) ? 'official' : src.friends.has(c.mid) ? 'friend' : 'other';
    const summary = entry({
      contact_id: c.mid,
      display_name: display,
      is_me: src.own.has(c.mid),
      profile_name: c.name !== display ? c.name : '',
      nickname: c.nick,
      chat_id: chatOf(c.mid),
      type,
      source: 'contact',
    });
    (summary.chat_id ? withChat : rest).push(summary);
  }
  const needle = (opts.query ?? '').trim();
  const members = opts.includeMembers || needle !== ''
    ? src.members().map((m) => entry({
      contact_id: m.mid,
      display_name: m.name || m.mid,
      is_me: src.own.has(m.mid),
      source: src.own.has(m.mid) ? 'me' : 'open_chat_member',
      community: m.community,
    }))
    : [];
  const activity = (c: ContactSummary): number => src.chatActivity.get(c.chat_id ?? '') ?? 0;
  withChat.sort((a, b) => activity(b) - activity(a));
  let others = rest;
  let extra = members;
  if (opts.includeMembers) {
    const sent = src.lastSent();
    others = [...rest, ...members].sort((a, b) => (sent.get(b.contact_id) ?? 0) - (sent.get(a.contact_id) ?? 0));
    extra = [];
  }
  const pool = [...me, ...withChat, ...others];

  if (needle) {
    const exact = [...pool, ...extra].filter((c) => c.contact_id === needle);
    if (exact.length > 0) return { contacts: exact, moreMembers: 0 };
  }
  const low = needle.toLowerCase();
  const match = (c: ContactSummary): boolean => low === ''
    || c.display_name.toLowerCase().includes(low)
    || (c.nickname ?? '').toLowerCase().includes(low)
    || (c.profile_name ?? '').toLowerCase().includes(low);
  const limit = saneLimit(opts.limit, DEFAULT_CONTACTS_LIMIT);
  const out: ContactSummary[] = [];
  let moreMembers = 0;
  for (const c of pool) {
    if (!match(c)) continue;
    if (out.length < limit) out.push(c);
    else if (c.source === 'open_chat_member') moreMembers++;
  }
  if (needle) {
    for (const c of extra) {
      if (c.source === 'open_chat_member' && match(c)) moreMembers++;
    }
  }
  return { contacts: out, moreMembers };
}
