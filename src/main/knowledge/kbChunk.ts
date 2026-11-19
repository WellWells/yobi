/**
 * Splits a document's text into the passages the knowledge base indexes and cites.
 *
 * Each chunk carries a header the program writes, not a model: the file's name, the Markdown
 * heading path it sits under, and its PDF page. Measured on 4,262 chunks of real project
 * documents (20 paraphrased questions): that header, indexed in its own column at twice the body's
 * weight, cut retrieval failures at rank 20 from 20% to 15% and raised MRR 0.539 → 0.619, while a
 * model-written context per chunk (Contextual Retrieval) added nothing measurable on top of it for
 * keyword search and cost a model call per batch of chunks.
 */

export interface KbChunk {
  /** Position in the file, from 0. */
  ord: number;
  /** `name › heading › sub-heading · p.12`. */
  head: string;
  body: string;
}

/** Aim for passages of about this many characters; a paragraph is never split below it. */
export const CHUNK_TARGET_CHARS = 900;
/** A single paragraph longer than this is cut at sentence ends. */
const CHUNK_MAX_CHARS = 1_400;

const PAGE_MARKER = /^--- page (\d+) ---$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SENTENCE_END = /(?<=[。！？!?；;])|(?<=\.)\s+/;

interface Block {
  text: string;
  page: number;
  headings: string[];
}

/** Paragraphs with the heading path and page each one sits under. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  const headings: string[] = [];
  let page = 0;
  let lines: string[] = [];
  const flush = (): void => {
    const body = lines.join('\n').trim();
    lines = [];
    if (body) out.push({ text: body, page, headings: [...headings] });
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const pageMark = PAGE_MARKER.exec(line.trim());
    if (pageMark) {
      flush();
      page = Number(pageMark[1]);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      // Headings with nothing under them yet ride along with the text that follows.
      if (lines.some((kept) => !HEADING.test(kept))) flush();
      const level = heading[1].length;
      headings.length = Math.min(headings.length, level - 1);
      headings[level - 1] = heading[2].slice(0, 80);
      // A skipped level leaves a hole; keep the path dense.
      for (let i = 0; i < headings.length; i++) if (headings[i] === undefined) headings[i] = '';
      lines.push(line);
      continue;
    }
    if (!line.trim()) {
      if (lines.some((kept) => !HEADING.test(kept))) flush();
      continue;
    }
    lines.push(line);
  }
  flush();
  return out;
}

/** A paragraph too long to cite as one passage, cut at sentence ends (or hard, when it has none). */
function splitLong(text: string): string[] {
  if (text.length <= CHUNK_MAX_CHARS) return [text];
  const pieces: string[] = [];
  let current = '';
  for (const sentence of text.split(SENTENCE_END)) {
    if (current && current.length + sentence.length > CHUNK_TARGET_CHARS) {
      pieces.push(current);
      current = '';
    }
    current += sentence;
    while (current.length > CHUNK_MAX_CHARS) {
      pieces.push(current.slice(0, CHUNK_TARGET_CHARS));
      current = current.slice(CHUNK_TARGET_CHARS);
    }
  }
  if (current.trim()) pieces.push(current);
  return pieces.map((piece) => piece.trim()).filter(Boolean);
}

function headFor(title: string, block: Block, lastPage = block.page): string {
  const path = block.headings.filter(Boolean);
  const pages = !block.page ? '' : lastPage > block.page ? ` · p.${block.page}–${lastPage}` : ` · p.${block.page}`;
  return [title, ...path].join(' › ') + pages;
}

/**
 * The file's chunks, in order. `title` is what the user knows the file by (its name). Short pages
 * share a passage; its header then names every page it spans (`p.1–2`), so a citation of the second
 * page's words is not pinned on the first.
 */
export function chunkDocument(title: string, text: string): KbChunk[] {
  const chunks: KbChunk[] = [];
  let body = '';
  let first: Block | null = null;
  let lastPage = 0;
  const push = (): void => {
    if (body.trim() && first) chunks.push({ ord: chunks.length, head: headFor(title, first, lastPage), body: body.trim() });
    body = '';
    first = null;
  };
  for (const block of blocks(text)) {
    // A new heading or page starts a new passage once the current one is worth citing on its own.
    if (body && first && headFor(title, block) !== headFor(title, first) && body.length >= CHUNK_TARGET_CHARS / 3) push();
    for (const piece of splitLong(block.text)) {
      if (body && body.length + piece.length > CHUNK_TARGET_CHARS) push();
      if (!first) first = block;
      lastPage = block.page;
      body = body ? `${body}\n\n${piece}` : piece;
    }
  }
  push();
  return chunks;
}
