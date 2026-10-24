import { useCallback, useEffect, useState } from 'react';
import { accountApi, settingsApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { PROVIDERS } from '../../../../../shared/types';
import type { AuthProvider, Provider } from '../../../../../shared/types';

type BusyMap = Record<Provider, boolean>;

function initBusy(): BusyMap {
  return PROVIDERS.reduce((acc, provider) => {
    acc[provider] = false;
    return acc;
  }, {} as BusyMap);
}

export function useAccountSettings() {
  const statuses = useAppStore((state) => state.accountStatuses);
  const [busy, setBusy] = useState<BusyMap>(initBusy);
  const [oneShotTemporaryChat, setOneShotTemporaryChat] = useState(true);

  useEffect(() => {
    return accountApi.onStatusChanged((status) => {
      setBusy((prev) => ({ ...prev, [status.provider]: false }));
    });
  }, []);

  useEffect(() => {
    void settingsApi.getOneShotTemporaryChat().then(setOneShotTemporaryChat);
  }, []);

  const toggleOneShotTemporaryChat = useCallback(async () => {
    const next = !oneShotTemporaryChat;
    await settingsApi.updateOneShotTemporaryChat(next);
    setOneShotTemporaryChat(next);
  }, [oneShotTemporaryChat]);

  const [providerFallback, setProviderFallback] = useState(true);

  useEffect(() => {
    void settingsApi.getProviderFallback().then(setProviderFallback);
  }, []);

  const toggleProviderFallback = useCallback(async () => {
    const next = !providerFallback;
    await settingsApi.updateProviderFallback(next);
    setProviderFallback(next);
  }, [providerFallback]);

  const login = useCallback(async (provider: AuthProvider) => {
    setBusy((prev) => ({ ...prev, [provider]: true }));
    const opened = await accountApi.openLogin(provider);
    if (!opened) setBusy((prev) => ({ ...prev, [provider]: false }));
  }, []);

  const logout = useCallback(async (provider: AuthProvider) => {
    setBusy((prev) => ({ ...prev, [provider]: true }));
    try {
      await accountApi.logout(provider);
    } finally {
      setBusy((prev) => ({ ...prev, [provider]: false }));
    }
  }, []);

  const clearData = useCallback(async (provider: Provider) => {
    setBusy((prev) => ({ ...prev, [provider]: true }));
    try {
      await accountApi.clearData(provider);
    } finally {
      setBusy((prev) => ({ ...prev, [provider]: false }));
    }
  }, []);

  return {
    statuses,
    busy,
    login,
    logout,
    clearData,
    oneShotTemporaryChat,
    toggleOneShotTemporaryChat,
    applyOneShotTemporaryChatReset: setOneShotTemporaryChat,
    providerFallback,
    toggleProviderFallback,
    applyProviderFallbackReset: setProviderFallback,
  };
}
