/** Public pages of the Yobi repository that the app links to. */

export const GITHUB_REPO_URL = 'https://github.com/WellWells/yobi';
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;

/** The guide for writing a language pack; installed builds don't ship the repo's language/ folder. */
export const LANGUAGE_PACK_GUIDE_URL = `${GITHUB_REPO_URL}/blob/main/language/README.md`;

/**
 * The "How Yobi Works" section of each translated README. The anchor is GitHub's slug of the
 * heading (lowercased, punctuation dropped, spaces to hyphens), so rewording a heading breaks it.
 */
export const HOW_IT_WORKS_URLS: Readonly<Record<string, string>> = {
  'zh-TW': `${GITHUB_REPO_URL}/blob/main/README.zh-TW.md#yobi-怎麼運作`,
  'zh-CN': `${GITHUB_REPO_URL}/blob/main/README.zh-CN.md#yobi-如何工作`,
};
export const HOW_IT_WORKS_FALLBACK = `${GITHUB_REPO_URL}#how-yobi-works`;

export function howItWorksUrl(locale: string): string {
  return encodeURI(HOW_IT_WORKS_URLS[locale] ?? HOW_IT_WORKS_FALLBACK);
}
