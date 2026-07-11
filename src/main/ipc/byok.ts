import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { BYOK_PROVIDER_TYPES, IPC, PROVIDER_URLS, byokIdFromUrl, byokGroupIdFromUrl } from '../../shared/types';
import type { ByokConnectionProbe, ByokGroupSaveRequest, ByokInstanceSaveRequest, ByokModelsResult, ByokProviderType, ByokSettingsSnapshot, ByokTestResult } from '../../shared/types';
import { config, saveConfig } from '../config';
import type { ByokInstance } from '../configTypes';
import { maskToken, sendLog } from '../helpers';
import { callByokChat, listByokModels } from '../providers/byokClient';
import { getLangCache, localizeUserFacingError } from '../i18n';
import type { IpcContext } from './context';

// A probe is a foreground UI action; keep it snappier than a queued task.
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
      // Prune ids of keys that no longer exist so the UI's count/badges always
      // match real keys (delete cascade also strips these, this is a belt-and-braces).
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

// True when the url names a BYOK key that no longer exists, or a group that no
// longer exists / has no members left (unresolvable at run time).
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

// Command-free chat targets may point at a just-deleted key or emptied group;
// fall back to the app default ('') so bot messages never hit a dead target
// while the settings UI still shows a valid selection.
// A deleted key/group must not leave its id in the hidden lists: the entry is gone
// from the pickers anyway, and a stale id would only accumulate in the config file.
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

// The key input is blank when editing (write-only field); fall back to the
// instance's stored key so probes work without re-typing it.
function resolveProbeKey(req: ByokConnectionProbe): string {
  const typed = (req?.apiKey ?? '').trim();
  if (typed) return typed;
  const id = (req?.id ?? '').trim();
  if (!id) return '';
  return config.byokInstances.find((instance) => instance.id === id)?.apiKey ?? '';
}

export function registerByokHandlers(ctx: IpcContext): void {
  // Keys and groups double as Telegram '/name' commands; any rename/add/delete
  // must reach the '/' menu. Dispatch itself resolves live and needs no sync.
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
      : 'openai';
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
      // Keep-if-blank, matching UPDATE_EMAIL_CREDENTIALS: an edit that leaves
      // the key field empty must never wipe the stored key.
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

    // Cascade: a deleted key must not linger in any group's member list.
    let groupsChanged = false;
    for (const group of config.byokGroups) {
      const before = group.memberIds.length;
      group.memberIds = group.memberIds.filter((memberId) => memberId !== removed.id);
      if (group.memberIds.length !== before) groupsChanged = true;
    }

    // The active target is stranded when it was the deleted single key, or when it
    // is a group this deletion just emptied (an empty group is unresolvable at run
    // time). Both fall back to the default provider — matching the group-delete path
    // — so background/hotkey tasks reading config.targetUrl never hit a dead target.
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
    // A group with no (existing) members is useless and unresolvable at run time.
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
      // The active chat target just disappeared — fall back to the default provider.
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
