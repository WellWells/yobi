/**
 * What the bilibili connector's tool description cannot say on its own. Its tool needs no
 * contract table: it is read-only and says so in its annotations.
 */
export const BILIBILI_NOTES = [
  'BILIBILI NOTES:',
  '- Cite every video you mention with its link, as a Markdown link.',
  '- What a video says comes only from its subtitles; with subtitles null, say the video\'s words could not be read (subtitles_note says why) and never guess them from the title.',
].join('\n');
