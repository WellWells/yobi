import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { BYOK_PROVIDER_TYPES, IPC, PROVIDER_URLS, byokIdFromUrl, byokGroupIdFromUrl, detectByokProviderType } from '../../shared/types';
import type { ByokConnectionProbe, ByokGroupSaveRequest, ByokInstanceSaveRequest, ByokModelsResult, ByokProviderType, ByokSettingsSnapshot, ByokTestResult } from '../../shared/types';
import { config, saveConfig } from '../config';
import type { ByokInstance } from '../configTypes';
import { maskToken, sendLog } from '../helpers';
import { callByokChat, listByokModels } from '../providers/byokClient';
import { getLangCache, localizeUserFacingError } from '../i18n';
import type { IpcContext } from './context';

const BYOK_PROBE_TIMEOUT_MS = 30_000;
const BYOK_TEST_PROMPT = 'Reply with the single word: OK';

function buildByokSnapshot(): ByokSettingsSnapshot {
  const existingKeyIds = new Set(config.byokInstances.map((instance) => instance.id));
  return {
    instances: config.byokInstances.map((instance) => ({
      id: instance.id,
      name: instance.name,
      providerType: instance.providerType,
      baseUrl: instance.baseUrl,
      model: instance.model,
      hasKey: Boolean(instance.apiKey.trim()),
      keyPreview: maskToken(instance.apiKey),
    })),
    groups: config.byokGroups.map((group) => ({
      id: group.id,
      name: group.name,
      memberIds: group.memberIds.filter((memberId) => existingKeyIds.has(memberId)),
    })),
  };
}

function isValidBaseUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isDanglingByokTarget(url: string): boolean {
  const instanceId = byokIdFromUrl(url);
  if (instanceId) return !config.byokInstances.some((instance) => instance.id === instanceId);
  const groupId = byokGroupIdFromUrl(url);
  if (groupId) {
    const group = config.byokGroups.find((entry) => entry.id === groupId);
    return !group || group.memberIds.length === 0;
  }
  return false;
}

function pruneHiddenByokIds(): void {
  const keyIds = new Set(config.byokInstances.map((instance) => instance.id));
  const groupIds = new Set(config.byokGroups.map((group) => group.id));
  const nextKeys = config.hiddenByokIds.filter((id) => keyIds.has(id));
  const nextGroups = config.hiddenByokGroupIds.filter((id) => groupIds.has(id));
  if (nextKeys.length === config.hiddenByokIds.length && nextGroups.length === config.hiddenByokGroupIds.length) {
    return;
  }
  config.hiddenByokIds = nextKeys;
  config.hiddenByokGroupIds = nextGroups;
  saveConfig({ hiddenByokIds: nextKeys, hiddenByokGroupIds: nextGroups });
}

function resetDanglingLlmDirectTargets(): void {
  let changed = false;
  if (isDanglingByokTarget(config.telegram.llmDirect.targetUrl)) {
    config.telegram.llmDirect = { ...config.telegram.llmDirect, targetUrl: '' };
    changed = true;
  }
  if (isDanglingByokTarget(config.line.llmDirect.targetUrl)) {
    config.line.llmDirect = { ...config.line.llmDirect, targetUrl: '' };
    changed = true;
  }
  if (changed) saveConfig({ telegram: config.telegram, line: config.line });
}

function resolveProbeKey(req: ByokConnectionProbe): string {
  const typed = (req?.apiKey ?? '').trim();
  if (typed) return typed;
  const id = (req?.id ?? '').trim();
  if (!id) return '';
  return config.byokInstances.find((instance) => instance.id === id)?.apiKey ?? '';
}

export function registerByokHandlers(ctx: IpcContext): void {
  const refreshTelegramMenu = (): void => {
    void ctx.telegramRuntime.refreshBotCommands();
  };

  ipcMain.handle(IPC.BYOK_GET_SETTINGS, (): ByokSettingsSnapshot => buildByokSnapshot());

  ipcMain.handle(IPC.BYOK_SAVE_INSTANCE, (_event, req: ByokInstanceSaveRequest) => {
    const name = (req?.name ?? '').trim();
    const baseUrl = (req?.baseUrl ?? '').trim();
    const model = (req?.model ?? '').trim();
    const rawType = req?.providerType;
    const providerType: ByokProviderType = BYOK_PROVIDER_TYPES.includes(rawType as ByokProviderType)
      ? (rawType as ByokProviderType)
      : detectByokProviderType(baseUrl);
    if (!name || !model || !isValidBaseUrl(baseUrl)) {
      return { ok: false as const, snapshot: buildByokSnapshot() };
    }

    const requestedId = (req?.id ?? '').trim();
    const existing = requestedId
      ? config.byokInstances.find((instance) => instance.id === requestedId)
      : undefined;
    const apiKeyInput = (req?.apiKey ?? '').trim();

    if (existing) {
      existing.name = name;
      existing.providerType = providerType;
      existing.baseUrl = baseUrl;
      existing.model = model;
      if (apiKeyInput) existing.apiKey = apiKeyInput;
    } else {
      const instance: ByokInstance = {
        id: randomUUID(),
        name,
        providerType,
        apiKey: apiKeyInput,
        baseUrl,
        model,
      };
      config.byokInstances.push(instance);
    }

    saveConfig({ byokInstances: config.byokInstances });
    sendLog(`🔑 BYOK instance ${existing ? 'updated' : 'added'}: ${name}`);
    refreshTelegramMenu();
    return { ok: true as const, snapshot: buildByokSnapshot() };
  });

  ipcMain.handle(IPC.BYOK_LIST_MODELS, async (_event, req: ByokConnectionProbe): Promise<ByokModelsResult> => {
    try {
      const models = await listByokModels(
        { baseUrl: (req?.baseUrl ?? '').trim(), apiKey: resolveProbeKey(req) },
        BYOK_PROBE_TIMEOUT_MS,
      );
      return { ok: true, models };
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      return { ok: false, models: [], message: localizeUserFacingError(raw, getLangCache()) };
    }
  });

  ipcMain.handle(IPC.BYOK_TEST_INSTANCE, async (_event, req: ByokConnectionProbe): Promise<ByokTestResult> => {
    try {
      const { response } = await callByokChat(
        {
          baseUrl: (req?.baseUrl ?? '').trim(),
          apiKey: resolveProbeKey(req),
          model: (req?.model ?? '').trim(),
          label: (req?.name ?? '').trim(),
        },
        BYOK_TEST_PROMPT,
        BYOK_PROBE_TIMEOUT_MS,
      );
      return { ok: true, reply: response.replace(/\s+/g, ' ').trim().slice(0, 120) };
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      return { ok: false, message: localizeUserFacingError(raw, getLangCache()) };
    }
  });

  ipcMain.handle(IPC.BYOK_DELETE_INSTANCE, (_event, id: string) => {
    const targetId = (id ?? '').trim();
    const index = config.byokInstances.findIndex((instance) => instance.id === targetId);
    if (index === -1) return { ok: false as const, snapshot: buildByokSnapshot() };

    const [removed] = config.byokInstances.splice(index, 1);

    let groupsChanged = false;
    for (const group of config.byokGroups) {
      const before = group.memberIds.length;
      group.memberIds = group.memberIds.filter((memberId) => memberId !== removed.id);
      if (group.memberIds.length !== before) groupsChanged = true;
    }

    const activeGroupId = byokGroupIdFromUrl(config.targetUrl);
    const activeGroupEmptied = activeGroupId !== null
      && (config.byokGroups.find((group) => group.id === activeGroupId)?.memberIds.length ?? 0) === 0;
    const targetReset = byokIdFromUrl(config.targetUrl) === removed.id || activeGroupEmptied;
    if (targetReset) {
      config.targetUrl = PROVIDER_URLS.gemini;
    }
    saveConfig({
      byokInstances: config.byokInstances,
      ...(groupsChanged ? { byokGroups: config.byokGroups } : {}),
      ...(targetReset ? { targetUrl: config.targetUrl } : {}),
    });
    sendLog(`🗑️ BYOK instance removed: ${removed.name}`);
    pruneHiddenByokIds();
    resetDanglingLlmDirectTargets();
    refreshTelegramMenu();
    return { ok: true as const, snapshot: buildByokSnapshot() };
  });

  ipcMain.handle(IPC.BYOK_SAVE_GROUP, (_event, req: ByokGroupSaveRequest) => {
    const name = (req?.name ?? '').trim();
    const existingKeyIds = new Set(config.byokInstances.map((instance) => instance.id));
    const memberIds = Array.isArray(req?.memberIds)
      ? Array.from(new Set(
          req.memberIds
            .map((memberId) => (memberId ?? '').trim())
            .filter((memberId) => memberId && existingKeyIds.has(memberId)),
        ))
      : [];
    if (!name || memberIds.length === 0) {
      return { ok: false as const, snapshot: buildByokSnapshot() };
    }

    const requestedId = (req?.id ?? '').trim();
    const existing = requestedId
      ? config.byokGroups.find((group) => group.id === requestedId)
      : undefined;

    if (existing) {
      existing.name = name;
      existing.memberIds = memberIds;
    } else {
      config.byokGroups.push({ id: randomUUID(), name, memberIds });
    }

    saveConfig({ byokGroups: config.byokGroups });
    sendLog(`🔗 BYOK group ${existing ? 'updated' : 'added'}: ${name}`);
    refreshTelegramMenu();
    return { ok: true as const, snapshot: buildByokSnapshot() };
  });

  ipcMain.handle(IPC.BYOK_DELETE_GROUP, (_event, id: string) => {
    const targetId = (id ?? '').trim();
    const index = config.byokGroups.findIndex((group) => group.id === targetId);
    if (index === -1) return { ok: false as const, snapshot: buildByokSnapshot() };

    const [removed] = config.byokGroups.splice(index, 1);
    if (byokGroupIdFromUrl(config.targetUrl) === removed.id) {
      config.targetUrl = PROVIDER_URLS.gemini;
      saveConfig({ byokGroups: config.byokGroups, targetUrl: config.targetUrl });
    } else {
      saveConfig({ byokGroups: config.byokGroups });
    }
    sendLog(`🗑️ BYOK group removed: ${removed.name}`);
    pruneHiddenByokIds();
    resetDanglingLlmDirectTargets();
    refreshTelegramMenu();
    return { ok: true as const, snapshot: buildByokSnapshot() };
  });
}
