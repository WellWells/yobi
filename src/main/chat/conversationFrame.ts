export const ROLE_USER = 'User';
export const ROLE_ASSISTANT = 'Assistant';

export const TAG_HISTORY = 'conversation_history';
export const TAG_CURRENT = 'current_message';
export const TAG_SUMMARY = 'summary_of_earlier_messages';

/** One exchange; a message that got no answer (a `!` command's output) stands alone. */
export function formatExchange(prompt: string, response: string): string {
  const user = `${ROLE_USER}: ${prompt.trim()}`;
  return response.trim() ? `${user}\n\n${ROLE_ASSISTANT}: ${response.trim()}` : user;
}

export function wrapTag(tag: string, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`;
}
