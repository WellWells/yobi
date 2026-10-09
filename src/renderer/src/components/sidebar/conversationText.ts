import { stripConversationMarkers } from '../../../../shared/conversationDoc';

/** The conversation as a reader sees it: the file minus Yobi's hidden marker lines. */
export function conversationPlainMarkdown(raw: string): string {
  return stripConversationMarkers(raw).replace(/\n{3,}/g, '\n\n').trim();
}
