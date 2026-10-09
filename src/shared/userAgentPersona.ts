const GEMINI_APP_VERSION = '1.13.1';

const GEMINI_APP_TOKEN = 'GeminiWindowsApp/';

export function buildGeminiAppUserAgent(chromeVersion: string): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) gemini/${GEMINI_APP_VERSION} Chrome/${chromeVersion} Safari/537.36 ${GEMINI_APP_TOKEN}${GEMINI_APP_VERSION}`;
}

export function claimsGeminiApp(userAgent: string): boolean {
  return userAgent.includes(GEMINI_APP_TOKEN);
}

export function claimsFirefox(userAgent: string): boolean {
  return /Firefox\//.test(userAgent);
}

const GOOGLE_SEARCH_DOMAIN = /(^|\.)google\.(com?\.[a-z]{2}|[a-z]{2,3})$/;

const GOOGLE_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'ytimg.com',
  'ggpht.com',
  'googlevideo.com',
  'gstatic.com',
  'googleapis.com',
  'googleusercontent.com',
  'recaptcha.net',
  'goo.gl',
  'google-analytics.com',
  'googletagmanager.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
] as const;

export function isGoogleHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (GOOGLE_SEARCH_DOMAIN.test(host)) return true;
  return GOOGLE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function isGoogleUrl(url: string): boolean {
  try {
    return isGoogleHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
