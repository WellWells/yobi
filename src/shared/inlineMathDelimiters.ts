/**
 * Promotes single-dollar inline math to `$$…$$` before the markdown is parsed.
 *
 * remark-math runs with `singleDollarTextMath: false`, because a `$` that is a
 * syntax character turns a price answer into nonsense: four dollars in one bullet
 * pair up into two math spans that swallow the prose and the citation links in
 * between, and those links cannot be recovered afterwards — they are consumed
 * during parsing, before they are ever links. The cost of that setting is that
 * `$x + y$`, which every model still emits, renders as raw text.
 *
 * Rewriting the source is the only place both can be true at once. A span is
 * promoted only if it clears every rule below; everything else stays the literal
 * text it already was, so currency is never one bad heuristic away from being
 * eaten.
 *
 * The rules were fitted against 110 saved answers. Relaxing remark-math on that
 * corpus produced 46 inline math spans: 45 currency, 1 real formula.
 *
 *  1. Neither delimiter hugs whitespace — the Pandoc rule. Kills `$500 … $9` and
 *     every other pair of prices separated by prose.
 *  2. The closing `$` is not followed by a digit. Kills `$123~$456`.
 *  3. The opening `$` is not glued to a letter or digit, which makes `NT$…` a
 *     price and stops a `$` inside a URL from opening a formula that swallows the
 *     autolink after it.
 *  4. The body holds no CJK text, no markdown link, no line break and no code
 *     span. KaTeX sets CJK in an italic math font, and the rest are markdown
 *     structure that math would destroy — including a citation whose URL happens
 *     to contain a `$`.
 *
 * Code spans and fenced blocks are masked out first, so `$PATH` in a shell
 * snippet is never a delimiter.
 */

const MASK = '\u0000';
const MAX_FENCE_INDENT = 3;
const MIN_FENCE_LENGTH = 3;

const ALNUM = /[0-9A-Za-z]/;
const DIGIT = /[0-9]/;
const SPACE = /\s/;

/**
 * What a formula may not contain: CJK ranges (symbols and punctuation, kana, the
 * unified ideographs and their compatibility and fullwidth forms), a line break,
 * a markdown link, or a masked code span. Greek letters and math operators are
 * deliberately absent — `$\alpha \le \beta$` is exactly what this is for.
 */
const BODY_VETO = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\u0000\n]|\]\(/;

interface Fence {
  marker: string;
  length: number;
}

function parseFenceOpen(line: string): Fence | null {
  const indent = line.length - line.trimStart().length;
  if (indent > MAX_FENCE_INDENT) return null;
  const marker = line[indent];
  if (marker !== '`' && marker !== '~') return null;
  let length = 0;
  while (line[indent + length] === marker) length += 1;
  if (length < MIN_FENCE_LENGTH) return null;
  if (marker === '`' && line.slice(indent + length).includes('`')) return null;
  return { marker, length };
}

function closesFence(line: string, open: Fence): boolean {
  const indent = line.length - line.trimStart().length;
  if (indent > MAX_FENCE_INDENT) return false;
  let length = 0;
  while (line[indent + length] === open.marker) length += 1;
  if (length < open.length) return false;
  return line.slice(indent + length).trim() === '';
}

/** Finds the run of exactly `length` backticks that closes a code span. */
function findCodeSpanEnd(line: string, from: number, length: number): number {
  let index = from;
  while (index < line.length) {
    if (line[index] !== '`') {
      index += 1;
      continue;
    }
    let run = 0;
    while (line[index + run] === '`') run += 1;
    if (run === length) return index;
    index += run;
  }
  return -1;
}

function maskInlineCode(line: string): string {
  if (!line.includes('`')) return line;
  let out = '';
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === '\\' && index + 1 < line.length) {
      out += line.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char !== '`') {
      out += char;
      index += 1;
      continue;
    }
    let run = 0;
    while (line[index + run] === '`') run += 1;
    const end = findCodeSpanEnd(line, index + run, run);
    if (end < 0) {
      out += line.slice(index, index + run);
      index += run;
      continue;
    }
    out += MASK.repeat(end + run - index);
    index = end + run;
  }
  return out;
}

/**
 * A copy of the source with every code region replaced by an opaque character of
 * the same length, so positions found in it index straight back into the original.
 */
function maskCode(markdown: string): string {
  let fence: Fence | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      if (fence) {
        if (closesFence(line, fence)) fence = null;
        return MASK.repeat(line.length);
      }
      const open = parseFenceOpen(line);
      if (open) {
        fence = open;
        return MASK.repeat(line.length);
      }
      return maskInlineCode(line);
    })
    .join('\n');
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  while (index - slashes - 1 >= 0 && text[index - slashes - 1] === '\\') slashes += 1;
  return slashes % 2 === 1;
}

function nextDollar(text: string, from: number): number {
  let index = text.indexOf('$', from);
  while (index >= 0 && isEscaped(text, index)) index = text.indexOf('$', index + 1);
  return index;
}

/**
 * The index of the `$` that closes a formula opened at `open`, or -1.
 *
 * Only the first dollar after the opener is ever considered. The body can only
 * grow, so once it holds a second dollar no later candidate can produce a span
 * worth rendering — abandoning here is what keeps `$549 … HK$4,282 … TOPS/$`
 * from pairing its outermost two dollars around the whole sentence.
 */
function closerFor(masked: string, open: number): number {
  const before = masked[open - 1];
  if (before !== undefined && ALNUM.test(before)) return -1;
  const first = masked[open + 1];
  if (first === undefined || SPACE.test(first)) return -1;

  const close = nextDollar(masked, open + 1);
  if (close < 0 || masked[close + 1] === '$') return -1;
  if (SPACE.test(masked[close - 1])) return -1;
  const after = masked[close + 1];
  if (after !== undefined && DIGIT.test(after)) return -1;
  if (BODY_VETO.test(masked.slice(open + 1, close))) return -1;
  return close;
}

/**
 * The body of a line that is nothing but one `$$…$$` pair, or null if it is not one.
 *
 * Runs against the code-masked copy, so a `$$` inside a code span or fence can never
 * qualify. `MASK` in the body means a code span sits inside the delimiters, which is
 * never a formula; a `$` in it means the line holds more than one pair.
 */
function displayBody(masked: string): string | null {
  const indent = masked.length - masked.trimStart().length;
  if (indent > MAX_FENCE_INDENT) return null;
  const trimmed = masked.trim();
  if (!trimmed.startsWith('$$') || !trimmed.endsWith('$$')) return null;
  const body = trimmed.slice(2, -2).trim();
  if (!body || body.includes('$') || body.includes(MASK)) return null;
  return body;
}

/** A line that closes an open math fence: dollars and nothing else. */
const FENCE_ONLY = /^\$\$+$/;

/**
 * Splits a one-line `$$…$$` into a real math fence, so it renders as display math.
 *
 * micromark's math-flow tokenizer rejects a `$` in the fence's info string, which means
 * `$$x$$` closed on the same line can never open a block: it falls through to paragraph
 * content and becomes inline math, glued to the tail of whatever sentence precedes it.
 * Models write display math that way constantly — a lead-in sentence, then the formula on
 * the next line — and the result is a formula-height line box wedged between two
 * text-height ones, with none of the centering or margins a block would bring.
 *
 * A fence interrupts a paragraph on its own, so the rewrite only has to break the one line
 * into three; no blank line is invented and no surrounding structure moves. The indent is
 * carried onto all three lines, which is what keeps a formula inside a list item in its
 * item. Anything with a prefix — a blockquote's `>`, a table row's `|` — never starts with
 * `$$` and is left exactly as written.
 *
 * Runs before `promoteInlineMath`, so only what the model wrote as `$$…$$` becomes a block;
 * a single-dollar span stays inline no matter where it sits.
 */
export function promoteDisplayMath(markdown: string): string {
  if (!markdown.includes('$$')) return markdown;
  const lines = markdown.split('\n');
  const masked = maskCode(markdown).split('\n');
  let inFence = false;
  let changed = false;

  const out = lines.map((line, index) => {
    const probe = masked[index];
    const trimmed = probe.trim();

    if (inFence) {
      if (FENCE_ONLY.test(trimmed)) inFence = false;
      return line;
    }

    const body = displayBody(probe);
    if (body === null) {
      // `$$` with no closer on the same line is a real fence: everything until it closes
      // is literal TeX, where a `$$a$$` line is content rather than a candidate.
      if (trimmed.startsWith('$$')) inFence = true;
      return line;
    }

    changed = true;
    const indent = line.slice(0, line.length - line.trimStart().length);
    const source = line.trim().slice(2, -2).trim();
    return `${indent}$$\n${indent}${source}\n${indent}$$`;
  });

  return changed ? out.join('\n') : markdown;
}

export function promoteInlineMath(markdown: string): string {
  if (!markdown.includes('$')) return markdown;
  const masked = maskCode(markdown);
  let out = '';
  let copied = 0;
  let index = 0;

  while (index < masked.length) {
    const open = nextDollar(masked, index);
    if (open < 0) break;

    // A display span is already correct, and its contents must not be re-scanned.
    if (masked[open + 1] === '$') {
      const end = masked.indexOf('$$', open + 2);
      index = end < 0 ? open + 2 : end + 2;
      continue;
    }

    const close = closerFor(masked, open);
    if (close < 0) {
      index = open + 1;
      continue;
    }

    out += `${markdown.slice(copied, open)}$$${markdown.slice(open + 1, close)}$$`;
    copied = close + 1;
    index = close + 1;
  }

  return copied === 0 ? markdown : out + markdown.slice(copied);
}
