/**
 * Tagging people in a group message (line_send's mention and mention_all). The text is never
 * changed: LINE shows the words the sender wrote and only the spans make them a tag, so a person is
 * tagged only where the text says so. Offsets are UTF-16 code units, LINE's unit and JavaScript's.
 */
import { createHash } from 'node:crypto';
import { LineError } from './errors';
import { goQuote } from './lineGoText';

/** The most tagged spans of one message. */
const MAX_MENTIONS = 100;

/** What LINE's apps write for "everyone", in every language's stored messages. */
const MENTION_ALL_LABEL = 'All';

/** One tagged span; `id` and `name` are empty for @All. Keys in the plan's order. */
export interface MentionSpan {
  id?: string;
  name?: string;
  text: string;
  start: number;
  end: number;
}

/** One person to tag: `name` is shown in the plan, `labels` are the words that may follow @ in the text. */
export interface MentionTarget {
  id: string;
  name: string;
  labels: string[];
}

function invalid(message: string): LineError {
  return new LineError('INVALID_ARGUMENT', message);
}

// Not inside an address such as me@Alex. Chinese has no spaces, so only ASCII letters and digits count.
function startsWord(before: string): boolean {
  return !/[A-Za-z0-9]$/.test(before);
}

// At the end of the text, a space or punctuation. Any letter, Chinese too, could be more of the name.
function endsWord(after: string): boolean {
  return !/^[\p{L}\p{Nd}]/u.test(after);
}

/**
 * Every @label of targets (and @All with `all`) in the already normalized text. A label must end at
 * a word boundary, otherwise @Al would tag inside @Alex; the longest label wins where labels overlap.
 */
export function planMentions(text: string, people: readonly MentionTarget[], all: boolean): MentionSpan[] {
  const targets = [...people];
  const cands: { target: number; label: string }[] = [];
  targets.forEach((t, i) => t.labels.forEach((label) => cands.push({ target: i, label })));
  if (all) {
    targets.push({ id: '', name: '', labels: [MENTION_ALL_LABEL] });
    cands.push({ target: targets.length - 1, label: MENTION_ALL_LABEL });
  }
  const owner = new Map<string, number>();
  for (const c of cands) {
    const seen = owner.get(c.label);
    if (seen !== undefined && seen !== c.target) {
      throw invalid(`several people are called @${c.label} here, so the text cannot show which is which; tag them one at a time, or under different words with mention <word>=<id>`);
    }
    owner.set(c.label, c.target);
  }
  cands.sort((a, b) => Buffer.byteLength(b.label) - Buffer.byteLength(a.label));

  const claimed: { start: number; end: number }[] = [];
  const isFree = (s: number, e: number): boolean => claimed.every((c) => !(s < c.end && c.start < e));
  const spans: MentionSpan[] = [];
  const found = targets.map(() => false);
  const glued = targets.map(() => ''); // a label seen only inside a longer word
  for (const c of cands) {
    const needle = `@${c.label}`;
    let from = 0;
    for (;;) {
      const s = text.indexOf(needle, from);
      if (s < 0) break;
      const e = s + needle.length;
      from = e;
      if (!isFree(s, e) || !startsWord(text.slice(0, s))) continue;
      if (!endsWord(text.slice(e))) {
        glued[c.target] = needle;
        continue;
      }
      claimed.push({ start: s, end: e });
      found[c.target] = true;
      const t = targets[c.target];
      spans.push({ ...(t.id ? { id: t.id } : {}), ...(t.name ? { name: t.name } : {}), text: needle, start: s, end: e });
    }
  }
  targets.forEach((t, i) => {
    if (found[i]) return;
    if (glued[i]) throw invalid(`put a space after ${glued[i]} in the text, as LINE does, so it does not read as part of a longer word`);
    if (!t.id) throw invalid(`mention_all needs @${MENTION_ALL_LABEL} in the text`);
    throw invalid(`the text does not contain @${t.labels.join(' or @')}; a mention tags those words, so write them in the text`);
  });
  if (spans.length > MAX_MENTIONS) throw invalid(`too many mentions: at most ${MAX_MENTIONS} in one message`);
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Resolves the mention arguments: a member id, a member's exact name, or <word>=<id> for a member
 * whose name in the text differs from this PC's. `members` is the group's joined members by id.
 */
export function mentionTargets(chatId: string, members: ReadonlyMap<string, MentionTarget>, args: readonly string[]): MentionTarget[] {
  const notMember = (arg: string): LineError =>
    invalid(`mention ${goQuote(arg)} is not a member of this group; see line_get_members with chat_id ${chatId} (someone invited but not joined cannot be tagged)`);
  const out: MentionTarget[] = [];
  const seen = new Map<string, MentionTarget>();
  const add = (t: MentionTarget): void => {
    const had = seen.get(t.id);
    if (had) {
      had.labels.push(...t.labels);
      return;
    }
    const copy = { ...t, labels: [...t.labels] };
    seen.set(t.id, copy);
    out.push(copy);
  };
  for (const arg of args) {
    const eq = arg.lastIndexOf('=');
    if (eq > 0) {
      const t = members.get(arg.slice(eq + 1));
      if (!t) throw notMember(arg);
      add({ ...t, labels: [arg.slice(0, eq)] });
      continue;
    }
    const byId = members.get(arg);
    if (byId) {
      if (byId.labels.length === 0) throw invalid(`this PC has no name for ${arg}; give the word that follows @ in the text: mention <word>=${arg}`);
      add(byId);
      continue;
    }
    const hits = [...members.values()].filter((t) => t.labels.includes(arg)).map((t) => t.id).sort();
    if (hits.length === 0) throw notMember(arg);
    if (hits.length > 1) throw invalid(`mention ${goQuote(arg)} matches several members (${hits.join(', ')}); give the id`);
    add(members.get(hits[0]) as MentionTarget);
  }
  return out;
}

/**
 * The MENTION metadata value: a JSON string whose offsets are strings too. It stays outside the
 * sealed text, as LINE's apps send it, so LINE's server can see who is tagged but not the message.
 */
export function mentionMeta(spans: readonly MentionSpan[]): string {
  return JSON.stringify({
    MENTIONEES: spans.map((s) => ({ S: String(s.start), E: String(s.end), ...(s.id ? { M: s.id } : { A: '1' }) })),
  });
}

/** What DUPLICATE_SEND compares: the text, plus who it tags, so fixing a wrong tag is not refused as a repeat. */
export function dedupeKey(text: string, spans: readonly MentionSpan[]): string {
  const key = spans.length === 0 ? text : `${text}\x00${mentionMeta(spans)}`;
  return createHash('sha256').update(key, 'utf-8').digest('hex');
}
