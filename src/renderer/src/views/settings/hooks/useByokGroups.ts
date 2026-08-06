import { useCallback, useState } from 'react';
import { byokApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { DEFAULT_MODEL_URL } from '../../../config/models';
import { buildByokGroupUrl } from '../../../../../shared/types';
import type { ByokGroupSnapshot, ByokInstanceSnapshot, ByokSettingsSnapshot } from '../../../../../shared/types';

export interface ByokGroupFormState {
  id: string | null;
  name: string;
  memberIds: string[];
}

function emptyGroupForm(): ByokGroupFormState {
  return { id: null, name: '', memberIds: [] };
}

export function useByokGroups(
  snapshot: ByokSettingsSnapshot | null,
  applySnapshot: (next: ByokSettingsSnapshot) => void,
) {
  const [form, setForm] = useState<ByokGroupFormState | null>(null);
  const [busy, setBusy] = useState(false);

  const groups: ByokGroupSnapshot[] = snapshot?.groups ?? [];
  const availableKeys: ByokInstanceSnapshot[] = snapshot?.instances ?? [];

  const openAdd = useCallback(() => setForm(emptyGroupForm()), []);

  const openEdit = useCallback((group: ByokGroupSnapshot) => {
    setForm({ id: group.id, name: group.name, memberIds: [...group.memberIds] });
  }, []);

  const closeForm = useCallback(() => setForm(null), []);

  const updateName = useCallback((name: string) => {
    setForm((prev) => (prev ? { ...prev, name } : prev));
  }, []);

  const toggleMember = useCallback((keyId: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      const selected = prev.memberIds.includes(keyId);
      return {
        ...prev,
        memberIds: selected
          ? prev.memberIds.filter((id) => id !== keyId)
          : [...prev.memberIds, keyId],
      };
    });
  }, []);

  const formValid = form !== null
    && form.name.trim().length > 0
    && form.memberIds.length > 0;

  const saveForm = useCallback(async () => {
    if (!form) return;
    setBusy(true);
    try {
      const result = await byokApi.saveGroup({
        id: form.id ?? undefined,
        name: form.name,
        memberIds: form.memberIds,
      });
      applySnapshot(result.snapshot);
      if (result.ok) setForm(null);
    } finally {
      setBusy(false);
    }
  }, [form, applySnapshot]);

  const deleteGroup = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const result = await byokApi.deleteGroup(id);
      applySnapshot(result.snapshot);
      const { aiUrl, setAiUrl } = useAppStore.getState();
      if (aiUrl === buildByokGroupUrl(id)) setAiUrl(DEFAULT_MODEL_URL);
      setForm((prev) => (prev?.id === id ? null : prev));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot]);

  return {
    groups,
    availableKeys,
    form,
    busy,
    formValid,
    openAdd,
    openEdit,
    closeForm,
    updateName,
    toggleMember,
    saveForm,
    deleteGroup,
  };
}
