import type { ConversationDoc } from '../../../shared/conversationDoc';
import { sumTurnUsage, type TokenUsage } from '../../../shared/tokenEstimate';

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
  tokens: (TokenUsage & { countedTurns: number }) | null;
  durations: ConversationDurations | null;
  /** The provider's own thread, when the conversation still continues one. */
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
  const threadUrl = doc.thread.threadUrl ?? '';

  return {
    startedAt,
    lastActiveAt,
    turns: doc.turns.length,
    models,
    tokens: sumTurnUsage(doc.turns),
    durations: timedTurns > 0 ? { totalMs, timedTurns, longestMs } : null,
    threadUrl: /^https:\/\//i.test(threadUrl) ? threadUrl : '',
    context: { summarized: positiveCount(latest?.summarized), dropped: positiveCount(latest?.dropped) },
    attachments,
    sizeBytes: new TextEncoder().encode(content).length,
  };
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
