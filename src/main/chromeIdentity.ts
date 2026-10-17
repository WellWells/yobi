import { app } from 'electron';
import type { WebContents } from 'electron';
import { chromeBrandList, platformHint, type UserAgentBrand } from '../shared/clientHintBrands';
import { claimsGeminiApp } from '../shared/userAgentPersona';

/*
 * The whole Google Chrome identity of a window on a site the user signs in to: the string, the
 * brands, the high-entropy values and the languages, set together through the DevTools protocol so
 * the page's script and its requests describe one browser. `setUserAgent` alone changes only the
 * string.
 */

export interface NativeUaData {
  architecture: string;
  bitness: string;
  platformVersion: string;
  wow64: boolean;
}

/** The protocol's `Emulation.UserAgentMetadata`. */
export interface UserAgentMetadata {
  brands: UserAgentBrand[];
  fullVersionList: UserAgentBrand[];
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
  formFactors: string[];
}

export interface ChromeIdentity {
  userAgent: string;
  /** Plain tags, e.g. `zh-TW,zh,en-US,en`; Chromium adds the q-values itself. */
  acceptLanguages: string;
  /** What this machine's Chromium reports; null when it could not be read. */
  native: NativeUaData | null;
}

const NATIVE_HINTS = ['architecture', 'bitness', 'platformVersion', 'wow64'] as const;

/**
 * Chrome's own Accept-Language list for the system languages: each language, then its base
 * language (`zh-TW,zh,en-US,en`). Script subtags are dropped (`zh-Hant-TW` is `zh-TW`).
 */
export function chromeAcceptLanguages(preferred: readonly string[]): string {
  const tags: string[] = [];
  const add = (tag: string): void => {
    if (!tags.includes(tag)) tags.push(tag);
  };
  for (const raw of preferred) {
    const parts = raw.replace(/_/g, '-').split('-').filter(Boolean);
    const language = parts[0]?.toLowerCase() ?? '';
    if (!/^[a-z]{2,3}$/.test(language)) continue;
    const region = parts.slice(1).find((part) => /^([a-z]{2}|\d{3})$/i.test(part));
    add(region ? `${language}-${region.toUpperCase()}` : language);
    add(language);
  }
  return tags.length > 0 ? tags.join(',') : 'en-US,en';
}

export function systemAcceptLanguages(): string {
  return chromeAcceptLanguages(app.getPreferredSystemLanguages());
}

/**
 * Google Chrome's metadata for a Chrome user agent on this machine; null for any other persona
 * (the Gemini app's identity carries no Chrome brand, a Firefox one has no metadata at all).
 */
export function chromeUserAgentMetadata(
  userAgent: string,
  native: NativeUaData,
  platform: NodeJS.Platform = process.platform,
): UserAgentMetadata | null {
  const full = /Chrome\/(\d+\.\d+\.\d+\.\d+)/.exec(userAgent)?.[1];
  if (!full || claimsGeminiApp(userAgent) || /Firefox\//.test(userAgent)) return null;
  return {
    brands: chromeBrandList(full.split('.')[0]),
    fullVersionList: chromeBrandList(full),
    platform: platformHint(platform),
    platformVersion: native.platformVersion,
    architecture: native.architecture,
    model: '',
    mobile: false,
    bitness: native.bitness,
    wow64: native.wow64,
    formFactors: ['Desktop'],
  };
}

function toNativeUaData(value: unknown): NativeUaData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const { architecture, bitness, platformVersion, wow64 } = data;
  if (typeof architecture !== 'string' || typeof bitness !== 'string' || typeof platformVersion !== 'string') return null;
  return { architecture, bitness, platformVersion, wow64: wow64 === true };
}

let nativeUaData: NativeUaData | null = null;

/**
 * This machine's high-entropy values, read once from a page of Yobi's own: only a secure context
 * has `navigator.userAgentData`, and the window about to open a site is still on `about:blank`,
 * which is not one. A failed read is tried again next time.
 */
export async function readNativeUaData(source: WebContents | null | undefined): Promise<NativeUaData | null> {
  if (nativeUaData) return nativeUaData;
  if (!source || source.isDestroyed()) return null;
  const value: unknown = await source
    .executeJavaScript(`navigator.userAgentData ? navigator.userAgentData.getHighEntropyValues(${JSON.stringify(NATIVE_HINTS)}) : null`)
    .catch(() => null);
  nativeUaData = toNativeUaData(value);
  return nativeUaData;
}

export function resetNativeUaData(): void {
  nativeUaData = null;
}

/**
 * Gives `wc` the identity before its first load. False when only the user agent string could be
 * set (no metadata for this persona, or the machine's values unread); a protocol failure throws.
 */
export async function applyChromeIdentity(wc: WebContents, identity: ChromeIdentity): Promise<boolean> {
  wc.setUserAgent(identity.userAgent);
  const metadata = identity.native ? chromeUserAgentMetadata(identity.userAgent, identity.native) : null;
  if (!metadata) return false;
  // A window that never loaded a page has no renderer to answer the protocol.
  if (!wc.getURL()) await wc.loadURL('about:blank');
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
    userAgent: identity.userAgent,
    acceptLanguage: identity.acceptLanguages,
    userAgentMetadata: metadata,
  });
  return true;
}
