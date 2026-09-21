import { useCallback, useEffect, useState } from 'react';
import { mcpApi } from '../../../api/electronApi';
import { useMcpStore } from '../../../store/useMcpStore';
import { normalizeMcpUrl } from '../../../../../shared/mcpCatalog';
import { slugifyCommandName } from '../../../../../shared/mcpCommand';
import type { McpCatalogEntry } from '../../../../../shared/mcpCatalog';
import type { McpServerView } from '../../../../../shared/types';

export interface McpFormState {
  id?: string;
  name: string;
  url: string;
  token: string;
  headerName: string;
  agentEnabled: boolean;
  autoApproveWrites: boolean;
  commandName: string;
}

export function useMcpServers() {
  const servers = useMcpStore((s) => s.servers);
  const setServers = useMcpStore((s) => s.setServers);
  const [form, setForm] = useState<McpFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setServers(await mcpApi.list());
  }, [setServers]);

  useEffect(() => { void reload(); }, [reload]);

  const openAdd = useCallback(() => {
    setError(null);
    setForm({ name: '', url: '', token: '', headerName: '', agentEnabled: true, autoApproveWrites: false, commandName: '' });
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
      commandName: server.commandName ?? '',
    });
  }, []);
  const closeForm = useCallback(() => { setForm(null); setError(null); }, []);
  const updateForm = useCallback((patch: Partial<McpFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const addFromCatalog = useCallback(async (entry: McpCatalogEntry | undefined) => {
    if (!entry) return;
    if (entry.auth === 'token') {
      setError(null);
      setForm({ name: entry.name, url: entry.url, token: '', headerName: '', agentEnabled: true, autoApproveWrites: false, commandName: '' });
      return;
    }
    setBusyId(entry.id);
    setError(null);
    const saved = await mcpApi.save({ name: entry.name, url: entry.url, agentEnabled: true, autoApproveWrites: false });
    setServers(saved.servers);
    const created = saved.servers.find((s) => normalizeMcpUrl(s.url) === normalizeMcpUrl(entry.url));
    if (!saved.ok || !created) {
      setBusyId(null);
      setError(saved.error ?? 'Save failed');
      return;
    }
    setBusyId(created.id);
    const result = await mcpApi.connect(created.id);
    setBusyId(null);
    setServers(result.servers);
    if (!result.ok && result.error) setError(result.error);
  }, []);

  const connect = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    const result = await mcpApi.connect(id);
    setBusyId(null);
    setServers(result.servers);
    if (!result.ok && result.error) setError(result.error);
  }, []);

  const saveForm = useCallback(async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    const url = form.url.trim();
    const result = await mcpApi.save({
      id: form.id,
      name: form.name.trim(),
      url,
      token: form.token.trim(),
      headerName: form.headerName.trim(),
      agentEnabled: form.agentEnabled,
      autoApproveWrites: form.autoApproveWrites,
      commandName: slugifyCommandName(form.commandName),
    });
    setSaving(false);
    setServers(result.servers);
    if (!result.ok) {
      setError(result.error ?? 'Save failed');
      return;
    }
    setForm(null);
    const target = result.servers.find((s) => normalizeMcpUrl(s.url) === normalizeMcpUrl(url));
    if (target && target.status !== 'connected') await connect(target.id);
  }, [form, connect]);

  const removeServer = useCallback(async (id: string) => {
    const result = await mcpApi.remove(id);
    setServers(result.servers);
  }, []);

  const disconnect = useCallback(async (id: string) => {
    const result = await mcpApi.disconnect(id);
    setServers(result.servers);
  }, []);

  const setBuiltin = useCallback(async (id: string, enabled: boolean) => {
    setBusyId(id);
    setError(null);
    const result = await mcpApi.setBuiltin(id, enabled);
    setBusyId(null);
    setServers(result.servers);
    // A connector that is on reports its own failure on its card. Only a failure that left no card
    // to show it on belongs up here.
    if (!result.ok && result.error && !result.servers.some((server) => server.id === id)) setError(result.error);
  }, []);

  const formValid = Boolean(form && /^https:\/\/.+/i.test(form.url.trim()));

  return {
    servers, form, saving, busyId, error, formValid,
    openAdd, openEdit, closeForm, updateForm, saveForm, removeServer, connect, disconnect,
    addFromCatalog, setBuiltin,
  };
}
