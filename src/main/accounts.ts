import { BrowserWindow } from 'electron';
import { IPC, PROVIDER_LABELS, AUTH_PROVIDERS } from '../shared/types';
import type { AccountStatus, AuthProvider, Provider } from '../shared/types';
import { sendLog, sendToRenderer, sendWebNotification } from './helpers';
import { getLangCache, t } from './i18n';
import { getAuthProviderConfig, getAccountStatus, clearProviderSession } from './providers/authStatus';
import { runGoogleSignInLanguageReset } from './providers/googleSignInLanguage';
import { applyWorkerUserAgent } from './clientHints';
import { clearClaudeModels } from './providers/claudeModelSync';
import { refreshClaudeModelList } from './ipc/claudeModel';
import { clearChatgptModels } from './providers/chatgptModelSync';
import { refreshChatgptModelList } from './ipc/chatgptModel';

const WORKER_PARTITION = 'persist:gemini';
const POLL_INTERVAL_MS = 1_500;

let loginWin: BrowserWindow | null = null;
let loginProvider: AuthProvider | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let programmaticClose = false;

function broadcastStatus(provider: AuthProvider, loggedIn: boolean): void {
  const status: AccountStatus = { provider, loggedIn };
  sendToRenderer(IPC.ACCOUNT_STATUS_CHANGED, status);
}

/** Claude's and ChatGPT's model lists depend on the account's plan, so a sign-in reads them again. */
function afterSignIn(provider: AuthProvider): void {
  if (provider === 'claude') void refreshClaudeModelList(true);
  if (provider === 'chatgpt') void refreshChatgptModelList(true);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function openAccountLoginWindow(provider: AuthProvider): Promise<boolean> {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    if (loginProvider !== provider) {
      sendLog(`ℹ️ A sign-in window is already open for ${PROVIDER_LABELS[loginProvider ?? provider]} — close it first`);
    }
    return loginProvider === provider;
  }

  const cfg = getAuthProviderConfig(provider);
  const providerLabel = PROVIDER_LABELS[provider];
  const strings = getLangCache();

  const win = new BrowserWindow({
    width: 480,
    height: 760,
    title: t(strings, 'settings.accounts.loginWindow.title', { provider: providerLabel }),
    autoHideMenuBar: true,
    webPreferences: {
      partition: WORKER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWin = win;
  loginProvider = provider;
  programmaticClose = false;
  win.setMenuBarVisibility(false);
  applyWorkerUserAgent(win.webContents, cfg.userAgent);
  await win.loadURL(cfg.loginUrl);

  sendLog(t(strings, 'settings.accounts.login.opened', { provider: providerLabel }));

  if (provider === 'gemini' && !win.isDestroyed()) await runGoogleSignInLanguageReset(win.webContents);

  pollTimer = setInterval(() => {
    void (async () => {
      if (!loginWin || loginWin.isDestroyed()) {
        stopPolling();
        return;
      }
      let loggedIn = false;
      try {
        loggedIn = await getAccountStatus(provider);
      } catch {
        return;
      }
      if (!loggedIn) return;
      stopPolling();
      broadcastStatus(provider, true);
      afterSignIn(provider);
      sendWebNotification(
        t(strings, 'notify.completed.title'),
        t(strings, 'settings.accounts.login.success', { provider: providerLabel }),
        'success',
      );
      programmaticClose = true;
      if (loginWin && !loginWin.isDestroyed()) loginWin.destroy();
    })();
  }, POLL_INTERVAL_MS);

  win.on('closed', () => {
    stopPolling();
    loginWin = null;
    loginProvider = null;
    if (programmaticClose) {
      programmaticClose = false;
      return;
    }
    void (async () => {
      let loggedIn = false;
      try {
        loggedIn = await getAccountStatus(provider);
      } catch {
      }
      broadcastStatus(provider, loggedIn);
      if (loggedIn) afterSignIn(provider);
    })();
  });

  return true;
}

function isAuthProvider(provider: Provider): provider is AuthProvider {
  return (AUTH_PROVIDERS as readonly string[]).includes(provider);
}

export async function clearProviderData(provider: Provider): Promise<boolean> {
  const label = PROVIDER_LABELS[provider];
  try {
    await clearProviderSession(provider);
    if (provider === 'claude') clearClaudeModels();
    if (provider === 'chatgpt') clearChatgptModels();
    if (isAuthProvider(provider)) {
      broadcastStatus(provider, false);
    } else {
      const strings = getLangCache();
      sendWebNotification(
        t(strings, 'notify.completed.title'),
        t(strings, 'settings.accounts.reset.done', { provider: label }),
        'success',
      );
    }
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
