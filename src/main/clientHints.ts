import type { Session, WebContents } from 'electron';
import { FIREFOX_UA } from './userAgent';

const SEC_CH_UA_HEADER = /^sec-ch-ua/i;

export function applyWorkerUserAgent(wc: WebContents, userAgent: string): void {
  wc.setUserAgent(userAgent);
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
    if (userAgent === FIREFOX_UA) {
      for (const key of Object.keys(requestHeaders)) {
        if (SEC_CH_UA_HEADER.test(key)) delete requestHeaders[key];
      }
    }
    callback({ requestHeaders });
  });
}
