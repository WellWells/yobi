/**
 * What the X connector's tool descriptions cannot say on their own. Its tools need no contract
 * table: all of them are read-only and say so in their annotations.
 */
export const X_NOTES = [
  'X NOTES:',
  '- Cite every post you mention with its link, as a Markdown link. A handle alone cannot be checked.',
  '- x_search and x_post_replies return a sample (about 20 posts; the replies X ranks first). Present it as such, never as everything said.',
].join('\n');
