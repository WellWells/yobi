export const CONVERSATION_TITLE_LIMIT = 40;

const TITLE_MARKER = /\{\{\s*title\s*[:：]\s*([^{}\n]*?)\s*\}\}/i;
const TITLE_MARKER_GLOBAL = /\{\{\s*title\s*[:：]\s*([^{}\n]*?)\s*\}\}/gi;
// A model may drop a brace or copy the punctuation that follows the format in the rule; that loose
// form only counts at the very start of the reply, where nothing but the marker was asked for.
const LOOSE_LEADING_MARKER = /^\s*\{\{?\s*title\s*[:：]\s*([^{}\n]*?)\s*\}\}?[ \t]*[—–\-:：,，.。]*[ \t]*/i;

export function normalizeTitle(raw: string): string {
  let text = (raw ?? '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^#{1,6}\s*/, '');
  text = text.replace(/^\*\*(.+)\*\*$/, '$1').trim();
  text = text.replace(/^["'`“‘「『]+/, '');
  text = text.replace(/["'`”’」』]+$/, '');
  return text.replace(/[.。,，;；:：]+$/, '').trim();
}

export function capTitle(raw: string, limit: number = CONVERSATION_TITLE_LIMIT): string {
  const chars = [...(raw ?? '')];
  return chars.length <= limit ? (raw ?? '') : `${chars.slice(0, limit).join('')}…`;
}

export function cleanTitle(raw: string, limit?: number): string {
  return capTitle(normalizeTitle(raw), limit);
}

export function pickConversationTitle(sources: {
  resolved?: string;
  marker?: string;
  provider?: string;
  prompt?: string;
  fallback?: string;
}): string {
  const candidates = [sources.resolved, sources.marker, sources.provider, sources.prompt];
  for (const candidate of candidates) {
    const title = cleanTitle(candidate ?? '');
    if (title) return title;
  }
  return sources.fallback ?? 'Untitled';
}

export function extractTitleMarker(raw: string): { title: string; body: string } {
  const text = raw ?? '';
  const leading = LOOSE_LEADING_MARKER.exec(text);
  if (!leading && !TITLE_MARKER.test(text)) return { title: '', body: text };

  let title = leading ? normalizeTitle(leading[1] ?? '') : '';
  const body = (leading ? text.slice(leading[0].length) : text)
    .replace(TITLE_MARKER_GLOBAL, (_match, captured: string) => {
      if (!title) title = normalizeTitle(captured);
      return '';
    })
    .replace(/^[ \t]*\r?\n/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, body };
}
