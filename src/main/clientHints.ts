import type { Session, WebContents } from 'electron';
import {
  buildChromeBrands,
  formatBrandList,
  parseBrandList,
  platformHint,
  withChromeBrand,
} from '../shared/clientHintBrands';

const SEC_CH_UA_PREFIX = 'sec-ch-ua';

const BRAND_LIST_HEADERS = new Set(['sec-ch-ua', 'sec-ch-ua-full-version-list']);

export function applyWorkerUserAgent(wc: WebContents, userAgent: string): void {
  wc.setUserAgent(userAgent);
}

function findHeaderKey(requestHeaders: Record<string, string>, name: string): string | undefined {
  return Object.keys(requestHeaders).find((key) => key.toLowerCase() === name);
}

function stripClientHints(requestHeaders: Record<string, string>): void {
  for (const key of Object.keys(requestHeaders)) {
    if (key.toLowerCase().startsWith(SEC_CH_UA_PREFIX)) delete requestHeaders[key];
  }
}

export function harmonizeClientHintHeaders(
  requestHeaders: Record<string, string>,
  userAgent: string,
  url = 'https://',
): Record<string, string> {
  const chromeVersion = /Chrome\/([\d.]+)/.exec(userAgent)?.[1];
  const secure = url.startsWith('https:');
  if (/Firefox\//.test(userAgent) || !chromeVersion || !secure) {
    stripClientHints(requestHeaders);
    return requestHeaders;
  }

  for (const key of Object.keys(requestHeaders)) {
    const name = key.toLowerCase();
    if (!BRAND_LIST_HEADERS.has(name)) continue;
    requestHeaders[key] = formatBrandList(withChromeBrand(parseBrandList(requestHeaders[key])));
  }

  if (!findHeaderKey(requestHeaders, 'sec-ch-ua')) {
    requestHeaders['sec-ch-ua'] = formatBrandList(buildChromeBrands(chromeVersion));
  }
  if (!findHeaderKey(requestHeaders, 'sec-ch-ua-mobile')) requestHeaders['sec-ch-ua-mobile'] = '?0';
  if (!findHeaderKey(requestHeaders, 'sec-ch-ua-platform')) {
    requestHeaders['sec-ch-ua-platform'] = `"${platformHint(process.platform)}"`;
  }
  return requestHeaders;
}

export function registerWorkerClientHints(ses: Session): void {
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = details.requestHeaders;
    let userAgent = '';
    for (const [key, value] of Object.entries(requestHeaders)) {
      if (key.toLowerCase() === 'user-agent') {
        userAgent = String(value ?? '');
        break;
      }
    }
    callback({ requestHeaders: harmonizeClientHintHeaders(requestHeaders, userAgent, details.url) });
  });
}
