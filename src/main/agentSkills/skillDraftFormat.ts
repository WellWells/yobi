import type { SkillTextFiles } from '../../shared/skillAuthoring';
import type { Validation } from '../flow/agent/structuredLlm';

/*
 * A drafting reply: one block per file, each between marker lines and inside a code fence, or a
 * QUESTIONS block instead. Not one JSON object: code inside a JSON string must escape every quote,
 * backslash and newline, which weaker models get wrong, and a browser provider's Markdown copy
 * rewrites what is outside a code fence (`\d`, `*`, `_`, `<`). The markers are `@@@ … @@@`:
 * ChatGPT's renderer reads `<<<FILE` as an HTML tag and drops it, and `@` means nothing in
 * Markdown. The reader still takes `<<< … >>>` (models that fall back to it), markers escaped by a
 * copy (`\<\<\<`) or ending in its hard-break backslash, fences of three or more backticks or
 * tildes, mangled ones, or none. An ANALYSIS block (an older format) is skipped.
 */

export interface DraftReply {
  questions: string[];
  files: SkillTextFiles;
}

const QUESTIONS_MAX = 3;

// END also as the closers models make up for it: `@@@ END FILE @@@`, `<<<END_OF_FILE>>>`, `<<</FILE>>>`.
const MARKER = /^\s*(?:\*\*)?\s*(?:(?:\\?<){3}|(?:\\?@){3})\s*(ANALYSIS|QUESTIONS|END\b[^<>@]*?|\/\s*FILE[^<>@]*?|FILE(?:\s*:\s*|\s+)(.+?))\s*(?:(?:\\?>){3}|(?:\\?@){3})\s*(?:\*\*)?\s*\\?\s*$/i;
const LONE_FENCE = /^\s*(`{3,}|~{3,})\s*$/;
// Fences as models mangle them (Gemini Flash: "``js", "``@js" to open, "``^^^" to close): two or
// more backticks or three tildes, no code. No file starts with the first or ends with the second.
const FENCE_OPEN = /^\s*(`{2,}|~{3,})[^`~]*$/;
const FENCE_DEBRIS = /^\s*(?:`{2,}|~{3,})[^\w\s`~]*\s*$/;

interface Section {
  kind: 'skipped' | 'questions' | 'file';
  path: string;
  lines: string[];
}

/** The content of a block, without the code fence it was written in. */
export function unfence(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  const open = lines[start]?.match(FENCE_OPEN);
  if (open) {
    start += 1;
    end = closingFence(lines, start, end, open[1][0]);
  } else {
    // The opening fence left out but the closing one kept: that line is not part of the file.
    while (end > start && (FENCE_DEBRIS.test(lines[end - 1]) || !lines[end - 1].trim())) end -= 1;
  }
  return lines.slice(start, end).join('\n');
}

/**
 * Where a fenced block's content ends: a closing fence, mangled or not, on the last line; else the
 * last lone fence of the same kind (text the model wrote after it is not part of the file).
 */
function closingFence(lines: readonly string[], start: number, end: number, fenceChar: string): number {
  if (end > start && FENCE_DEBRIS.test(lines[end - 1])) return end - 1;
  for (let i = end - 1; i >= start; i--) {
    if (lines[i].match(LONE_FENCE)?.[1][0] === fenceChar) return i;
  }
  return end;
}

/** A path as the model wrote it, inside the skill folder; null when it points outside. */
export function draftPath(raw: string): string | null {
  // The Markdown copy escapes punctuation (`tw\_id.mjs`); quotes and backticks are decoration.
  const rel = raw.trim().replace(/^[`'"]+|[`'"]+$/g, '').replace(/\\([_\-.*[\]()#+!])/g, '$1').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel || rel.startsWith('/') || /^[a-z]:/i.test(rel) || rel.split('/').some((part) => part === '..' || part === '')) return null;
  return rel;
}

// A fence and a marker run together on one line (Gemini Flash: "``@@@ END @@@"): the fence closes the block above.
const GLUED_MARKER = /^(\s*(?:`{2,}|~{3,}))(\s*(?:\\?[@<]){3}.*)$/;

function sections(raw: string): Section[] {
  const found: Section[] = [];
  let current: Section | null = null;
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').flatMap((line) => {
    const glued = line.match(GLUED_MARKER);
    return glued ? [glued[1], glued[2]] : [line];
  });
  for (const line of lines) {
    const marker = line.match(MARKER);
    if (!marker) {
      current?.lines.push(line);
      continue;
    }
    const word = marker[1].toUpperCase();
    if (word.startsWith('END') || word.startsWith('/')) {
      current = null;
      continue;
    }
    const kind = word === 'ANALYSIS' ? 'skipped' : word === 'QUESTIONS' ? 'questions' : 'file';
    current = { kind, path: kind === 'file' ? marker[2] ?? '' : '', lines: [] };
    found.push(current);
  }
  return found;
}

/** The questions of a QUESTIONS block, one a line, without the numbers or bullets models put before them. */
function questionsOf(lines: readonly string[]): string[] {
  return unfence(lines)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、]|Q\d+[:.)])\s*/i, '').trim())
    .filter(Boolean)
    .slice(0, QUESTIONS_MAX);
}

/** Reads a drafting reply; the errors are written for the model, as the rewrite prompt quotes them. */
export function parseDraftReply(raw: string): Validation<DraftReply> {
  const found = sections(raw);
  const files: SkillTextFiles = {};
  for (const section of found) {
    if (section.kind !== 'file') continue;
    const rel = draftPath(section.path);
    if (!rel) return { ok: false, error: `"${section.path.trim()}" is not a path inside the skill folder: write paths like scripts/x.mjs.` };
    const content = unfence(section.lines);
    files[rel] = content.endsWith('\n') ? content : `${content}\n`;
  }
  const questions = found.filter((section) => section.kind === 'questions').flatMap((section) => questionsOf(section.lines)).slice(0, QUESTIONS_MAX);
  if (Object.keys(files).length === 0 && questions.length === 0) {
    return { ok: false, error: 'The reply has no @@@ FILE path @@@ blocks. Write one per file, each in a code fence, then @@@ END @@@.' };
  }
  return { ok: true, value: { questions, files } };
}
