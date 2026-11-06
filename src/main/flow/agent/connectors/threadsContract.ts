/**
 * What the Threads connector's tool description cannot say on its own. Its tool needs no
 * contract table: it is read-only and says so in its annotations.
 */
export const THREADS_NOTES = [
  'THREADS NOTES:',
  '- Cite every post you mention with its link, as a Markdown link.',
  '- threads_post returns only the first direct replies the post page shows: a sample of a busy post, never every reply.',
  '- You see the post text and replies as text, not the photos or videos themselves; never describe what a picture shows.',
].join('\n');
