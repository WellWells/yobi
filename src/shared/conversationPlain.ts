import { stripConversationMarkers } from './conversationDoc';
import { notionDocParts } from './notion/notionDoc';
import { notionToDisplay, plainNotionTitle, type NotionDisplayLabels } from './notion/notionDisplay';

/**
 * The conversation as a reader sees it: the file minus Yobi's hidden marker lines (which can hold a
 * whole pasted transcript in a turn's `sent`). What "copy full text" and the Markdown export give out.
 *
 * A Notion document is given out as it reads in Yobi when `notion` is passed: plain Markdown, not
 * Notion's own (its tags and split bold runs mean nothing to another editor).
 */
export function conversationPlainMarkdown(raw: string, notion?: NotionDisplayLabels): string {
  const doc = notion ? notionDocParts(raw) : null;
  if (doc && notion) {
    const body = notionToDisplay(doc.body, notion);
    return `# ${plainNotionTitle(doc.title)}${body ? `\n\n${body}` : ''}`.trim();
  }
  return stripConversationMarkers(raw).replace(/\n{3,}/g, '\n\n').trim();
}
