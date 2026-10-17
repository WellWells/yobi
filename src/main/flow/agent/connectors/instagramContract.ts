/**
 * What the Instagram connector's tool descriptions cannot say on their own. Its tools need no
 * contract table: both are read-only and say so in their annotations.
 */
export const INSTAGRAM_NOTES = [
  'INSTAGRAM NOTES:',
  '- Cite every post or story you mention with its link, as a Markdown link.',
  '- instagram_post returns the comments Instagram lists first: a sample, never every comment.',
  '- You see captions and comments as text, not the photos or videos themselves; never describe what a picture shows.',
].join('\n');
