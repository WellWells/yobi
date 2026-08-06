/**
 * Fencing for the spans of a prompt that the prompt did not write: web page text, tool
 * observations, replayed conversation.
 *
 * Every published system prompt from Anthropic, OpenAI, Google and Perplexity delimits
 * exactly this kind of content with a named tag — `<genui_search_tool_results>`,
 * `<example_user_memories>`, `<user_background>`, `<context>` — while leaving the
 * instruction prose as headers and bullets. The tag is what tells the model where its own
 * instructions stop and someone else's text begins.
 *
 * A tag alone is not a security boundary: text inside a fence can close it and keep writing.
 * `fenceUntrusted` therefore neutralizes the one sequence that would end the fence early. It
 * is deliberately narrow — only this prompt's own closing tag, with a space inserted rather
 * than the content rewritten — because mangling a page to defend against a rare forgery
 * costs more answers than the forgery does.
 */
export function fenceUntrusted(tag: string, body: string): string {
  return [`<${tag}>`, sealClosingTag(tag, body), `</${tag}>`].join('\n');
}

/** Exported for the test suite. */
export function sealClosingTag(tag: string, body: string): string {
  return body.replace(new RegExp(`</\\s*${tag}\\s*>`, 'gi'), `< /${tag}>`);
}
