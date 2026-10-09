import { IPC, PROVIDER_LABELS } from '../shared/types';
import type { AccountStatus, AuthProvider, Provider } from '../shared/types';
import { sendLog, sendToRenderer, sendWebNotification } from './helpers';
import { getLangCache, t } from './i18n';
import { getAuthProviderConfig, getAccountStatus, clearProviderSession } from './providers/authStatus';
import { needsLanguageRoundTrip, runGoogleSignInLanguageReset } from './providers/googleSignInLanguage';
import { applyWorkerUserAgent } from './clientHints';
import { openSignInWindow } from './signInWindow';
import { clearClaudeModels } from './providers/claudeModelSync';
import { refreshClaudeModelList } from './ipc/claudeModel';
import { clearChatgptModels } from './providers/chatgptModelSync';
import { refreshChatgptModelList } from './ipc/chatgptModel';
import { refreshGeminiModelList } from './ipc/geminiModel';

const WORKER_PARTITION = 'persist:gemini';

function broadcastStatus(provider: AuthProvider, loggedIn: boolean): void {
  const status: AccountStatus = { provider, loggedIn };
  sendToRenderer(IPC.ACCOUNT_STATUS_CHANGED, status);
}

/** A model list depends on the account (its plan, or signed in at all), so a sign-in reads it again. */
function afterSignIn(provider: AuthProvider): void {
  if (provider === 'gemini') void refreshGeminiModelList(true);
  if (provider === 'claude') void refreshClaudeModelList(true);
  if (provider === 'chatgpt') void refreshChatgptModelList(true);
}

export async function openAccountLoginWindow(provider: AuthProvider): Promise<boolean> {
  const cfg = getAuthProviderConfig(provider);
  const providerLabel = PROVIDER_LABELS[provider];
  const strings = getLangCache();

  return openSignInWindow({
    id: `provider:${provider}`,
    label: providerLabel,
    title: t(strings, 'settings.accounts.loginWindow.title', { provider: providerLabel }),
    partition: WORKER_PARTITION,
    url: cfg.loginUrl,
    prepare: (contents) => applyWorkerUserAgent(contents, cfg.userAgent),
    afterLoad: async (contents) => {
      sendLog(t(strings, 'settings.accounts.login.opened', { provider: providerLabel }));
      if (cfg.startSignIn) await cfg.startSignIn(contents);
      if (needsLanguageRoundTrip(provider, cfg.userAgent)) await runGoogleSignInLanguageReset(contents);
    },
    isSignedIn: () => getAccountStatus(provider),
    onSignedIn: () => {
      broadcastStatus(provider, true);
      afterSignIn(provider);
      sendWebNotification(t(strings, 'notify.signedIn.title'), providerLabel, 'success');
    },
    onClosed: (loggedIn) => {
      broadcastStatus(provider, loggedIn);
      if (loggedIn) afterSignIn(provider);
    },
  });
}

export async function clearProviderData(provider: Provider): Promise<boolean> {
  const label = PROVIDER_LABELS[provider];
  try {
    await clearProviderSession(provider);
    if (provider === 'claude') clearClaudeModels();
    if (provider === 'chatgpt') clearChatgptModels();
    // Every Provider is an AuthProvider today. If one ever is not, this stops
    // type-checking rather than silently skipping the status broadcast.
    broadcastStatus(provider, false);
    sendLog(`🧹 Cleared ${label} data`);
    return true;
  } catch (err: unknown) {
    sendLog(`⚠️ Clear failed for ${label}: ${(err as Error).message}`);
    return false;
  }
}

export async function logoutAccount(provider: AuthProvider): Promise<boolean> {
  return clearProviderData(provider);
}
