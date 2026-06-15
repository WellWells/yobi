import { app } from 'electron';
import { IPC } from '../../shared/types';
import { config, saveConfig } from '../config';
import { sendToRenderer, setNotifyEnabled, applyLaunchAtStartup } from '../helpers';
import { getMainWin, setAppQuitting, setMainWindowCloseHandler } from '../windows';
import { createTray, destroyTray, isTrayCreated, updateTrayMenu } from '../tray';
import type { TrayDeps } from '../tray';

export function getTrayDeps(): TrayDeps {
  return {
    getMainWin,
    getNotifyEnabled: () => config.notifyOnComplete,
    setNotifyEnabled: (v: boolean) => {
      config.notifyOnComplete = v;
      saveConfig({ notifyOnComplete: v });
      setNotifyEnabled(v); sendToRenderer(IPC.NOTIFY_ON_COMPLETE_CHANGED, v);
    },
    getLaunchAtStartup: () => config.launchAtStartup,
    setLaunchAtStartup: (v: boolean) => {
      config.launchAtStartup = v;
      saveConfig({ launchAtStartup: v });
      applyLaunchAtStartup(v, config.closeToTray);
      sendToRenderer(IPC.LAUNCH_AT_STARTUP_CHANGED, v);
    },
    onQuit: () => {
      setAppQuitting(true);
      app.quit();
    },
    onNavigateSettings: () => {
      sendToRenderer(IPC.NAVIGATE_SETTINGS);
    },
  };
}

export function setupTrayAndCloseBehavior(): void {
  if (config.closeToTray) {
    createTray(getTrayDeps());
  }

  applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);

  const isStartupHidden = process.argv.includes('--hidden');
  if (isStartupHidden && config.closeToTray) {
    const win = getMainWin();
    win?.hide();
    if (!isTrayCreated()) createTray(getTrayDeps());
  }

  setMainWindowCloseHandler((event) => {
    if (config.closeToTray) {
      event.preventDefault();
      if (!isTrayCreated()) {
        createTray(getTrayDeps());
      }
      const win = getMainWin();
      win?.hide();
      return;
    }

    if (!config.closeActionDecided && process.platform !== 'darwin') {
      event.preventDefault();
      sendToRenderer(IPC.SHOW_CLOSE_DIALOG);
      return;
    }

    if (process.platform !== 'darwin') {
      event.preventDefault();
      setAppQuitting(true);
      app.quit();
    }
  });
}

export function buildTrayIpcCallbacks(): {
  onTraySettingsChanged: () => void;
  onTrayMenuRebuild: () => void;
  onHideToTray: () => void;
  onQuitApp: () => void;
} {
  return {
    onTraySettingsChanged: () => {
      if (config.closeToTray) {
        if (!isTrayCreated()) createTray(getTrayDeps());
        else updateTrayMenu(getTrayDeps());
      } else {
        destroyTray();
      }
    },
    onTrayMenuRebuild: () => {
      if (isTrayCreated()) updateTrayMenu(getTrayDeps());
    },
    onHideToTray: () => {
      if (!isTrayCreated()) createTray(getTrayDeps());
      const win = getMainWin();
      win?.hide();
    },
    onQuitApp: () => {
      setAppQuitting(true);
      app.quit();
    },
  };
}
