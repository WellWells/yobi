/**
 * GFM footnotes rewritten as plain bracketed numbers, for outputs whose parser (marked) has no
 * footnote syntax: Telegram, LINE and email.
 *
 * marked reads `[^1]: note` as a link reference definition; when the note has no space (most CJK
 * text) the note becomes the "address" and disappears. Here a reference becomes `[1]` and a
 * definition becomes a line starting with `[1]`, where the model put it.
 *
 * Stateless on purpose: a long answer is split into several messages before formatting, so nothing
 * is moved or renumbered and each chunk reads the same alone. A `[^x]` with no definition is only
 * rewritten when its label is a number.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*/;
/** A code span is matched first and kept; otherwise a footnote reference. */
const REFERENCE_OR_CODE = /(`+)[^\n]*?\1|\[\^([^\]\s]+)\]/g;
const CONTINUATION = /^(?: {4}|\t)/;
const NUMERIC = /^\d+$/;

function normalizeLabel(label: string): string {
  return label.toLowerCase();
}

function definedLabels(lines: readonly string[]): Set<string> {
  const labels = new Set<string>();
  let fence: string | null = null;
  for (const line of lines) {
    const opener = FENCE.exec(line)?.[1];
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null;
      continue;
    }
    if (opener) {
      fence = opener;
      continue;
    }
    const definition = DEFINITION.exec(line);
    if (definition) labels.add(normalizeLabel(definition[1]));
  }
  return labels;
}

export function flattenFootnotes(markdown: string): string {
  if (!markdown.includes('[^')) return markdown;
  const lines = markdown.split('\n');
  const defined = definedLabels(lines);
  const rewriteReferences = (line: string): string =>
    line.replace(REFERENCE_OR_CODE, (match, ticks: string | undefined, label: string | undefined) => {
      if (ticks || !label) return match;
      return defined.has(normalizeLabel(label)) || NUMERIC.test(label) ? `[${label}]` : match;
    });

  let fence: string | null = null;
  let inDefinition = false;
  return lines.map((line) => {
    const opener = FENCE.exec(line)?.[1];
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null;
      return line;
    }
    if (opener) {
      fence = opener;
      inDefinition = false;
      return line;
    }
    const definition = DEFINITION.exec(line);
    if (definition) {
      inDefinition = true;
      return rewriteReferences(`[${definition[1]}] ${line.slice(definition[0].length)}`);
    }
    if (inDefinition && line.trim() !== '') {
      // A note's later paragraphs are indented under it; unindented, they are not code.
      if (CONTINUATION.test(line)) return rewriteReferences(line.replace(CONTINUATION, ''));
      inDefinition = false;
    }
    return rewriteReferences(line);
  }).join('\n');
}
