import type { ConversationDoc } from '../../../../../shared/conversationDoc';
import { providerOfThreadUrl } from '../../../../../shared/providerThread';
import { PROVIDER_LABELS } from '../../../../../shared/types';

/**
 * The ⋮ sits at the window's right edge, so its submenus open to the left; opening right, a nested
 * one lands on top of the menu it came from.
 */
export const SUB_POSITION = 'left-start' as const;

/** Chinese characters and Japanese kana count one each: those scripts do not put spaces between words. */
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
/** A run of letters or digits, joined by an apostrophe, dot or hyphen inside it ("don't", "3.5", "e-mail"). */
const WORD = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu;

/** Words as a reader would count them: CJK by character, everything else by word. Markdown symbols are not words. */
export function countReadingWords(text: string): number {
  let cjk = 0;
  const rest = text.replace(CJK_CHAR, () => {
    cjk += 1;
    return ' ';
  });
  return cjk + (rest.match(WORD)?.length ?? 0);
}

/** Questions and answers together, as the menu's info area shows them. */
export function conversationWordCount(turns: ReadonlyArray<{ prompt: string; response: string }>): number {
  return turns.reduce((sum, turn) => sum + countReadingWords(turn.prompt) + countReadingWords(turn.response), 0);
}

export type ThreadLink =
  | { available: true; url: string; provider: string }
  | { available: false };

/**
 * The conversation on the provider's own website, when there is one. API-key, Agent and search
 * answers never open one, so many conversations have none; only an https address on a provider's
 * own host is offered, under that provider's name.
 */
export function threadLink(doc: Pick<ConversationDoc, 'thread'> | null | undefined): ThreadLink {
  const url = doc?.thread.threadUrl?.trim() ?? '';
  const provider = providerOfThreadUrl(url);
  if (!provider) return { available: false };
  return { available: true, url, provider: PROVIDER_LABELS[provider] };
}

/** A first-line `# ` heading, the rule the sidebar's preview and "Edit H1 title" both follow. */
const FIRST_LINE_H1 = /^#\s+(.+)$/;

/**
 * The chat header's title: the conversation's H1 as the sidebar shows it, which the header's pencil
 * rewrites through the same "Edit H1 title"; the file name without `.md` when the file has none.
 */
export function conversationHeaderTitle(content: string | null, fileName: string): string {
  // Only the first line is read: this runs on every render of the chat view, over long files.
  const end = content?.indexOf('\n') ?? -1;
  const firstLine = (end >= 0 ? content?.slice(0, end) : content)?.trim() ?? '';
  const h1 = FIRST_LINE_H1.exec(firstLine)?.[1]?.trim();
  return h1 || fileName.replace(/\.md$/i, '');
}

/** Longer than this, a sidebar preview is the file's opening text rather than its H1. */
const PREVIEW_TITLE_MAX = 120;

/**
 * The header title before the file's content has arrived. Main gives the sidebar row the H1 as its
 * preview, so a conversation switch shows the same title the row does instead of flashing the file
 * name. A file without an H1 gets its opening text as the preview instead; text that starts with a
 * heading or a marker, or runs long, is that, and falls back to the file name.
 */
export function headerTitleBeforeLoad(file: { name: string; preview?: string }): string {
  const stem = file.name.replace(/\.md$/i, '');
  const preview = file.preview?.trim() ?? '';
  if (!preview || preview === file.name || /^(#|<!--)/.test(preview)) return stem;
  return Array.from(preview).length <= PREVIEW_TITLE_MAX ? preview : stem;
}

/** The header title: the loaded file's H1, or the sidebar's while the content is still on its way. */
export function headerTitleFor(content: string | null, file: { name: string; preview?: string }): string {
  return content === null ? headerTitleBeforeLoad(file) : conversationHeaderTitle(content, file.name);
}

/**
 * What a header title edit writes: the trimmed draft, or null when it is blank or the title the
 * edit started from. Compared with that starting title, not the live one: if the H1 changed under
 * an open edit (content arriving, an automatic retitle, another editor), an untouched draft would
 * otherwise write the old title back.
 */
export function headerTitleToWrite(draft: string, startedFrom: string): string | null {
  const title = draft.trim();
  return title && title !== startedFrom.trim() ? title : null;
}

/** The info area's turn and word counts, with digits grouped for the UI language. */
export function menuStatsText(
  template: string,
  turns: number,
  words: number,
  locale: string,
): string {
  const format = (value: number): string => {
    try {
      return new Intl.NumberFormat(locale).format(value);
    } catch {
      return String(value);
    }
  };
  return template.replace('{{turns}}', format(turns)).replace('{{words}}', format(words));
}
