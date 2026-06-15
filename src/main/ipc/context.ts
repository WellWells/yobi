import { dialog } from 'electron';
import * as path from 'node:path';
import type {
  BrowserWindow,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron';
import type { SettingsSnapshot } from '../../shared/types';
import { config } from '../config';
import { getOutputDir } from '../files';
import type { QueueManager } from '../queueManager';
import type { TelegramRuntime } from '../telegram';
import type { FlowManager } from '../flow';

export interface IpcContext {
  queue: QueueManager;
  telegramRuntime: TelegramRuntime;
  telegramSessionId: string;
  getMainWin: () => BrowserWindow | null;
  bindHotkey: () => void;
  checkForUpdates: () => Promise<boolean>;
  onTraySettingsChanged?: () => void;
  onTrayMenuRebuild?: () => void;
  onHideToTray?: () => void;
  onQuitApp?: () => void;
  flowManager?: FlowManager;
}

export function buildSettingsSnapshot(): SettingsSnapshot {
  return {
    hotkey: config.hotkey,
    locale: config.locale,
    theme: config.theme,
    syncSystemLanguageToModel: config.syncSystemLanguageToModel,
    notifyOnComplete: config.notifyOnComplete,
    promptPreferences: config.promptPreferences,
    youtubePrompt: config.youtubePrompt,
    responseTimeout: config.responseTimeout,
    closeToTray: config.closeToTray,
    launchAtStartup: config.launchAtStartup,
  };
}

export async function isAllowedFilePath(filePath: string): Promise<boolean> {
  if (!filePath || typeof filePath !== 'string') return false;
  const resolved = path.resolve(filePath);
  const outputDir = await getOutputDir();
  return resolved.startsWith(outputDir + path.sep) || resolved === outputDir;
}

export function showSaveDialogForWin(
  win: BrowserWindow | null,
  opts: SaveDialogOptions,
): Promise<SaveDialogReturnValue> {
  return win && !win.isDestroyed() ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts);
}

export function showOpenDialogForWin(
  win: BrowserWindow | null,
  opts: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  return win && !win.isDestroyed() ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
}
