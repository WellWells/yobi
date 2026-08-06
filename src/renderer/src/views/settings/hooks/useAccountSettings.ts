import { useCallback, useEffect, useState } from 'react';
import { accountApi } from '../../../api/electronApi';
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

  useEffect(() => {
    return accountApi.onStatusChanged((status) => {
      setBusy((prev) => ({ ...prev, [status.provider]: false }));
    });
  }, []);

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

  return { statuses, busy, login, logout, clearData };
}
