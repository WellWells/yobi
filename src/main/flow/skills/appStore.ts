import { config as appConfig } from '../../config';
import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { fetchRawResponse } from '../../pageLoader';
import { userAgentForUrl } from '../../userAgent';
import { parseAppStoreUrl } from '../../../shared/linkSites/appStoreLinks';
import { parsePlayUrl, playAppUrl } from '../../../shared/linkSites/playLinks';
import { FlowUserError } from '../userError';
import { appStoreCard, purchaseLines } from './appStorePosts';
import type { AppStoreApp } from './appStorePosts';
import { readAppStoreApp } from './appStoreReader';
import { arr, num, obj, str } from './jsonPick';
import { playCard, playSearchHits } from './playPosts';
import type { PlayApp, PlayLabels, PlaySearchHit } from './playPosts';
import { readPlayApp } from './playReader';
import { envelope } from './skillFetch';
import { NAVIGATION_HEADERS, stayOnHosts } from './siteFetch';
import { currentStorefront, playLabels, playLanguageFor, storefrontOf } from './storeRegion';
import type { XRead } from './xReader';

export { defaultStorefrontFor, storefrontOf } from './storeRegion';

/*
 * The app store step (`app_store`): one app's card in one store and country — what it is, who makes
 * it, the download price and its in-app purchases — from a link or from the app's name. Apple's
 * card lists every in-app purchase with its price; Google Play's shows only their range (no source
 * has the items, see playPosts.ts), with ads and installs. A name is looked up with the store's own
 * public search (Apple: `itunes.apple.com/search`, no key; Google Play: the search page) and the
 * first hit's page is read, as a pasted link is.
 *
 * It is also an /agent tool, where the user asks in their own words ("surge 5 內購多少", "那個測網速
 * 的 app"): a search can land on another app with a similar name, so the step's text always carries
 * the app's link, and when the found name does not hold the asked words it opens by saying so and
 * asks the user to check it is the app they meant.
 */

const ITUNES_HOST = 'itunes.apple.com';
const PLAY_HOST = 'play.google.com';
const SEARCH_LIMIT = 5;
/** The description in the step's text: the opening, enough to say what the app does. */
const DESCRIPTION_MAX_CHARS = 1_500;
const stayOnItunes = stayOnHosts('App Store search', (host) => host === ITUNES_HOST);
const stayOnPlay = stayOnHosts('Google Play search', (host) => host === PLAY_HOST);

export type AppStoreName = 'appstore' | 'googleplay';

export interface AppSearchHit {
  id: string;
  name: string;
  developer: string;
  /** The app's page in the searched country, without tracking parameters. */
  link: string;
}

export interface AppStoreStepDeps {
  search(term: string, storefront: string, signal?: AbortSignal): Promise<AppSearchHit[]>;
  read(url: string, id: string, signal?: AbortSignal): Promise<XRead<AppStoreApp>>;
  searchPlay(term: string, region: string, signal?: AbortSignal): Promise<AppSearchHit[]>;
  readPlay(id: string, region: string, signal?: AbortSignal): Promise<XRead<PlayApp>>;
  playLabels: PlayLabels;
  /** The country when neither the field nor the link names one. */
  defaultStorefront(): string;
  others: (count: number) => string;
  /** The note that opens the text when the found app's name does not hold the asked words. */
  unsure: (vars: { query: string; name: string; link: string }) => string;
  log(line: string): void;
}

/** Apple's search results as hits; anything that is not an app with a page is left out. */
export function searchHits(body: unknown): AppSearchHit[] {
  return arr(obj(body)?.results).flatMap((value) => {
    const item = obj(value);
    const id = num(item?.trackId);
    const parsed = parseAppStoreUrl(str(item?.trackViewUrl));
    if (!id || !parsed) return [];
    return [{ id: String(id), name: str(item?.trackName), developer: str(item?.sellerName), link: str(item?.trackViewUrl).replace(/\?.*$/, '') }];
  });
}

/** Letters and digits only, lower case, for comparing names across punctuation and spacing. */
function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Whether a found app's name holds what was asked: the whole query, or every word of it (Latin
 * words, numbers, and CJK runs alike). "surge 5" ↔ "Surge 5", "notion" ↔ "Notion: Notes, Docs",
 * "速度測試" ↔ "Speedtest - 速度測試" hold; "surge" ↔ "Surfshark VPN" does not.
 */
export function nameHolds(query: string, name: string): boolean {
  const whole = fold(query);
  const found = fold(name);
  if (!whole || !found) return false;
  if (found.includes(whole)) return true;
  const words = query.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length > 0 && words.every((word) => found.includes(word));
}

function opening(description: string): string {
  return description.length > DESCRIPTION_MAX_CHARS
    ? `${description.slice(0, DESCRIPTION_MAX_CHARS).trimEnd()}…`
    : description;
}

function stepText(parts: { unsure: string; card: string; link: string; facts: string; description: string }, others: AppSearchHit[], othersLabel: string): string {
  const alsoFound = others.length > 0
    ? [othersLabel, ...others.map((hit) => `- ${hit.name || hit.id}${hit.developer ? ` · ${hit.developer}` : ''} ${hit.link}`)].join('\n')
    : '';
  return [parts.unsure, parts.card, parts.link, parts.facts, opening(parts.description), alsoFound].filter(Boolean).join('\n\n');
}

/** Which store a step reads: a link names its own; else the field; else the App Store. */
function storeOf(config: Record<string, string>, query: string): AppStoreName {
  if (parsePlayUrl(query)) return 'googleplay';
  if (parseAppStoreUrl(query)) return 'appstore';
  return /^(?:google\s*play|googleplay|play|android)$/i.test((config.store ?? '').trim()) ? 'googleplay' : 'appstore';
}

function noMatch(query: string, store: string, region: string): FlowUserError {
  const where = `${store} ${region.toUpperCase()}`;
  return new FlowUserError('flow.error.appStoreNoMatch', { query, store: where }, `${store}: no app matches "${query}" in ${region.toUpperCase()}.`);
}

function unreadable(store: string, region: string, status: number, url: string): FlowUserError {
  if (status === 404) {
    const where = `${store} ${region.toUpperCase()}`;
    return new FlowUserError('flow.error.appStoreNotSold', { store: where, url }, `${store}: the app is not offered in ${region.toUpperCase()}: ${url}`);
  }
  return new FlowUserError('flow.error.xPageUnreadable', { url }, `${store}: the page held no app (HTTP ${status}): ${url}`);
}

async function runApple(query: string, chosen: string, deps: AppStoreStepDeps, signal?: AbortSignal): Promise<string> {
  const link = parseAppStoreUrl(query);
  const storefront = chosen || link?.storefront || deps.defaultStorefront();
  let id = link?.id ?? '';
  let others: AppSearchHit[] = [];
  if (!link) {
    const hits = await deps.search(query, storefront, signal);
    deps.log(`🍎 [App Store] "${query}" in ${storefront.toUpperCase()}: ${hits.length} match(es)`);
    if (hits.length === 0) throw noMatch(query, 'App Store', storefront);
    id = hits[0].id;
    others = hits.slice(1);
  }
  const url = `https://apps.apple.com/${storefront}/app/id${id}`;
  const { status, value } = await deps.read(url, id, signal);
  if (!value) throw unreadable('App Store', storefront, status, url);
  const matched = Boolean(link) || nameHolds(query, value.title);
  deps.log(`🍎 [App Store] ${value.title} (${value.storefront}): ${value.price || 'no price'}, ${value.purchases?.items.length ?? 0} in-app purchase(s)${matched ? '' : ', name differs from the query'}`);
  const card = appStoreCard(value);
  return envelope(stepText({
    unsure: matched ? '' : deps.unsure({ query, name: value.title, link: value.link }),
    card,
    link: value.link,
    facts: value.facts,
    description: value.description,
  }, others, deps.others(others.length)), {
    text: card,
    store: 'appstore',
    name: value.title,
    developer: value.developer,
    price: value.price,
    inAppPurchases: value.purchases ? '1' : '0',
    purchases: purchaseLines(value),
    version: value.version,
    whatsNew: value.whatsNew,
    storefront: value.storefront,
    link: value.link,
    icon: value.icon,
    matched: matched ? '1' : '0',
    matches: JSON.stringify(others.map(({ name, developer, link: url }) => ({ name, developer, link: url }))),
  });
}

async function runPlay(query: string, chosen: string, deps: AppStoreStepDeps, signal?: AbortSignal): Promise<string> {
  const link = parsePlayUrl(query);
  const region = chosen || link?.region || deps.defaultStorefront();
  let id = link?.id ?? '';
  let others: AppSearchHit[] = [];
  if (!link) {
    const hits = await deps.searchPlay(query, region, signal);
    deps.log(`▶️ [Google Play] "${query}" in ${region.toUpperCase()}: ${hits.length} match(es)`);
    if (hits.length === 0) throw noMatch(query, 'Google Play', region);
    id = hits[0].id;
    others = hits.slice(1);
  }
  const { status, value } = await deps.readPlay(id, region, signal);
  if (!value) throw unreadable('Google Play', region, status, playAppUrl(id, region));
  const matched = Boolean(link) || nameHolds(query, value.title);
  deps.log(`▶️ [Google Play] ${value.title} (${value.region}): ${value.price}, ${value.purchases || 'no in-app purchases'}${matched ? '' : ', name differs from the query'}`);
  const card = playCard(value, deps.playLabels);
  return envelope(stepText({
    unsure: matched ? '' : deps.unsure({ query, name: value.title, link: value.link }),
    card,
    link: value.link,
    facts: value.facts,
    description: value.description,
  }, others, deps.others(others.length)), {
    text: card,
    store: 'googleplay',
    name: value.title,
    developer: value.developer,
    price: value.price,
    inAppPurchases: value.purchases ? '1' : '0',
    purchases: value.purchases,
    version: value.version,
    whatsNew: value.whatsNew,
    storefront: value.region,
    link: value.link,
    icon: value.icon,
    matched: matched ? '1' : '0',
    matches: JSON.stringify(others.map(({ name, developer, link: url }) => ({ name, developer, link: url }))),
  });
}

/**
 * What `/agent` reads under each `app_store` result (a flow's text stays as it is). Without it a
 * live BYOK run answered "Android Minecraft" with the App Store read it got (no store field) as if
 * it were Google Play's, and two of two answers dropped the link the user needs to confirm the app.
 */
export function appStoreAgentRules(fields: Record<string, string>): string {
  if (!fields.link) return '';
  const play = fields.store === 'googleplay';
  const rules = [
    `OUTPUT RULES (critical): this is the ${play ? 'Google Play (Android)' : 'App Store (iPhone, iPad, Mac)'} listing.`,
    `Name the app and its store, and give this link so the user can check it is the app they meant: ${fields.link}`,
  ];
  if (fields.matched === '0') rules.push('The name found is not the one asked: ask whether this is the right app.');
  rules.push(`For ${play ? 'iPhone or iPad' : 'Android'} call again with store "${play ? 'appstore' : 'googleplay'}"; never give one store's prices as the other's.`);
  return rules.join(' ');
}

export async function runAppStoreStep(config: Record<string, string>, deps: AppStoreStepDeps, signal?: AbortSignal): Promise<string> {
  const query = (config.query ?? '').trim();
  if (!query) throw new FlowUserError('flow.error.requiredAppStoreQuery', {}, 'App Store: no app name or link to look up.');
  const chosen = storefrontOf(config.country ?? '');
  return storeOf(config, query) === 'googleplay'
    ? runPlay(query, chosen, deps, signal)
    : runApple(query, chosen, deps, signal);
}

async function searchAppStore(term: string, storefront: string, signal?: AbortSignal): Promise<AppSearchHit[]> {
  const url = `https://${ITUNES_HOST}/search?${new URLSearchParams({ term, country: storefront, entity: 'software', limit: String(SEARCH_LIMIT) })}`;
  const { status, text } = await fetchRawResponse(url, { headers: { Accept: 'application/json' }, validateRedirectHost: stayOnItunes, signal });
  if (status >= 400) throw new Error(`App Store search answered HTTP ${status}`);
  return searchHits(JSON.parse(text) as unknown);
}

async function searchGooglePlay(term: string, region: string, signal?: AbortSignal): Promise<AppSearchHit[]> {
  const params = new URLSearchParams({ q: term, c: 'apps', hl: playLanguageFor(appConfig.locale || 'en-US'), gl: region.toUpperCase() });
  const url = `https://${PLAY_HOST}/store/search?${params}`;
  const { status, text } = await fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnPlay,
    signal,
  });
  if (status >= 400) throw new Error(`Google Play search answered HTTP ${status}`);
  return playSearchHits(text, SEARCH_LIMIT).map((hit: PlaySearchHit) => ({ ...hit, link: playAppUrl(hit.id, region) }));
}

export function execAppStore(config: Record<string, string>, signal?: AbortSignal): Promise<string> {
  const strings = getLangCache();
  return runAppStoreStep(config, {
    search: searchAppStore,
    read: readAppStoreApp,
    searchPlay: searchGooglePlay,
    readPlay: readPlayApp,
    playLabels: playLabels(),
    defaultStorefront: currentStorefront,
    others: (count) => t(strings, 'flow.appStore.others', { count: String(count) }),
    unsure: (vars) => t(strings, 'flow.appStore.unsure', vars),
    log: sendLog,
  }, signal);
}
