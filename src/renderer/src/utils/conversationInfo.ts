import type { ConversationDoc } from '../../../shared/conversationDoc';
import { providerOfThreadUrl } from '../../../shared/providerThread';
import { formatTokenCount, sumTurnUsage, type TokenUsage } from '../../../shared/tokenEstimate';
import { fillTemplate } from '../../../shared/fillTemplate';

export interface ConversationModelUse {
  name: string;
  turns: number;
}

export interface ConversationDurations {
  totalMs: number;
  /** Turns that recorded how long they took; turns saved before the field existed did not. */
  timedTurns: number;
  longestMs: number;
}

/** What the header's "Conversation info" dialog shows, derived from the saved conversation alone. */
export interface ConversationInfo {
  /** ISO times; '' when the file recorded none. */
  startedAt: string;
  lastActiveAt: string;
  turns: number;
  /** In order of first use. */
  models: ConversationModelUse[];
  /** Who wrote the latest reply; '' when no turn or heading names one. */
  lastProvider: string;
  tokens: (TokenUsage & { countedTurns: number }) | null;
  durations: ConversationDurations | null;
  /** The provider's own thread (https, on that provider's host), when the conversation still continues one. */
  threadUrl: string;
  /** How much of the conversation the latest reply could not see word for word. */
  context: { summarized: number; dropped: number };
  attachments: string[];
  sizeBytes: number;
}

function validTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function positiveCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function summarizeConversation(doc: ConversationDoc, content: string): ConversationInfo {
  const times = [validTime(doc.time), ...doc.turns.map((turn) => validTime(turn.meta.t))]
    .filter((ms): ms is number => ms !== null);
  const startedAt = times.length > 0 ? new Date(Math.min(...times)).toISOString() : '';
  const lastActiveAt = times.length > 0 ? new Date(Math.max(...times)).toISOString() : '';

  // A turn without its own provider ran on the one before it, as the conversation view shows it.
  const models: ConversationModelUse[] = [];
  let current = doc.provider ?? '';
  for (const turn of doc.turns) {
    current = turn.meta.p?.trim() || current;
    if (!current) continue;
    const seen = models.find((model) => model.name === current);
    if (seen) seen.turns += 1;
    else models.push({ name: current, turns: 1 });
  }

  let totalMs = 0;
  let timedTurns = 0;
  let longestMs = 0;
  for (const turn of doc.turns) {
    const ms = positiveCount(turn.meta.d);
    if (!ms) continue;
    totalMs += ms;
    timedTurns += 1;
    longestMs = Math.max(longestMs, ms);
  }

  const attachments = [...new Set(doc.turns.flatMap((turn) => (Array.isArray(turn.meta.a) ? turn.meta.a : [])))];
  const latest = doc.turns[doc.turns.length - 1]?.meta;
  const threadUrl = doc.thread.threadUrl?.trim() ?? '';

  return {
    startedAt,
    lastActiveAt,
    turns: doc.turns.length,
    models,
    lastProvider: doc.turns.length > 0 ? current : '',
    tokens: sumTurnUsage(doc.turns),
    durations: timedTurns > 0 ? { totalMs, timedTurns, longestMs } : null,
    threadUrl: providerOfThreadUrl(threadUrl) ? threadUrl : '',
    context: { summarized: positiveCount(latest?.summarized), dropped: positiveCount(latest?.dropped) },
    attachments,
    sizeBytes: new TextEncoder().encode(content).length,
  };
}

type Translate = (key: string) => string;

export { fillTemplate };

/** "Input 1.2k · Output 3.4k", with a leading "~" when it is Yobi's estimate; '' without counts. */
export function tokensValueText(info: Pick<ConversationInfo, 'tokens'>, t: Translate): string {
  if (!info.tokens) return '';
  return `${info.tokens.exact ? '' : '~'}${fillTemplate(t('chat.info.tokensValue'), {
    input: formatTokenCount(info.tokens.input),
    output: formatTokenCount(info.tokens.output),
  })}`;
}

/** "Total · average · longest"; '' when no turn recorded how long it took. */
export function durationValueText(info: Pick<ConversationInfo, 'durations'>, t: Translate): string {
  if (!info.durations) return '';
  return fillTemplate(t('chat.info.durationValue'), {
    total: formatTurnDuration(info.durations.totalMs),
    average: formatTurnDuration(info.durations.totalMs / info.durations.timedTurns),
    longest: formatTurnDuration(info.durations.longestMs),
  });
}

/** "Compressed the first N turns", "Left out the earliest N turns", or both; none when the model saw everything. */
export function contextValueText(info: Pick<ConversationInfo, 'context'>, t: Translate): string[] {
  return [
    info.context.summarized > 0 ? fillTemplate(t('chat.context.summarized'), { count: info.context.summarized }) : '',
    info.context.dropped > 0 ? fillTemplate(t('chat.context.dropped'), { count: info.context.dropped }) : '',
  ].filter(Boolean);
}

/** Seconds below a minute, then minutes and seconds: an Agent run is often several minutes. */
export function formatTurnDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))} ms`;
  const seconds = ms / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${whole % 60} s`;
}
