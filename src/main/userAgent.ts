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
