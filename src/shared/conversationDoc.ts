export interface ThreadMeta {
  v: 1;
  provider?: string;
  threadUrl?: string;
  threadTurns?: number;
  summary?: string;
  summarizedTurns?: number;
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

function classify(heading: string, aliases: ConversationHeadingAliases): HeadingKind | null {
  if (aliases.provider.has(heading)) return 'provider';
  if (aliases.time.has(heading)) return 'time';
  if (aliases.prompt.has(heading)) return 'prompt';
  if (aliases.response.has(heading)) return 'response';
  return null;
}

function scan(lines: string[], aliases: ConversationHeadingAliases): ScannedLine[] {
  let inFence = false;
  return lines.map((line) => {
    const trimmed = line.trim();
    const plain = (fenced: boolean): ScannedLine => ({
      heading: null, isHeading: false, marker: null, markerJson: null, fenced,
    });
    if (FENCE_RE.test(trimmed)) {
      inFence = !inFence;
      return plain(true);
    }
    if (inFence) return plain(true);

    const markerMatch = MARKER_RE.exec(trimmed);
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
  const metas: TurnMeta[] = [];
  let inFence = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (FENCE_RE.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = MARKER_RE.exec(trimmed);
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
  const lines = raw.split('\n');
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
    const prompt = lines.slice(start + 1, promptEnd).join('\n').trim();
    const response = responseIdx >= 0 ? lines.slice(responseIdx + 1, end).join('\n').trim() : '';
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
    turn.prompt.trim(),
    '',
    `## ${labels.response}`,
    '',
    turn.response.trim(),
    '',
  ];
  return body ? [body, '', ...block].join('\n') : block.join('\n');
}

export function stripConversationMarkers(raw: string): string {
  return raw.split('\n').filter((line) => !MARKER_RE.test(line.trim())).join('\n');
}

function blockquote(text: string): string {
  return text.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

function withoutMetaSections(raw: string, aliases: ConversationHeadingAliases): string {
  const lines = raw.split('\n');
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
  const lines = raw.split('\n');
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
