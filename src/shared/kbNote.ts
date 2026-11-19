/**
 * A knowledge-base file's content analysis, as the model writes it (`analyzePrompt`): labelled
 * sections in a fixed order. The labels are English program text; the content is in the user's
 * language. Parsed here so the page can show it as a source guide (summary, key topics, key facts)
 * rather than raw text; the whole text is what the index searches.
 */
export const KB_NOTE_SECTIONS = ['SUMMARY', 'KEY TOPICS', 'KEY FACTS', 'SEARCH TERMS', 'FULL TEXT'] as const;

export interface KbNote {
  summary: string;
  topics: string[];
  facts: string[];
  terms: string[];
  /** A scan's transcription; '' when the file had text of its own. */
  fullText: string;
}

/** An earlier format opened with this section; it reads as the start of the summary. */
const LEGACY_LEAD = 'WHAT IT IS';

function lines(body: string): string[] {
  return body.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}

/** The sections of a note, or null when it has none of them (shown as plain text then). */
export function parseKbNote(text: string): KbNote | null {
  const labels = [LEGACY_LEAD, ...KB_NOTE_SECTIONS];
  const pattern = new RegExp(`^\\s*(?:\\*\\*|#+\\s*)?(${labels.join('|')})(?:\\*\\*)?\\s*[:：](?:\\*\\*)?`, 'gm');
  const marks = [...text.matchAll(pattern)];
  if (marks.length === 0) return null;
  const sections = new Map<string, string>();
  marks.forEach((mark, i) => {
    const start = (mark.index ?? 0) + mark[0].length;
    const end = marks[i + 1]?.index ?? text.length;
    const label = mark[1] ?? '';
    sections.set(label, `${sections.get(label) ?? ''}\n${text.slice(start, end)}`.trim());
  });
  const lead = sections.get(LEGACY_LEAD) ?? '';
  const summary = [lead, sections.get('SUMMARY') ?? ''].filter(Boolean).join('\n');
  const terms = (sections.get('SEARCH TERMS') ?? '').split(/[,，、\n]/).map((term) => term.trim()).filter(Boolean);
  const fullText = (sections.get('FULL TEXT') ?? '').trim();
  return {
    summary: lines(summary).join(lead ? '\n' : ' '),
    topics: lines(sections.get('KEY TOPICS') ?? ''),
    facts: lines(sections.get('KEY FACTS') ?? ''),
    terms,
    fullText: fullText === '-' ? '' : fullText,
  };
}
