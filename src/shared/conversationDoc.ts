import { repairSplitTableRows } from './markdownTableRepair';
import type { MemoryNote } from './userMemory';

export interface ThreadMeta {
  v: 1;
  provider?: string;
  threadUrl?: string;
  threadTurns?: number;
  /**
   * When the provider thread was started — the send time of its first message, which carried the
   * memory as it was then. A native follow-up lists only what changed after it.
   */
  threadAt?: string;
  summary?: string;
  summarizedTurns?: number;
  /**
   * MCP server ids the user disclosed for this conversation, so reopening it keeps disclosing
   * them without retyping the connector command. Ids, never display names: a connector can be
   * renamed and its slash command can move to another server.
   */
  mcp?: string[];
  /**
   * The "web" capability for this conversation. Only `true` is ever written: absent means off,
   * the default. (It used to be the other way round, with only `false` written; a conversation
   * saved then reopens with web off, like any new one.) Kept out of `mcp` deliberately — that
   * array is server ids, and a sentinel id in it would be looked up as a server by everything
   * downstream.
   */
  web?: boolean;
}

export interface TurnMeta {
  p?: string;
  t?: string;
  m?: 'native' | 'replay';
  c?: string;
  a?: string[];
  dropped?: number;
  summarized?: number;
  ti?: number;
  to?: number;
  tx?: 1;
  /** Agent run id, so the turn can reopen the reasoning trace that produced it. */
  r?: string;
  /** Choices offered by an agent question, rendered as buttons while that question is unanswered. */
  ch?: string[];
  /** What this reply changed in the user's memory, as the program applied it. */
  mem?: MemoryNote[];
}

export function attachmentMetaNames(paths: readonly string[]): string[] {
  return paths
    .map((entry) => (entry.split(/[\\/]/).pop() ?? '').replace(/-->/g, '--').trim())
    .filter(Boolean);
}

export interface ConversationHeadingAliases {
  provider: Set<string>;
  time: Set<string>;
  prompt: Set<string>;
  response: Set<string>;
}

export interface ConversationTurn {
  prompt: string;
  response: string;
  meta: TurnMeta;
}

export interface ConversationDoc {
  title: string | null;
  provider: string | null;
  time: string | null;
  thread: ThreadMeta;
  turns: ConversationTurn[];
}

export interface TurnLabels {
  prompt: string;
  response: string;
}

type HeadingKind = 'provider' | 'time' | 'prompt' | 'response';

interface ScannedLine {
  heading: HeadingKind | null;
  isHeading: boolean;
  marker: 'thread' | 'turn' | null;
  markerJson: string | null;
  fenced: boolean;
}

const MARKER_RE = /^<!--\s*yobi:(thread|turn)\s+(\{.*\})\s*-->$/;
const FENCE_RE = /^(?:```|~~~)/;
const H1_RE = /^#\s+(.+)$/;
const H2_RE = /^##\s+(.+)$/;
const ESCAPED_HEADING_RE = /^\\(?=#)/;

/**
 * A conversation file re-saved by a CRLF editor or a sync tool used to parse as zero turns:
 * `$` is not multiline and `.` never matches `\r`, so `## Prompt\r` matched no heading while
 * the markers (which are trimmed) still read fine. The document then looked like a fresh
 * one-turn file whose `threadTurns` was already past it, and every later turn silently
 * replayed with no history.
 */
function splitLines(raw: string): string[] {
  return raw.split(/\r?\n/);
}

function classify(heading: string, aliases: ConversationHeadingAliases): HeadingKind | null {
  if (aliases.provider.has(heading)) return 'provider';
  if (aliases.time.has(heading)) return 'time';
  if (aliases.prompt.has(heading)) return 'prompt';
  if (aliases.response.has(heading)) return 'response';
  return null;
}

/**
 * Marks the lines that sit inside a fenced code block. A fence that is never closed does not
 * count as one.
 *
 * Two requirements pull against each other here and both are real. A marker quoted inside a
 * genuine code block has to stay quoted, or a model echoing this format back invents turns
 * that nothing can tell apart from real ones. But a model answer that opens a fence and never
 * closes it used to swallow every turn written after it — the file then parsed as fewer turns
 * than `threadTurns` claimed, so native continuation was lost and the replay it fell back to
 * carried raw markers as if they were part of the conversation.
 *
 * Requiring the closer separates the two: the quoted marker keeps its fence, the malformed one
 * never had a fence to begin with.
 */
function fencedLines(lines: string[]): boolean[] {
  const fenced = new Array<boolean>(lines.length).fill(false);
  let openerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const isFence = FENCE_RE.test(lines[i].trim());
    if (openerIndex < 0) {
      if (isFence) {
        openerIndex = i;
        fenced[i] = true;
      }
      continue;
    }
    fenced[i] = true;
    if (isFence) openerIndex = -1;
  }
  // The last fence was never closed, so it opened nothing.
  if (openerIndex >= 0) {
    for (let i = openerIndex; i < lines.length; i++) fenced[i] = false;
  }
  return fenced;
}

function scan(lines: string[], aliases: ConversationHeadingAliases): ScannedLine[] {
  const fenced = fencedLines(lines);
  return lines.map((line, index) => {
    const plain = (isFenced: boolean): ScannedLine => ({
      heading: null, isHeading: false, marker: null, markerJson: null, fenced: isFenced,
    });
    if (fenced[index]) return plain(true);

    const markerMatch = MARKER_RE.exec(line.trim());
    if (markerMatch) {
      return {
        heading: null,
        isHeading: false,
        marker: markerMatch[1] === 'thread' ? 'thread' : 'turn',
        markerJson: markerMatch[2],
        fenced: false,
      };
    }

    const h2 = H2_RE.exec(line);
    if (!h2) return plain(false);
    return {
      heading: classify(h2[1].trim(), aliases),
      isHeading: true,
      marker: null,
      markerJson: null,
      fenced: false,
    };
  });
}

export function extractTurnMetas(raw: string): TurnMeta[] {
  const lines = splitLines(raw);
  const fenced = fencedLines(lines);
  const metas: TurnMeta[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const match = MARKER_RE.exec(lines[i].trim());
    if (match?.[1] === 'turn') metas.push(parseMarkerJson(match[2]) as TurnMeta);
  }
  return metas;
}

function parseMarkerJson(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function sectionValue(lines: string[], scanned: ScannedLine[], headingIdx: number): string | null {
  if (headingIdx < 0) return null;
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (scanned[i].isHeading || scanned[i].marker !== null) { end = i; break; }
  }
  return lines.slice(headingIdx + 1, end).join('\n').trim() || null;
}

function previousMeaningfulLine(lines: string[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (lines[i].trim() === '') continue;
    return i;
  }
  return -1;
}

export function parseConversationDoc(
  raw: string,
  aliases: ConversationHeadingAliases,
): ConversationDoc {
  const lines = splitLines(raw);
  const scanned = scan(lines, aliases);

  let title: string | null = null;
  let providerIdx = -1;
  let timeIdx = -1;
  let threadIdx = -1;
  let firstTurnMarker = Number.POSITIVE_INFINITY;

  for (let i = 0; i < lines.length; i++) {
    const info = scanned[i];
    if (info.marker === 'thread' && threadIdx < 0) threadIdx = i;
    if (info.marker === 'turn' && !Number.isFinite(firstTurnMarker)) firstTurnMarker = i;
    if (title === null && !info.fenced && !info.isHeading && info.marker === null) {
      const h1 = H1_RE.exec(lines[i]);
      if (h1) title = h1[1].trim();
    }
    if (info.heading === 'provider' && providerIdx < 0) providerIdx = i;
    if (info.heading === 'time' && timeIdx < 0) timeIdx = i;
  }

  const rawThread = parseMarkerJson(threadIdx >= 0 ? scanned[threadIdx].markerJson : null);
  const thread: ThreadMeta = { ...(rawThread as Omit<ThreadMeta, 'v'>), v: 1 };

  const turnStarts: { start: number; markerLine: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (scanned[i].heading !== 'prompt') continue;
    const prev = previousMeaningfulLine(lines, i);
    const markerLine = prev >= 0 && scanned[prev].marker === 'turn' ? prev : -1;
    if (i < firstTurnMarker || markerLine >= 0) turnStarts.push({ start: i, markerLine });
  }

  const turns: ConversationTurn[] = turnStarts.map(({ start, markerLine }, index) => {
    const next = turnStarts[index + 1];
    const end = next ? (next.markerLine >= 0 ? next.markerLine : next.start) : lines.length;
    let responseIdx = -1;
    for (let i = start + 1; i < end; i++) {
      if (scanned[i].heading === 'response') { responseIdx = i; break; }
    }
    const promptEnd = responseIdx >= 0 ? responseIdx : end;
    const prompt = unescapeSectionHeadings(lines.slice(start + 1, promptEnd).join('\n').trim());
    const response = responseIdx >= 0
      ? unescapeSectionHeadings(lines.slice(responseIdx + 1, end).join('\n').trim())
      : '';
    const meta = markerLine >= 0
      ? (parseMarkerJson(scanned[markerLine].markerJson) as TurnMeta)
      : {};
    return { prompt, response, meta };
  });

  return {
    title,
    provider: sectionValue(lines, scanned, providerIdx),
    time: sectionValue(lines, scanned, timeIdx),
    thread,
    turns,
  };
}

/**
 * Escapes a section heading the user typed so it is not read back as this turn's structure.
 * A prompt whose own line is `## Response` would otherwise end the prompt there and prepend
 * the rest of it to the answer. `\##` is the CommonMark escape, so it still renders as the
 * text the user wrote.
 *
 * The guard covers the labels the document is being written with, which is the case that
 * matters: the parser accepts every installed locale's labels, so a prompt carrying a
 * DIFFERENT locale's heading text is still ambiguous and still splits at that line.
 */
export function escapeSectionHeadings(text: string, labels: TurnLabels): string {
  const guarded = new Set([labels.prompt.trim(), labels.response.trim()]);
  return splitLines(text)
    .map((line) => {
      const h2 = H2_RE.exec(line);
      return h2 && guarded.has(h2[1].trim()) ? `\\${line}` : line;
    })
    .join('\n');
}

function unescapeSectionHeadings(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(ESCAPED_HEADING_RE, ''))
    .join('\n');
}

export function appendTurn(
  raw: string,
  turn: { prompt: string; response: string; meta: TurnMeta },
  labels: TurnLabels,
): string {
  const body = raw.replace(/\s+$/, '');
  const block = [
    `<!-- yobi:turn ${JSON.stringify(turn.meta ?? {})} -->`,
    `## ${labels.prompt}`,
    '',
    escapeSectionHeadings(turn.prompt.trim(), labels),
    '',
    `## ${labels.response}`,
    '',
    repairSplitTableRows(turn.response.trim()),
    '',
  ];
  return body ? [body, '', ...block].join('\n') : block.join('\n');
}

export function stripConversationMarkers(raw: string): string {
  return splitLines(raw).filter((line) => !MARKER_RE.test(line.trim())).join('\n');
}

function blockquote(text: string): string {
  return text.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

function withoutMetaSections(raw: string, aliases: ConversationHeadingAliases): string {
  const lines = splitLines(raw);
  const scanned = scan(lines, aliases);
  const kept: string[] = [];
  let dropping = false;
  let sawValue = false;
  for (let i = 0; i < lines.length; i++) {
    const info = scanned[i];
    if (info.marker !== null) { dropping = false; continue; }
    if (info.isHeading) {
      dropping = info.heading === 'provider' || info.heading === 'time';
      sawValue = false;
      if (dropping) continue;
    }
    if (dropping) {
      const blank = lines[i].trim() === '';
      if (blank && sawValue) dropping = false;
      else if (!blank) sawValue = true;
      continue;
    }
    kept.push(lines[i]);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildShareMarkdown(raw: string, aliases: ConversationHeadingAliases): string {
  const doc = parseConversationDoc(raw, aliases);
  if (doc.turns.length === 0) return withoutMetaSections(raw, aliases);

  const parts: string[] = [];
  if (doc.title) parts.push(`# ${doc.title}`);
  for (const turn of doc.turns) {
    if (turn.prompt) parts.push(blockquote(turn.prompt));
    if (turn.response) parts.push(turn.response);
  }
  return parts.join('\n\n');
}

export function writeThreadMeta(raw: string, meta: ThreadMeta): string {
  const line = `<!-- yobi:thread ${JSON.stringify({ ...meta, v: 1 })} -->`;
  const lines = splitLines(raw);
  const scanned = scan(lines, { provider: new Set(), time: new Set(), prompt: new Set(), response: new Set() });

  const existing = scanned.findIndex((info) => info.marker === 'thread');
  if (existing >= 0) {
    lines[existing] = line;
    return lines.join('\n');
  }

  const h1 = lines.findIndex((candidate, index) => !scanned[index].fenced && H1_RE.test(candidate));
  if (h1 < 0) return [line, '', raw].join('\n');
  lines.splice(h1 + 1, 0, '', line);
  return lines.join('\n');
}
