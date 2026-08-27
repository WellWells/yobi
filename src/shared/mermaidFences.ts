const MAX_FENCE_INDENT = 3;
const MIN_FENCE_LENGTH = 3;

interface FenceOpen {
  marker: string;
  length: number;
  indent: number;
  info: string;
}

function countLeadingSpaces(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === ' ') count += 1;
  return count;
}

function countMarkers(line: string, start: number, marker: string): number {
  let count = 0;
  while (line[start + count] === marker) count += 1;
  return count;
}

function parseFenceOpen(line: string): FenceOpen | null {
  const indent = countLeadingSpaces(line);
  if (indent > MAX_FENCE_INDENT) return null;
  const marker = line[indent];
  if (marker !== '`' && marker !== '~') return null;
  const length = countMarkers(line, indent, marker);
  if (length < MIN_FENCE_LENGTH) return null;
  const info = line.slice(indent + length);
  if (marker === '`' && info.includes('`')) return null;
  return { marker, length, indent, info };
}

function isFenceClose(line: string, open: FenceOpen): boolean {
  const indent = countLeadingSpaces(line);
  if (indent > MAX_FENCE_INDENT) return false;
  const length = countMarkers(line, indent, open.marker);
  if (length < open.length) return false;
  return line.slice(indent + length).trim() === '';
}

function infoLanguage(info: string): string {
  const trimmed = info.trim();
  if (!trimmed) return '';
  const end = trimmed.search(/[\s{]/);
  return (end === -1 ? trimmed : trimmed.slice(0, end)).toLowerCase();
}

function stripIndent(line: string, amount: number): string {
  let removed = 0;
  while (removed < amount && line[removed] === ' ') removed += 1;
  return line.slice(removed);
}

export function isMermaidLanguage(language: string | undefined): boolean {
  return (language ?? '').toLowerCase() === 'mermaid';
}

export function extractMermaidFences(markdown: string): string[] {
  if (!markdown || !/mermaid/i.test(markdown)) return [];
  const lines = markdown.split('\n');
  const found: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const open = parseFenceOpen(lines[index] ?? '');
    index += 1;
    if (!open) continue;

    const body: string[] = [];
    while (index < lines.length && !isFenceClose(lines[index] ?? '', open)) {
      body.push(stripIndent(lines[index] ?? '', open.indent));
      index += 1;
    }
    index += 1;

    if (isMermaidLanguage(infoLanguage(open.info)) && body.length > 0) {
      found.push(body.join('\n'));
    }
  }

  return found;
}
