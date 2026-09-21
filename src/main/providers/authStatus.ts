import { session } from 'electron';
import type { Cookie } from 'electron';
import { isExpiredCookie } from '../helpers';
import { WORKER_USER_AGENTS } from '../userAgent';
import { CHATGPT_LOGIN_URL } from './chatgpt';
import { CLAUDE_LOGIN_URL, isClaudeSessionCookie } from './claudeSession';
import { isPerplexitySessionCookie } from './perplexity';
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
  claude: {
    cookieUrls: ['https://claude.ai/'],
    resetOrigins: ['https://claude.ai', 'https://www.claude.ai'],
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
};

const GEMINI_SESSION_COOKIES = ['__Secure-1PSID', '__Secure-3PSID', 'SID'];

const AUTH_CONFIG: Record<AuthProvider, AuthProviderConfig> = {
  chatgpt: {
    loginUrl: CHATGPT_LOGIN_URL,
    userAgent: WORKER_USER_AGENTS.chatgpt,
    isSessionCookie: (c) =>
      c.name.startsWith('__Secure-next-auth.session-token') && !isExpiredCookie(c.expirationDate),
  },
  claude: {
    loginUrl: CLAUDE_LOGIN_URL,
    userAgent: WORKER_USER_AGENTS.claude,
    isSessionCookie: isClaudeSessionCookie,
  },
  gemini: {
    loginUrl: PROVIDER_URLS.gemini,
    userAgent: WORKER_USER_AGENTS.gemini,
    isSessionCookie: (c) =>
      GEMINI_SESSION_COOKIES.includes(c.name) && Boolean(c.value) && !isExpiredCookie(c.expirationDate),
  },
  perplexity: {
    loginUrl: PROVIDER_URLS.perplexity,
    userAgent: WORKER_USER_AGENTS.perplexity,
    isSessionCookie: isPerplexitySessionCookie,
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
