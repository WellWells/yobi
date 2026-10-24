/**
 * `telegram_read` — the Telegram group talk the bot heard (kept three days by `groupChatArchive`)
 * as a flow data source: a daily summary is telegram_read -> stop -> llm -> bot.
 *
 * The orchestration takes an injected log, directory and clock; `execTelegramRead` wires the real ones.
 */
import { DEFAULT_TELEGRAM_READ_RANGE, isTelegramReadRange, type TelegramReadRange } from '../../../shared/telegramReadRange';
import { detectProvider, PROVIDER_PROMPT_POLICIES } from '../../providers';
import { sendLog } from '../../helpers';
import type { FlowExecutorDeps } from '../types';
import { FlowUserError } from '../userError';
import { envelope } from './dataSources';
import { charBudgetFor } from './lineTranscript';
import type { GroupChatLog, LoggedMessage } from '../../telegram/groupChatLog';

export interface TelegramReadDeps {
  log: Pick<GroupChatLog, 'ready' | 'groups' | 'messagesBetween'>;
  /** Groups the bot knows by name, heard from or not: a quiet group is not a misspelled one. */
  knownGroups: () => Promise<Array<{ id: number; title: string }>>;
  maxChars: number;
  now: () => Date;
  report?: (message: string) => void;
}

interface Section {
  id: number;
  title: string;
  lines: string[];
  dates: number[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dayOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function stampOf(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${dayOf(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfDay(date: Date, offsetDays = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);
}

/** `[since, until)` in epoch seconds, on this computer's own calendar. */
export function resolveTelegramRange(range: TelegramReadRange, now: Date): { since: number; until: number } {
  const seconds = (date: Date): number => Math.floor(date.getTime() / 1000);
  const nowSec = seconds(now) + 1;
  switch (range) {
    case 'today': return { since: seconds(startOfDay(now)), until: nowSec };
    case 'yesterday': return { since: seconds(startOfDay(now, -1)), until: seconds(startOfDay(now)) };
    case 'last3d': return { since: nowSec - 3 * 24 * 60 * 60, until: nowSec };
    default: return { since: nowSec - 24 * 60 * 60, until: nowSec };
  }
}

/** One message per line under a date line, as `line_read` writes them: "HH:MM name：text". */
function renderLines(messages: readonly LoggedMessage[]): { lines: string[]; dates: number[] } {
  const lines: string[] = [];
  const dates: number[] = [];
  let currentDay = '';
  for (const message of messages) {
    const date = new Date(message.date * 1000);
    const day = dayOf(date);
    const flat = message.text.replace(/\s+/g, ' ').trim();
    const line = `${pad(date.getHours())}:${pad(date.getMinutes())} ${message.from || '?'}：${flat}`;
    // The date line rides with the first message of its day, so trimming drops them together.
    lines.push(day !== currentDay ? `${day}\n${line}` : line);
    dates.push(message.date);
    currentDay = day;
  }
  return { lines, dates };
}

/**
 * How many of each section's NEWEST lines fit: an even share each, a share a small section leaves
 * unused passed on to the others. The newest matter most, and the llm step downstream would cut
 * the tail — the newest — if this did not cut the head first. When no open section can take its
 * next line within its share, the last one gives up its place, as in `line_read`.
 */
export function fitSections(sizes: readonly number[][], budget: number): number[] {
  const kept = sizes.map(() => 0);
  const nextCost = (index: number): number => sizes[index][sizes[index].length - 1 - kept[index]];
  let open = sizes.map((_, index) => index).filter((index) => sizes[index].length > 0);
  let remaining = budget;
  while (open.length > 0) {
    const share = Math.floor(remaining / open.length);
    let progressed = false;
    for (const index of open) {
      let used = 0;
      while (kept[index] < sizes[index].length && used + nextCost(index) <= share) {
        used += nextCost(index);
        kept[index] += 1;
      }
      remaining -= used;
      progressed ||= used > 0;
    }
    open = open.filter((index) => kept[index] < sizes[index].length);
    if (!progressed) open = open.slice(0, -1);
  }
  return kept;
}

async function resolveGroups(raw: string, deps: TelegramReadDeps): Promise<Array<{ id: number; title: string }>> {
  const heard = deps.log.groups();
  const wanted = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (wanted.length === 0) return heard.map(({ id, title }) => ({ id, title }));

  const known = [...heard, ...(await deps.knownGroups())];
  const out = new Map<number, string>();
  for (const entry of wanted) {
    if (/^-?\d+$/.test(entry)) {
      const id = Number(entry);
      out.set(id, known.find((group) => group.id === id)?.title ?? entry);
      continue;
    }
    const lowered = entry.toLowerCase();
    const exact = known.filter((group) => group.title.toLowerCase() === lowered);
    const matches = exact.length > 0 ? exact : known.filter((group) => group.title.toLowerCase().includes(lowered));
    // A name that reaches no group would read as a quiet day, so a typo would never be noticed.
    if (matches.length === 0) {
      throw new FlowUserError('flow.skill.telegram_read.error.noGroup', { name: entry }, `no Telegram group the bot knows is called "${entry}"`);
    }
    for (const match of matches) out.set(match.id, match.title);
  }
  return [...out].map(([id, title]) => ({ id, title }));
}

export async function runTelegramRead(config: Record<string, string>, deps: TelegramReadDeps): Promise<string> {
  const rangeRaw = (config.range ?? '').trim();
  const range = isTelegramReadRange(rangeRaw) ? rangeRaw : DEFAULT_TELEGRAM_READ_RANGE;
  await deps.log.ready();
  const groups = await resolveGroups(config.chat ?? '', deps);
  const { since, until } = resolveTelegramRange(range, deps.now());

  const sections: Section[] = groups
    .map(({ id, title }) => ({ id, title: title || String(id), ...renderLines(deps.log.messagesBetween(id, since, until)) }))
    .filter((section) => section.lines.length > 0);
  const headings = groups.length > 1;
  const headingCost = (section: Section): number => (headings ? section.title.length + 5 : 0);
  const budget = Math.max(0, deps.maxChars - sections.reduce((sum, section) => sum + headingCost(section), 0));
  const kept = fitSections(sections.map((section) => section.lines.map((line) => line.length + 1)), budget);

  const shown = sections
    .map((section, index) => ({ ...section, lines: section.lines.slice(section.lines.length - kept[index]), dates: section.dates.slice(section.dates.length - kept[index]) }))
    .filter((section) => section.lines.length > 0);
  const total = sections.reduce((sum, section) => sum + section.lines.length, 0);
  const count = shown.reduce((sum, section) => sum + section.lines.length, 0);
  if (total > 0 && count === 0) {
    throw new FlowUserError('flow.skill.telegram_read.error.starved', {}, 'not one message fits the AI provider\'s input limit');
  }

  // A section trimmed mid-day starts without its date line; put it back so every time has a day.
  const text = shown.map((section) => {
    const first = section.lines[0];
    const lines = first.includes('\n') ? section.lines : [`${stampOf(section.dates[0]).slice(0, 10)}\n${first}`, ...section.lines.slice(1)];
    const body = lines.join('\n');
    return headings ? `## ${section.title}\n${body}` : body;
  }).join('\n\n');
  const dates = shown.flatMap((section) => section.dates).sort((a, b) => a - b);
  deps.report?.(`💬 [Flow] telegram_read: ${count} message(s) from ${shown.length} group(s)${total > count ? ` (${total - count} dropped to fit)` : ''}`);

  return envelope(text, {
    count: String(count),
    dropped: String(total - count),
    groupNames: shown.map((section) => section.title).join(', '),
    groupCount: String(shown.length),
    firstAt: dates.length > 0 ? stampOf(dates[0]) : '',
    lastAt: dates.length > 0 ? stampOf(dates[dates.length - 1]) : '',
  });
}

export async function execTelegramRead(config: Record<string, string>, deps: FlowExecutorDeps): Promise<string> {
  const { sharedGroupChatLog } = await import('../../telegram/groupChatArchive');
  const { listBotContacts } = await import('../../botDirectory');
  return runTelegramRead(config, {
    log: sharedGroupChatLog(),
    knownGroups: async () => (await listBotContacts({ platform: 'telegram', kind: 'chat' }))
      .filter((contact) => contact.chatType === 'group' || contact.chatType === 'supergroup')
      .map((contact) => ({ id: Number(contact.id), title: contact.title ?? '' })),
    // Static on purpose: the step that reads this transcript may be another provider or signed out.
    maxChars: charBudgetFor(PROVIDER_PROMPT_POLICIES[detectProvider(deps.getTargetUrl())]),
    now: () => new Date(),
    report: sendLog,
  });
}
