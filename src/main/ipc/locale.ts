import { ipcMain, shell } from 'electron';
import * as fs from 'node:fs/promises';
import { IPC } from '../../shared/types';
import { config } from '../config';
import { isValidLocaleTag, loadLanguageData } from '../i18n';
import { getLanguageDir, getUserLanguageDir } from '../files';
import { applyLocale, setSettingsContext } from './settingsApply';
import type { IpcContext } from './context';

/** Every language pack: the built-in ones and the user's own, sorted. */
export async function listLanguagePacks(): Promise<string[]> {
  const [builtIn, user] = await Promise.all([
    listPacksIn(getLanguageDir()),
    listPacksIn(getUserLanguageDir()),
  ]);
  const merged = [...new Set([...builtIn, ...user])].sort();
  return merged.length > 0 ? merged : ['en-US', 'zh-TW'];
}

async function listPacksIn(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter(isValidLocaleTag);
  } catch {
    return [];
  }
}

export function registerLocaleHandlers(ctx: IpcContext): void {
  setSettingsContext(ctx);
  ipcMain.handle(IPC.GET_LANGUAGE_LIST, () => listLanguagePacks());

  ipcMain.handle(IPC.OPEN_LANGUAGES_FOLDER, async () => {
    const dir = getUserLanguageDir();
    await fs.mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    return !error;
  });

  ipcMain.handle(IPC.GET_CURRENT_LOCALE, () => ({
    locale: config.locale,
    setByUser: config.localeSetByUser,
  }));
  ipcMain.handle(IPC.GET_LANGUAGE_CONTENT, (_event, lang: string) => loadLanguageData(lang));

  ipcMain.handle(IPC.SET_CURRENT_LOCALE, (_event, lang: string) => applyLocale(lang, true));

  ipcMain.handle(IPC.SET_LOCALE_AUTO, (_event, lang: string) => applyLocale(lang, false));
}
