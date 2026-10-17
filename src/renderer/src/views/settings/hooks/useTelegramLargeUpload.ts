import { useCallback, useState } from 'react';
import { telegramApi, clipboardApi } from '../../../api/electronApi';
import { isTelegramApiHash, parseTelegramApiId } from '../../../../../shared/telegramUpload';
import type { TelegramLargeUploadSnapshot } from '../../../../../shared/telegramUpload';

export const MY_TELEGRAM_URL = 'https://my.telegram.org';

export type LargeUploadTestStatus = 'idle' | 'testing' | 'ok' | 'error';

/** The large-file upload block of the Telegram card: two fields, Save, Clear and Test. */
export function useTelegramLargeUpload(saved: TelegramLargeUploadSnapshot | undefined, reload: () => Promise<void>) {
  const [apiIdInput, setApiIdInput] = useState('');
  const [apiHashInput, setApiHashInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [testStatus, setTestStatus] = useState<LargeUploadTestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');

  const idTyped = apiIdInput.trim();
  const hashTyped = apiHashInput.trim();
  const apiIdInvalid = idTyped !== '' && parseTelegramApiId(idTyped) === 0;
  const apiHashInvalid = hashTyped !== '' && !isTelegramApiHash(hashTyped);
  const effectiveId = idTyped ? parseTelegramApiId(idTyped) : (saved?.apiId ?? 0);
  const hasHash = hashTyped !== '' || Boolean(saved?.hasApiHash);
  const isSet = Boolean(saved?.apiId && saved.hasApiHash);
  const canSave = !busy && (idTyped !== '' || hashTyped !== '') && !apiIdInvalid && !apiHashInvalid
    && effectiveId > 0 && hasHash;
  const canTest = testStatus !== 'testing' && !apiIdInvalid && !apiHashInvalid && effectiveId > 0 && hasHash;

  const resetTest = useCallback(() => {
    setTestStatus('idle');
    setTestMessage('');
  }, []);

  const changeApiId = useCallback((value: string) => {
    setApiIdInput(value);
    setMessage('');
    resetTest();
  }, [resetTest]);

  const changeApiHash = useCallback((value: string) => {
    setApiHashInput(value);
    setMessage('');
    resetTest();
  }, [resetTest]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const result = await telegramApi.updateLargeUpload({ apiId: idTyped, apiHash: hashTyped });
      if (!result.ok) {
        setMessage(result.message ?? '');
        return;
      }
      setApiIdInput('');
      setApiHashInput('');
      setMessage('');
      await reload();
    } finally {
      setBusy(false);
    }
  }, [idTyped, hashTyped, reload]);

  const clear = useCallback(async () => {
    setBusy(true);
    try {
      await telegramApi.clearLargeUpload();
      setApiIdInput('');
      setApiHashInput('');
      setMessage('');
      resetTest();
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload, resetTest]);

  const test = useCallback(async () => {
    setTestStatus('testing');
    setTestMessage('');
    const result = await telegramApi.testLargeUpload({ apiId: idTyped, apiHash: hashTyped })
      .catch(() => ({ ok: false, message: '', botUsername: undefined }));
    setTestStatus(result.ok ? 'ok' : 'error');
    setTestMessage(result.ok ? (result.botUsername ? `@${result.botUsername}` : '') : (result.message ?? ''));
  }, [idTyped, hashTyped]);

  const openMyTelegram = useCallback(async () => {
    await clipboardApi.openExternalUrl(MY_TELEGRAM_URL);
  }, []);

  return {
    apiIdInput,
    apiHashInput,
    changeApiId,
    changeApiHash,
    apiIdInvalid,
    apiHashInvalid,
    isSet,
    busy,
    message,
    canSave,
    canTest,
    testStatus,
    testMessage,
    save,
    clear,
    test,
    openMyTelegram,
  };
}
