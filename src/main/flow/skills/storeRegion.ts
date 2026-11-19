import { app } from 'electron';
import { config } from '../../config';
import { getLangCache, t } from '../../i18n';
import { isTaiwanUser } from '../../userRegion';
import type { PlayLabels } from './playPosts';

/*
 * Which country's app store a read is for, and the words Google Play lays out without text. Prices,
 * in-app purchases and even whether an app is sold differ by store, so a link's own region wins,
 * then the user's.
 */

const STOREFRONT = /^[a-z]{2}$/;

/** A two-letter store region from a field ("TW", "jp"); "" for blank or anything else. */
export function storefrontOf(raw: string): string {
  const code = raw.trim().toLowerCase();
  return STOREFRONT.test(code) ? code : '';
}

/** Taiwan for a Taiwan user; else the system's first language's region ("ja-JP" → jp); else us. */
export function defaultStorefrontFor(systemLanguages: readonly string[], taiwan: boolean): string {
  if (taiwan) return 'tw';
  const region = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(systemLanguages[0] ?? '')?.[1] ?? '';
  return storefrontOf(region) || 'us';
}

export function currentStorefront(): string {
  const languages = app.getPreferredSystemLanguages();
  return defaultStorefrontFor(languages, isTaiwanUser(languages, config));
}

/** Google Play's `hl` for an interface language ("zh-TW" → zh_TW, "en-US" → en_US). */
export function playLanguageFor(locale: string): string {
  const [language, region] = locale.split(/[-_]/);
  if (!language) return 'en_US';
  return region ? `${language.toLowerCase()}_${region.toUpperCase()}` : language.toLowerCase();
}

/** The page address a Google Play read asks for: the user's language, the link's region or the user's. */
export function playReadUrl(id: string, region: string): string {
  const gl = (region || currentStorefront()).toUpperCase();
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=${playLanguageFor(config.locale || 'en-US')}&gl=${gl}`;
}

export function playLabels(): PlayLabels {
  const strings = getLangCache();
  return {
    free: t(strings, 'flow.play.free'),
    installs: (count) => t(strings, 'flow.play.installs', { count }),
    category: t(strings, 'flow.play.category'),
    contentRating: t(strings, 'flow.play.contentRating'),
    version: t(strings, 'flow.play.version'),
    updated: t(strings, 'flow.play.updated'),
    android: t(strings, 'flow.play.android'),
    whatsNew: t(strings, 'flow.play.whatsNew'),
  };
}
