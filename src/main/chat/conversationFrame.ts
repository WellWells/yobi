export const ROLE_USER = 'User';
export const ROLE_ASSISTANT = 'Assistant';

export const TAG_HISTORY = 'conversation_history';
export const TAG_CURRENT = 'current_message';
export const TAG_SUMMARY = 'summary_of_earlier_messages';

export function formatExchange(prompt: string, response: string): string {
  return `${ROLE_USER}: ${prompt.trim()}\n\n${ROLE_ASSISTANT}: ${response.trim()}`;
}

export function wrapTag(tag: string, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`;
}
