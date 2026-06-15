import { useCallback, useEffect, useState } from 'react';
import { accountApi } from '../../../api/electronApi';
import { AUTH_PROVIDERS, PROVIDERS } from '../../../../../shared/types';
import type { AuthProvider, Provider } from '../../../../../shared/types';

type StatusMap = Record<AuthProvider, boolean | null>;
type BusyMap = Record<Provider, boolean>;

function initStatus(): StatusMap {
  return AUTH_PROVIDERS.reduce((acc, provider) => {
    acc[provider] = null;
    return acc;
  }, {} as StatusMap);
}

function initBusy(): BusyMap {
  return PROVIDERS.reduce((acc, provider) => {
    acc[provider] = false;
    return acc;
  }, {} as BusyMap);
}

export function useAccountSettings() {
  const [statuses, setStatuses] = useState<StatusMap>(initStatus);
  const [busy, setBusy] = useState<BusyMap>(initBusy);

  const refresh = useCallback(async () => {
    const list = await accountApi.getStatuses();
    setStatuses((prev) => {
      const next = { ...prev };
      for (const status of list) next[status.provider] = status.loggedIn;
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh();
    const off = accountApi.onStatusChanged((status) => {
      setStatuses((prev) => ({ ...prev, [status.provider]: status.loggedIn }));
      setBusy((prev) => ({ ...prev, [status.provider]: false }));
    });
    return off;
  }, [refresh]);

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

  return { statuses, busy, login, logout, clearData, refresh };
}
