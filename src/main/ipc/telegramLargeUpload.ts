import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { isTelegramApiHash, parseTelegramApiId } from '../../shared/telegramUpload';
import type { TelegramLargeUploadInput, TelegramLargeUploadResult } from '../../shared/telegramUpload';
import { config, markTelegramApiHashResolved, saveConfig } from '../config';
import { sendLog } from '../helpers';
import { getLangCache, localizeUserFacingError, t } from '../i18n';
import { getTelegramLargeUploader } from '../telegram/mtproto';

/** Long enough for a first sign-in from far away; short enough that a blocked network says so. */
const TEST_TIMEOUT_MS = 45_000;

type Parsed = { ok: true; apiId: number; apiHash: string } | { ok: false; message: string };

/**
 * What the form typed, against what is saved: an empty hash keeps the saved one (the field is
 * emptied after saving), an empty id keeps the saved id. Each value typed must be well formed.
 */
export function parseLargeUploadInput(raw: unknown, saved: { apiId: number; apiHash: string }): Parsed {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<TelegramLargeUploadInput>;
  const idText = typeof input.apiId === 'string' ? input.apiId.trim() : String(input.apiId ?? '').trim();
  const hashText = typeof input.apiHash === 'string' ? input.apiHash.trim() : '';
  const strings = getLangCache();
  const apiId = idText ? parseTelegramApiId(idText) : saved.apiId;
  if (idText && !apiId) return { ok: false, message: t(strings, 'settings.telegram.largeUpload.apiIdInvalid') };
  if (hashText && !isTelegramApiHash(hashText)) {
    return { ok: false, message: t(strings, 'settings.telegram.largeUpload.apiHashInvalid') };
  }
  return { ok: true, apiId, apiHash: hashText ? hashText.toLowerCase() : saved.apiHash };
}

function savedPair(): { apiId: number; apiHash: string } {
  return { apiId: config.telegram.apiId, apiHash: config.telegram.apiHash };
}

export function registerTelegramLargeUploadHandlers(): void {
  ipcMain.handle(IPC.UPDATE_TELEGRAM_LARGE_UPLOAD, async (_event, raw: unknown): Promise<TelegramLargeUploadResult> => {
    const parsed = parseLargeUploadInput(raw, savedPair());
    if (!parsed.ok) return { ok: false, message: parsed.message };
    if (!parsed.apiId || !parsed.apiHash) {
      return { ok: false, message: t(getLangCache(), 'settings.telegram.largeUpload.bothNeeded') };
    }
    const changed = parsed.apiId !== config.telegram.apiId || parsed.apiHash !== config.telegram.apiHash;
    markTelegramApiHashResolved();
    config.telegram.apiId = parsed.apiId;
    config.telegram.apiHash = parsed.apiHash;
    saveConfig({ telegram: config.telegram });
    // Another app's credentials sign in as a new session; the old one must not be reused.
    if (changed) await getTelegramLargeUploader()?.forget();
    sendLog('Telegram large-upload credentials saved');
    return { ok: true };
  });

  ipcMain.handle(IPC.CLEAR_TELEGRAM_LARGE_UPLOAD, async (): Promise<TelegramLargeUploadResult> => {
    markTelegramApiHashResolved();
    config.telegram.apiId = 0;
    config.telegram.apiHash = '';
    saveConfig({ telegram: config.telegram });
    await getTelegramLargeUploader()?.forget();
    sendLog('Telegram large-upload credentials cleared');
    return { ok: true };
  });

  ipcMain.handle(IPC.TEST_TELEGRAM_LARGE_UPLOAD, async (_event, raw: unknown): Promise<TelegramLargeUploadResult> => {
    const parsed = parseLargeUploadInput(raw, savedPair());
    if (!parsed.ok) return { ok: false, message: parsed.message };
    const uploader = getTelegramLargeUploader();
    if (!uploader) return { ok: false, message: t(getLangCache(), 'main.error.telegramUploadNotConfigured') };
    try {
      const identity = await uploader.probe(
        { apiId: parsed.apiId, apiHash: parsed.apiHash },
        AbortSignal.timeout(TEST_TIMEOUT_MS),
      );
      return { ok: true, botUsername: identity.username };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`⚠️ Telegram large-upload test failed: ${message}`);
      return { ok: false, message: localizeUserFacingError(message, getLangCache()) };
    }
  });
}
