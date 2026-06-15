import { session } from 'electron';
import type { Cookie } from 'electron';
import { isExpiredCookie } from '../helpers';
import { CLEAN_UA, FIREFOX_UA } from '../userAgent';
import { CHATGPT_LOGIN_URL } from './chatgpt';
import { PROVIDER_URLS, AUTH_PROVIDERS } from '../../shared/types';
import type { AccountStatus, AuthProvider, Provider } from '../../shared/types';

const WORKER_PARTITION = 'persist:gemini';

interface AuthProviderConfig {
  loginUrl: string;
  userAgent: string;
  isSessionCookie: (cookie: Cookie) => boolean;
}

interface ProviderStorage {
  cookieUrls: string[];
  resetOrigins: string[];
}

// resetOrigins are wiped on account reset. clearData() removes cookies at the
// registrable-domain level per origin, so one Google/YouTube origin clears that
// whole domain's cookie jar — Gemini lists the connected Google surfaces so a reset
// makes the entire Google session (Gemini + Account + YouTube) look like a first visit.
const STORAGE_CONFIG: Record<Provider, ProviderStorage> = {
  chatgpt: {
    cookieUrls: ['https://chatgpt.com/', 'https://chat.openai.com/'],
    resetOrigins: [
      'https://chatgpt.com',
      'https://chat.openai.com',
      'https://auth.openai.com',
      'https://openai.com',
    ],
  },
  gemini: {
    cookieUrls: ['https://gemini.google.com/'],
    resetOrigins: [
      'https://gemini.google.com',
      'https://google.com',
      'https://www.google.com',
      'https://accounts.google.com',
      'https://myaccount.google.com',
      'https://youtube.com',
      'https://www.youtube.com',
      'https://m.youtube.com',
      'https://studio.youtube.com',
      'https://music.youtube.com',
    ],
  },
  perplexity: {
    cookieUrls: ['https://www.perplexity.ai/'],
    resetOrigins: ['https://www.perplexity.ai', 'https://perplexity.ai'],
  },
  duckai: {
    cookieUrls: ['https://duck.ai/'],
    resetOrigins: ['https://duck.ai', 'https://duckduckgo.com'],
  },
};

const GEMINI_SESSION_COOKIES = ['__Secure-1PSID', '__Secure-3PSID', 'SID'];

const AUTH_CONFIG: Record<AuthProvider, AuthProviderConfig> = {
  chatgpt: {
    loginUrl: CHATGPT_LOGIN_URL,
    userAgent: CLEAN_UA,
    isSessionCookie: (c) =>
      c.name.startsWith('__Secure-next-auth.session-token') && !isExpiredCookie(c.expirationDate),
  },
  gemini: {
    loginUrl: PROVIDER_URLS.gemini,
    userAgent: FIREFOX_UA,
    isSessionCookie: (c) =>
      GEMINI_SESSION_COOKIES.includes(c.name) && Boolean(c.value) && !isExpiredCookie(c.expirationDate),
  },
  perplexity: {
    loginUrl: PROVIDER_URLS.perplexity,
    userAgent: CLEAN_UA,
    isSessionCookie: (c) =>
      c.name.startsWith('__Secure-next-auth.session-token') && !isExpiredCookie(c.expirationDate),
  },
};

export function getAuthProviderConfig(provider: AuthProvider): AuthProviderConfig {
  return AUTH_CONFIG[provider];
}

function workerSession(): Electron.Session {
  return session.fromPartition(WORKER_PARTITION);
}

async function getCookiesForUrls(urls: string[]): Promise<Cookie[]> {
  const ses = workerSession();
  const results = await Promise.all(urls.map((url) => ses.cookies.get({ url })));
  return results.flat();
}

export async function getAccountStatus(provider: AuthProvider): Promise<boolean> {
  const cookies = await getCookiesForUrls(STORAGE_CONFIG[provider].cookieUrls);
  return cookies.some(AUTH_CONFIG[provider].isSessionCookie);
}

export async function getAllAccountStatuses(): Promise<AccountStatus[]> {
  return Promise.all(
    AUTH_PROVIDERS.map(async (provider) => ({ provider, loggedIn: await getAccountStatus(provider) })),
  );
}

export async function clearProviderSession(provider: Provider): Promise<void> {
  await workerSession().clearData({
    origins: STORAGE_CONFIG[provider].resetOrigins,
    dataTypes: [
      'cookies',
      'cache',
      'localStorage',
      'indexedDB',
      'serviceWorkers',
      'fileSystems',
      'backgroundFetch',
    ],
  });
}
