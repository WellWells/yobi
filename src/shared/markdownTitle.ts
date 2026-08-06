const FENCE = /^\s*(?:```|~~~)/;
const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

function plainText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .trim();
}

export function extractMarkdownTitle(markdown: string): string {
  let inFence = false;
  let firstOfAnyLevel = '';
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = ATX_HEADING.exec(line);
    if (!match) continue;
    const title = plainText(match[2]);
    if (!title) continue;
    if (match[1].length === 1) return title;
    if (!firstOfAnyLevel) firstOfAnyLevel = title;
  }
  return firstOfAnyLevel;
}

export interface LeadingTitle {
  title: string;
  body: string;
}

export function splitLeadingTitle(markdown: string): LeadingTitle {
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const match = ATX_HEADING.exec(lines[i]);
    const title = match ? plainText(match[2]) : '';
    if (!title) break;
    return { title, body: lines.slice(i + 1).join('\n').replace(/^(?:[ \t\r]*\n)+/, '') };
  }
  return { title: '', body: markdown };
}
