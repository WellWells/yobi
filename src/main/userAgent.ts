import type { Provider } from '../shared/types';
import { buildGeminiAppUserAgent, isGoogleUrl } from '../shared/userAgentPersona';

function getPlatformToken(): string {
  if (process.platform === 'darwin') {
    return 'Macintosh; Intel Mac OS X 10_15_7';
  }
  if (process.platform === 'linux') {
    return 'X11; Linux x86_64';
  }
  return 'Windows NT 10.0; Win64; x64';
}

export function buildCleanChromiumUserAgent(): string {
  const chromeVersion = process.versions.chrome ?? '140.0.0.0';
  return `Mozilla/5.0 (${getPlatformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function buildFirefoxUserAgent(): string {
  const ffPlatform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10.15'
    : process.platform === 'linux'
      ? 'X11; Linux x86_64'
      : 'Windows NT 10.0; Win64; x64';
  return `Mozilla/5.0 (${ffPlatform}; rv:152.0) Gecko/20100101 Firefox/152.0`;
}

export const CLEAN_UA = buildCleanChromiumUserAgent();

export const FIREFOX_UA = buildFirefoxUserAgent();

export const GEMINI_APP_UA = buildGeminiAppUserAgent(process.versions.chrome ?? '140.0.0.0');

export const GOOGLE_UA: string | null = process.platform === 'win32' ? GEMINI_APP_UA : null;

export const WORKER_USER_AGENTS: Record<Provider, string> = {
  gemini: GOOGLE_UA ?? FIREFOX_UA,
  chatgpt: CLEAN_UA,
  claude: CLEAN_UA,
  perplexity: CLEAN_UA,
};

export function userAgentForUrl(url: string): string {
  return GOOGLE_UA && isGoogleUrl(url) ? GOOGLE_UA : CLEAN_UA;
}

export function documentUserAgent(
  current: string,
  url: string,
  googleUserAgent: string | null = GOOGLE_UA,
): string {
  if (!googleUserAgent) return current;
  if (isGoogleUrl(url)) return googleUserAgent;
  return current === googleUserAgent ? CLEAN_UA : current;
}

export interface RequestSource {
  resourceType: string;
  frameOrigin: string | null;
  windowUserAgent: string | null;
}

export function requestUserAgent(
  current: string,
  url: string,
  source: RequestSource,
  googleUserAgent: string | null = GOOGLE_UA,
): string {
  if (!googleUserAgent || source.resourceType === 'subFrame') return current;
  if (source.resourceType === 'mainFrame') return source.windowUserAgent || current;
  if (source.frameOrigin && isGoogleUrl(source.frameOrigin) && isGoogleUrl(url)) return current;
  return documentUserAgent(current, url, googleUserAgent);
}
