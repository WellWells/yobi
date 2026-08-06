import { useCallback, useEffect, useState } from 'react';
import { mcpApi } from '../../../api/electronApi';
import type { McpServerView } from '../../../../../shared/types';

export interface McpFormState {
  id?: string;
  name: string;
  url: string;
  token: string;
  headerName: string;
  agentEnabled: boolean;
  autoApproveWrites: boolean;
}

export function useMcpServers() {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [form, setForm] = useState<McpFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setServers(await mcpApi.list());
  }, []);

  useEffect(() => {
    void reload();
    const unsubscribe = mcpApi.onServerStatus((next) => setServers(next));
    return unsubscribe;
  }, [reload]);

  const openAdd = useCallback(() => {
    setError(null);
    setForm({ name: '', url: '', token: '', headerName: '', agentEnabled: true, autoApproveWrites: false });
  }, []);
  const openEdit = useCallback((server: McpServerView) => {
    setError(null);
    setForm({
      id: server.id,
      name: server.name,
      url: server.url,
      token: '',
      headerName: server.headerName ?? '',
      agentEnabled: server.agentEnabled !== false,
      autoApproveWrites: server.autoApproveWrites === true,
    });
  }, []);
  const closeForm = useCallback(() => { setForm(null); setError(null); }, []);
  const updateForm = useCallback((patch: Partial<McpFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const saveForm = useCallback(async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    const result = await mcpApi.save({
      id: form.id,
      name: form.name.trim(),
      url: form.url.trim(),
      token: form.token.trim(),
      headerName: form.headerName.trim(),
      agentEnabled: form.agentEnabled,
      autoApproveWrites: form.autoApproveWrites,
    });
    setSaving(false);
    setServers(result.servers);
    if (result.ok) setForm(null);
    else setError(result.error ?? 'Save failed');
  }, [form]);

  const removeServer = useCallback(async (id: string) => {
    const result = await mcpApi.remove(id);
    setServers(result.servers);
  }, []);

  const connect = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    const result = await mcpApi.connect(id);
    setBusyId(null);
    setServers(result.servers);
    if (!result.ok && result.error) setError(result.error);
  }, []);

  const disconnect = useCallback(async (id: string) => {
    const result = await mcpApi.disconnect(id);
    setServers(result.servers);
  }, []);

  const formValid = Boolean(form && /^https:\/\/.+/i.test(form.url.trim()));

  return {
    servers, form, saving, busyId, error, formValid,
    openAdd, openEdit, closeForm, updateForm, saveForm, removeServer, connect, disconnect,
  };
}
