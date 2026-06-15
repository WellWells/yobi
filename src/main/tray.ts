import { app, Menu, Tray, nativeImage } from 'electron';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { getLangCache, t } from './i18n';
import { sendLog, getAssetPath } from './helpers';

let tray: Tray | null = null;

function buildTrayIcon(): ReturnType<typeof nativeImage.createEmpty> {
  if (process.platform === 'darwin') {
    const src = nativeImage.createFromPath(getAssetPath('icon-mac.png'));
    const img = src.resize({ width: 18, height: 18 });
    return img;
  }
  const src = nativeImage.createFromPath(getAssetPath('icon-win.png'));
  return src.resize({ width: 32, height: 32 });
}

export interface TrayDeps {
  getMainWin: () => BrowserWindow | null;
  getNotifyEnabled: () => boolean;
  setNotifyEnabled: (v: boolean) => void;
  getLaunchAtStartup: () => boolean;
  setLaunchAtStartup: (v: boolean) => void;
  onQuit: () => void;
  onNavigateSettings: () => void;
}

function restoreWindow(getMainWin: () => BrowserWindow | null): void {
  const win = getMainWin();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

function buildContextMenu(deps: TrayDeps): Menu {
  const {
    getMainWin, getNotifyEnabled, setNotifyEnabled,
    getLaunchAtStartup, setLaunchAtStartup, onQuit, onNavigateSettings,
  } = deps;
  const notifyEnabled = getNotifyEnabled();
  const launchAtStartup = getLaunchAtStartup();
  const strings = getLangCache();

  let items: MenuItemConstructorOptions[];

  if (process.platform === 'darwin') {
    items = [
      {
        label: t(strings, 'app.name', {}),
        enabled: false,
      },
      { type: 'separator' },
      {
        label: t(strings, 'tray.show', {}),
        click: () => restoreWindow(getMainWin),
      },
      {
        label: t(strings, 'tray.preferences', {}),
        accelerator: 'Command+,',
        click: () => {
          restoreWindow(getMainWin);
          onNavigateSettings();
        },
      },
      { type: 'separator' },
      {
        label: t(strings, 'tray.quit', {}),
        accelerator: 'Command+Q',
        click: () => onQuit(),
      },
    ];
  } else {
    items = [
      {
        label: t(strings, 'app.name', {}),
        enabled: false,
      },
      { type: 'separator' },
      {
        label: t(strings, 'tray.restore', {}),
        click: () => restoreWindow(getMainWin),
      },
      { type: 'separator' },
      {
        label: t(strings, 'tray.notifications', {}),
        type: 'checkbox',
        checked: notifyEnabled,
        click: (menuItem) => {
          setNotifyEnabled(menuItem.checked);
          rebuildMenu(deps);
        },
      },
      {
        label: t(strings, 'tray.launchAtStartup', {}),
        type: 'checkbox',
        checked: launchAtStartup,
        click: (menuItem) => {
          setLaunchAtStartup(menuItem.checked);
          rebuildMenu(deps);
        },
      },
      { type: 'separator' },
      {
        label: t(strings, 'tray.quit.win', {}),
        click: () => onQuit(),
      },
    ];
  }

  return Menu.buildFromTemplate(items);
}

function rebuildMenu(deps: TrayDeps): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildContextMenu(deps));
}

export function isTrayCreated(): boolean {
  return tray !== null && !tray.isDestroyed();
}

export function createTray(deps: TrayDeps): void {
  if (isTrayCreated()) return;

  const icon = buildTrayIcon();
  tray = new Tray(icon);

  const strings = getLangCache();
  const appName = t(strings, 'app.name', {});
  tray.setToolTip(appName);

  tray.setContextMenu(buildContextMenu(deps));

  if (process.platform === 'win32') {
    tray.on('double-click', () => restoreWindow(deps.getMainWin));
  }

  sendLog('🔔 System tray icon created');
}

export function updateTrayMenu(deps: TrayDeps): void {
  rebuildMenu(deps);
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    sendLog('🔔 System tray icon removed');
  }
  tray = null;
}
