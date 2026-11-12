import type { SkillType } from './types';

/**
 * Skills whose `emitFailFlag` turns a throw into `{{key.isFailed}}`="1" and sets "0" on success.
 * One list for the executor and the editor's Insert data menu: a skill in only one of them either
 * leaves `.isFailed` unset on success or hides a flag the run really sets.
 */
export const FAIL_SOFT_SKILLS: ReadonlySet<SkillType> = new Set<SkillType>([
  'llm', 'browser', 'browser_js', 'bot', 'research', 'share', 'x_thread', 'x_media', 'youtube_download', 'mcp', 'calendar', 'mail_fetch', 'translate',
]);
