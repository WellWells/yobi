import type { OnBeforeRequestListenerDetails, Session } from 'electron';
import { isBlockedHost } from './requestBlocklist';
import { createPublicRequestCheck } from './net/publicWebScope';

type ResourceType = OnBeforeRequestListenerDetails['resourceType'];

export interface RequestFacts {
  url: string;
  resourceType: ResourceType;
  webContentsId?: number;
  /** URL of the top-level document that issued the request; empty when unknown. */
  topUrl: string;
}

export interface RequestDecision {
  block: boolean;
  reason?: 'headless-resource' | 'tracker' | 'cookie-sync';
}

// What a headless text-extraction window never needs. Frames are where cookie-sync storms
// live and what holds the load event hostage; the rest is bytes no LLM will ever see.
// Scripts, stylesheets and xhr stay so JS-rendered articles still appear.
const HEADLESS_CUT: ReadonlySet<ResourceType> = new Set<ResourceType>([
  'subFrame', 'image', 'font', 'media', 'object', 'ping', 'cspReport',
]);

// Cookie-sync endpoints share a tiny vocabulary regardless of which SSP hosts them.
const COOKIE_SYNC_PATH = /(?:^|\/)(?:getuid|setuid|usersync|user[_-]sync|cookie[_-]?sync|csync|isync|idsync|cksync|pixel[_-]?sync)(?=[/?.]|$)/i;

// Two-label public suffixes that make "last two labels" the wrong registrable domain.
const SECOND_LEVEL_SUFFIXES = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'go', 'ne', 'or']);

const headlessContents = new Set<number>();

export function markHeadless(webContentsId: number): void {
  headlessContents.add(webContentsId);
}

export function unmarkHeadless(webContentsId: number): void {
  headlessContents.delete(webContentsId);
}

export function isHeadless(webContentsId: number): boolean {
  return headlessContents.has(webContentsId);
}

interface PublicOnlyWindow {
  allows: (url: string) => Promise<boolean>;
  /** Told when the page itself (not one of its resources) was refused, so the load fails at once. */
  onRefused: (url: string) => void;
}

const publicOnlyContents = new Map<number, PublicOnlyWindow>();

/** A window loaded for a bot message: every request it makes must go to a public address. */
export function guardPublicOnly(webContentsId: number, onRefused: (url: string) => void): void {
  publicOnlyContents.set(webContentsId, { allows: createPublicRequestCheck(), onRefused });
}

export function unguardPublicOnly(webContentsId: number): void {
  publicOnlyContents.delete(webContentsId);
}

/**
 * Whether to cancel a request of a `guardPublicOnly` window (false for any other window). A
 * request with no webContents (a service worker's) cannot be told apart and is not checked.
 */
export async function decidePublicOnly(facts: Omit<RequestFacts, 'topUrl'>): Promise<boolean> {
  const guarded = facts.webContentsId === undefined ? undefined : publicOnlyContents.get(facts.webContentsId);
  if (!guarded) return false;
  if (await guarded.allows(facts.url)) return false;
  if (facts.resourceType === 'mainFrame') guarded.onRefused(facts.url);
  return true;
}

function parseHttp(url: string): { host: string; pathname: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return { host: parsed.hostname.toLowerCase(), pathname: parsed.pathname };
}

function registrableDomain(host: string): string {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL_SUFFIXES.has(sld) ? 3 : 2;
  return labels.slice(-take).join('.');
}

export function decideRequest(facts: RequestFacts): RequestDecision {
  if (facts.resourceType === 'mainFrame') return { block: false };
  const target = parseHttp(facts.url);
  if (!target) return { block: false };

  const headless = facts.webContentsId !== undefined && headlessContents.has(facts.webContentsId);
  if (headless && HEADLESS_CUT.has(facts.resourceType)) return { block: true, reason: 'headless-resource' };

  const top = parseHttp(facts.topUrl);
  if (top && registrableDomain(top.host) === registrableDomain(target.host)) return { block: false };

  if (isBlockedHost(target.host)) return { block: true, reason: 'tracker' };
  if (COOKIE_SYNC_PATH.test(target.pathname)) return { block: true, reason: 'cookie-sync' };
  return { block: false };
}

function topLevelUrl(details: OnBeforeRequestListenerDetails): string {
  try {
    const url = details.webContents?.getURL();
    if (url) return url;
  } catch {
    // The webContents can be torn down while its last requests are still in flight.
  }
  return details.referrer ?? '';
}

/** One listener per session: Electron keeps only the last onBeforeRequest handler. */
export function installRequestFilter(target: Session): void {
  target.webRequest.onBeforeRequest((details, callback) => {
    const decision = decideRequest({
      url: details.url,
      resourceType: details.resourceType,
      webContentsId: details.webContentsId,
      topUrl: topLevelUrl(details),
    });
    const id = details.webContentsId;
    if (decision.block || id === undefined || !publicOnlyContents.has(id)) {
      callback({ cancel: decision.block });
      return;
    }
    void decidePublicOnly({ url: details.url, resourceType: details.resourceType, webContentsId: id })
      .then((block) => callback({ cancel: block }), () => callback({ cancel: true }));
  });
}
