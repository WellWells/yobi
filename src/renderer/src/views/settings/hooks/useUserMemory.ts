import { useCallback, useEffect, useState } from 'react';
import { userMemoryApi } from '../../../api/electronApi';
import { useUserMemoryStore } from '../../../store/userMemoryStore';
import type { MemoryEditFailure, MemoryEditResult, UserMemoryBotSelf } from '../../../../../shared/userMemory';

/** Which entry an edit form is open for: an id, `'new'` for the add form, or nothing. */
export type MemoryFormTarget = string | 'new' | null;

export function useUserMemory() {
  const snapshot = useUserMemoryStore((s) => s.snapshot);
  const apply = useUserMemoryStore((s) => s.apply);
  const [formTarget, setFormTarget] = useState<MemoryFormTarget>(null);
  const [error, setError] = useState<MemoryEditFailure | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    useUserMemoryStore.getState().initialize();
  }, []);

  const run = useCallback(async (action: () => Promise<MemoryEditResult>): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await action();
      apply(result.snapshot);
      setError(result.ok ? null : result.reason);
      return result.ok;
    } finally {
      setBusy(false);
    }
  }, [apply]);

  const openForm = useCallback((target: MemoryFormTarget) => {
    setError(null);
    setFormTarget((current) => (current === target ? null : target));
  }, []);

  const save = useCallback(async (text: string): Promise<void> => {
    const target = formTarget;
    if (!target) return;
    const ok = await run(() => (target === 'new' ? userMemoryApi.add(text) : userMemoryApi.update(target, text)));
    if (ok) setFormTarget(null);
  }, [formTarget, run]);

  const remove = useCallback(async (id: string): Promise<void> => {
    await run(() => userMemoryApi.remove(id));
    setFormTarget((current) => (current === id ? null : current));
  }, [run]);

  const clearAll = useCallback(async (): Promise<void> => {
    apply(await userMemoryApi.clear());
    setFormTarget(null);
  }, [apply]);

  const setEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    apply(await userMemoryApi.setEnabled(enabled));
  }, [apply]);

  const setBotSelf = useCallback(async (botSelf: UserMemoryBotSelf): Promise<void> => {
    apply(await userMemoryApi.setBotSelf(botSelf));
  }, [apply]);

  return { snapshot, formTarget, error, busy, openForm, save, remove, clearAll, setEnabled, setBotSelf };
}
