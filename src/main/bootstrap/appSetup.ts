import { app, nativeImage } from 'electron';
import { config } from '../config';
import {
  sendLog,
  sendToRenderer,
  setMainWindow,
  setNotifyEnabled,
  setWorkerReveal,
  getAssetPath,
} from '../helpers';
import { loadLanguageData, setLangCache, setEnCache } from '../i18n';
import {
  createMainWindow,
  createWorkerWindow,
  getMainWin,
  revealWorkerWindow,
} from '../windows';
import { initializeUpdater } from '../updater';

export function setupPlatformIcons(): void {
  if (process.platform !== 'darwin') return;
  const dockIcon = nativeImage.createFromPath(getAssetPath('icon-mac.png'));
  app.dock?.setIcon(dockIcon);
  app.setAboutPanelOptions({
    applicationName: 'Yobi',
    iconPath: getAssetPath('icon-mac.png'),
  });
}

export async function loadInitialLanguages(): Promise<void> {
  const initialLang = await loadLanguageData(config.locale);
  if (initialLang) setLangCache(initialLang);
  const enLang = await loadLanguageData('en-US');
  if (enLang) setEnCache(enLang);
}

export function setupWindows(): void {
  createMainWindow();
  setMainWindow(getMainWin());
  setWorkerReveal(() => {
    revealWorkerWindow();
  });
  setNotifyEnabled(config.notifyOnComplete);
  initializeUpdater({ sendLog, sendToRenderer });

  createWorkerWindow(config.targetUrl);
}
