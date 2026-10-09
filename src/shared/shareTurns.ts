import { fencedLines } from './markdownFences';

export interface ShareTurnLabels {
  /** Heading for a question too long or too structured to be a heading itself (1-based). */
  question: (index: number) => string;
  /** Line opening each answer; `provider` is null when the file never recorded one. */
  answer: (provider: string | null) => string;
  /** Line under the title of a multi-turn share; `provider` is null when the turns differ. */
  intro: (provider: string | null, turns: number) => string;
}

export interface ShareTurnInput {
  prompt: string;
  response: string;
  /** Display name of the provider that answered this turn. */
  provider: string | null;
}

/*
 * The share server's page (PrivateBin) does not style blockquotes, so each question is the turn's
 * heading, the answer's own headings move below it, and a rule separates turns. Each answer opens
 * with an italic line naming who wrote it, and the title gets its own rule so an h1 directly above
 * the first question's h2 does not read as a subtitle.
 */
const QUESTION_LEVEL = 2;
const ANSWER_TOP_LEVEL = QUESTION_LEVEL + 1;
const MAX_LEVEL = 6;
const QUESTION_HEADING_MAX_CHARS = 120;
const QUESTION_HEADING_MAX_LINES = 6;
const TURN_SEPARATOR = '\n\n---\n\n';

const ATX_RE = /^( {0,3})(#{1,6})(?=[ \t]|$)/;
// Lines a heading cannot carry: they only mean something as their own block.
const BLOCK_LINE_RE = /^(?:```|~~~|\||<|\$\$|>|#{1,6}(?:\s|$)|[-*+]\s|\d+[.)]\s|[-*_](?:\s*[-*_]){2,}\s*$)/;
// A provider name is the user's own label for a BYOK key, so it may hold Markdown syntax.
const INLINE_MARKUP_RE = /[\\`*_[\]~|#!]/g;
// PrivateBin's showdown keeps `\<b>` as a live tag, so angle brackets go out as entities.
const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' } as const;

function escapeInline(text: string): string {
  return text
    .replace(/[&<>]/g, (char) => HTML_ENTITIES[char as keyof typeof HTML_ENTITIES])
    .replace(INLINE_MARKUP_RE, '\\$&');
}

function italicLine(text: string): string {
  return `*${text}*`;
}

function blockquote(text: string): string {
  return text.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

/** The question as one heading line, or null when it would not read as one. */
function questionHeading(prompt: string): string | null {
  const raw = prompt.split(/\r?\n/).filter((line) => line.trim());
  if (raw.length === 0 || raw.length > QUESTION_HEADING_MAX_LINES) return null;
  const lines = raw.map((line) => line.trim().replace(/\\+$/, ''));
  if (lines.some((line) => !line || BLOCK_LINE_RE.test(line))) return null;
  if (Array.from(lines.join('')).length > QUESTION_HEADING_MAX_CHARS) return null;
  // A trailing run of `#` after a space is a closing sequence and would be dropped.
  return lines.join('<br>').replace(/(\s)(#+)$/, '$1\\$2');
}

/** Shifts the answer's headings so the highest one sits just below the question. */
function demoteHeadings(text: string): string {
  const lines = text.split(/\r?\n/);
  const fenced = fencedLines(lines);
  let top = MAX_LEVEL + 1;
  lines.forEach((line, index) => {
    const match = fenced[index] ? null : ATX_RE.exec(line);
    if (match) top = Math.min(top, match[2].length);
  });
  const shift = Math.max(0, ANSWER_TOP_LEVEL - top);
  if (shift === 0) return lines.join('\n');
  return lines
    .map((line, index) => (fenced[index]
      ? line
      : line.replace(ATX_RE, (_match, indent: string, hashes: string) =>
        `${indent}${'#'.repeat(Math.min(MAX_LEVEL, hashes.length + shift))}`)))
    .join('\n');
}

function shareTurn(turn: ShareTurnInput, index: number, labels: ShareTurnLabels): string {
  const prompt = turn.prompt.trim();
  const heading = questionHeading(prompt);
  const marks = '#'.repeat(QUESTION_LEVEL);
  const parts = heading
    ? [`${marks} ${heading}`]
    : [`${marks} ${labels.question(index + 1)}`, ...(prompt ? [blockquote(prompt)] : [])];
  const response = turn.response.trim();
  if (response) {
    const provider = turn.provider?.trim();
    parts.push(italicLine(labels.answer(provider ? escapeInline(provider) : null)), demoteHeadings(response));
  }
  return parts.join('\n\n');
}

/** The one provider every turn names, or null when they differ or none is known. */
function soleProvider(turns: readonly ShareTurnInput[]): string | null {
  const names = new Set(turns.map((turn) => turn.provider?.trim() ?? ''));
  if (names.size !== 1) return null;
  const [name] = names;
  return name || null;
}

export function buildShareTurns(
  title: string | null,
  turns: readonly ShareTurnInput[],
  labels: ShareTurnLabels,
): string {
  const head: string[] = [];
  if (title) head.push(`# ${title}`);
  // One turn needs no count, and its answer line already names the provider.
  if (turns.length > 1) {
    const provider = soleProvider(turns);
    head.push(italicLine(labels.intro(provider ? escapeInline(provider) : null, turns.length)));
  }
  const body = turns.map((turn, index) => shareTurn(turn, index, labels)).join(TURN_SEPARATOR);
  return head.length > 0 ? `${head.join('\n\n')}${TURN_SEPARATOR}${body}` : body;
}
