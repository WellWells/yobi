import { useCallback, useEffect, useState } from 'react';
import { byokApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { DEFAULT_MODEL_URL, makeByokGroupModels, makeByokModelOption } from '../../../config/models';
import { BYOK_DEFAULT_BASE_URLS, buildByokUrl } from '../../../../../shared/types';
import type { ByokConnectionProbe, ByokInstanceSnapshot, ByokProviderType, ByokSettingsSnapshot } from '../../../../../shared/types';

type ByokProbePayload = ByokConnectionProbe;

export interface ByokFormState {
  id: string | null;
  name: string;
  providerType: ByokProviderType;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function emptyForm(): ByokFormState {
  return {
    id: null,
    name: '',
    providerType: 'openai',
    baseUrl: BYOK_DEFAULT_BASE_URLS.openai,
    model: '',
    apiKey: '',
  };
}

function isValidBaseUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export type ByokTestStatus = 'idle' | 'testing' | 'ok' | 'error';

export function useByokSettings() {
  const [snapshot, setSnapshot] = useState<ByokSettingsSnapshot | null>(null);
  const [form, setForm] = useState<ByokFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<ByokTestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');

  const syncPickerModels = useCallback((next: ByokSettingsSnapshot) => {
    const store = useAppStore.getState();
    store.setByokGroupModels(makeByokGroupModels(next.groups));
    store.setByokModels(next.instances.map(makeByokModelOption));
  }, []);

  const applySnapshot = useCallback((next: ByokSettingsSnapshot) => {
    setSnapshot(next);
    syncPickerModels(next);
  }, [syncPickerModels]);

  const reload = useCallback(async () => {
    applySnapshot(await byokApi.getSettings());
  }, [applySnapshot]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resetProbeState = useCallback(() => {
    setModels([]);
    setModelsError(null);
    setTestStatus('idle');
    setTestMessage('');
  }, []);

  const openAdd = useCallback(() => {
    resetProbeState();
    setForm(emptyForm());
  }, [resetProbeState]);

  const openEdit = useCallback((instance: ByokInstanceSnapshot) => {
    resetProbeState();
    setForm({
      id: instance.id,
      name: instance.name,
      providerType: instance.providerType,
      baseUrl: instance.baseUrl,
      model: instance.model,
      apiKey: '',
    });
  }, [resetProbeState]);

  const closeForm = useCallback(() => {
    resetProbeState();
    setForm(null);
  }, [resetProbeState]);

  const updateForm = useCallback((patch: Partial<ByokFormState>) => {
    // A loaded model list / test result belongs to the previous endpoint;
    // changing where or how we connect invalidates it.
    if (patch.baseUrl !== undefined || patch.providerType !== undefined) {
      setModels([]);
      setModelsError(null);
    }
    if (patch.baseUrl !== undefined || patch.providerType !== undefined
      || patch.apiKey !== undefined || patch.model !== undefined) {
      setTestStatus('idle');
      setTestMessage('');
    }
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      // Switching provider type swaps in the matching default base URL, but
      // only when the field still holds a default (never clobber a custom URL).
      if (patch.providerType && patch.providerType !== prev.providerType) {
        const defaults = Object.values(BYOK_DEFAULT_BASE_URLS) as string[];
        if (!prev.baseUrl.trim() || defaults.includes(prev.baseUrl.trim())) {
          next.baseUrl = BYOK_DEFAULT_BASE_URLS[patch.providerType];
        }
      }
      return next;
    });
  }, []);

  // A probe can run before saving: needs a valid base URL plus a key (typed, or
  // the stored key of the instance being edited).
  const canProbe = form !== null
    && isValidBaseUrl(form.baseUrl)
    && (form.apiKey.trim().length > 0 || form.id !== null);
  const canTest = canProbe && form !== null && form.model.trim().length > 0;

  const buildProbe = useCallback((): ByokProbePayload | null => {
    if (!form) return null;
    return {
      id: form.id ?? undefined,
      name: form.name,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      model: form.model,
    };
  }, [form]);

  const loadModels = useCallback(async () => {
    const probe = buildProbe();
    if (!probe) return;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const result = await byokApi.listModels(probe);
      if (result.ok) {
        setModels(result.models);
        if (result.models.length === 0) setModelsError('EMPTY');
      } else {
        setModels([]);
        setModelsError(result.message ?? 'ERROR');
      }
    } finally {
      setModelsLoading(false);
    }
  }, [buildProbe]);

  const testInstance = useCallback(async () => {
    const probe = buildProbe();
    if (!probe) return;
    setTestStatus('testing');
    setTestMessage('');
    const result = await byokApi.testInstance(probe);
    if (result.ok) {
      setTestStatus('ok');
      setTestMessage(result.reply ?? '');
    } else {
      setTestStatus('error');
      setTestMessage(result.message ?? '');
    }
  }, [buildProbe]);

  const formValid = form !== null
    && form.name.trim().length > 0
    && form.model.trim().length > 0
    && isValidBaseUrl(form.baseUrl)
    && (form.id !== null || form.apiKey.trim().length > 0);

  const saveForm = useCallback(async () => {
    if (!form) return;
    setBusy(true);
    try {
      const result = await byokApi.saveInstance({
        id: form.id ?? undefined,
        name: form.name,
        providerType: form.providerType,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey,
      });
      applySnapshot(result.snapshot);
      if (result.ok) setForm(null);
    } finally {
      setBusy(false);
    }
  }, [form, applySnapshot]);

  const deleteInstance = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const result = await byokApi.deleteInstance(id);
      applySnapshot(result.snapshot);
      const { aiUrl, setAiUrl } = useAppStore.getState();
      if (aiUrl === buildByokUrl(id)) setAiUrl(DEFAULT_MODEL_URL);
      setForm((prev) => (prev?.id === id ? null : prev));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot]);

  return {
    snapshot,
    applySnapshot,
    form,
    busy,
    formValid,
    canProbe,
    canTest,
    models,
    modelsLoading,
    modelsError,
    testStatus,
    testMessage,
    reload,
    openAdd,
    openEdit,
    closeForm,
    updateForm,
    loadModels,
    testInstance,
    saveForm,
    deleteInstance,
  };
}
