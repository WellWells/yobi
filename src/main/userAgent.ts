// src/main/userAgent.ts — Browser identity used for remote provider pages.

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
  const chromeVersion = process.versions.chrome;
  return `Mozilla/5.0 (${getPlatformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

export const CLEAN_UA = buildCleanChromiumUserAgent();
