/**
 * What the Facebook connector's tool description cannot say on its own. Its tool needs no
 * contract table: it is read-only and says so in its annotations.
 */
export const FACEBOOK_NOTES = [
  'FACEBOOK NOTES:',
  '- Cite every post you mention with its link, as a Markdown link.',
  '- facebook_post returns at most 40 comments: a sample of a busy post, never every comment.',
  '- You see the post text and comments as text, not the photos or videos themselves; never describe what a picture shows.',
].join('\n');
