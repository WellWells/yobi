import type { Session, WebContents, WebFrameMain } from 'electron';
import {
  buildChromeBrands,
  formatBrandList,
  parseBrandList,
  platformHint,
  withChromeBrand,
} from '../shared/clientHintBrands';
import { claimsFirefox, claimsGeminiApp } from '../shared/userAgentPersona';
import { requestUserAgent } from './userAgent';
import type { RequestSource } from './userAgent';
import { followDestinationIdentity, windowFollowsIdentity } from './navigationIdentity';

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
  if (claimsGeminiApp(userAgent)) return requestHeaders;
  const chromeVersion = /Chrome\/([\d.]+)/.exec(userAgent)?.[1];
  const secure = url.startsWith('https:');
  if (claimsFirefox(userAgent) || !chromeVersion || !secure) {
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

export function harmonizeRequestIdentity(
  requestHeaders: Record<string, string>,
  url: string,
  source: RequestSource,
): Record<string, string> {
  const key = findHeaderKey(requestHeaders, 'user-agent');
  const sent = key ? String(requestHeaders[key] ?? '') : '';
  const userAgent = key ? requestUserAgent(sent, url, source) : sent;
  if (key && userAgent !== sent) requestHeaders[key] = userAgent;
  return harmonizeClientHintHeaders(requestHeaders, userAgent, url);
}

function frameOrigin(frame: WebFrameMain | null | undefined): string | null {
  try {
    return frame?.origin ?? null;
  } catch {
    return null;
  }
}

export function registerWorkerClientHints(ses: Session): void {
  followDestinationIdentity(ses);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const wc = details.webContents;
    const navigates = details.resourceType === 'mainFrame' && wc && windowFollowsIdentity(wc);
    const source: RequestSource = {
      resourceType: details.resourceType,
      frameOrigin: frameOrigin(details.frame),
      windowUserAgent: navigates ? wc.getUserAgent() : null,
    };
    callback({ requestHeaders: harmonizeRequestIdentity(details.requestHeaders, details.url, source) });
  });
}
