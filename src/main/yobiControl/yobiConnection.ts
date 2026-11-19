/**
 * Builds the live, in-process Yobi Control connection: the flows, models, conversations, statistics
 * and updater of this app behind an MCP server linked to an SDK Client. Loaded lazily by the registry.
 */
import * as path from 'node:path';
import {
  IPC, PROVIDERS, PROVIDER_LABELS, PROVIDER_URLS, buildByokGroupUrl, buildByokUrl, isModelUrlHidden,
} from '../../shared/types';
import type { BotPlatform } from '../../shared/types';
import { setChatTarget } from '../chatTarget';
import { config, getHiddenSources, saveConfig } from '../config';
import { applyLinkAnalysis } from '../ipc/settingsApply';
import { buildSettingsCatalog } from './yobiSettingsCatalog';
import { planSettings } from './yobiSettings';
import { setYobiSettingsPrecheck } from '../flow/agent/connectors/yobiContract';
import { getOutputDir, listOutputFiles } from '../files';
import { resetFlowMetrics } from '../flowMetrics';
import { previewSchedule } from '../flow/schedulePreview';
import { describeSchedule } from '../../shared/flowScheduleSummary';
import { getEnCache, t } from '../i18n';
import { relaunchApp, sendLog, sendToRenderer } from '../helpers';
import { moveToTrash } from '../ipc/conversationTrash';
import { connectInProcess, ToolError, type InProcessConnection } from '../mcp/inProcessServer';
import { resetMetrics } from '../metrics';
import { getAppVersion } from '../appVersion';
import { testByokKeys } from '../byokKeyTest';
import { checkForUpdates, installUpdate, updateState } from '../updater';
import { getYobiControlHost, type YobiControlHost } from './yobiControlHost';
import { createYobiMcpServer, type ModelChoice, type ModelTarget, type YobiControlDeps } from './yobiMcpServer';

/** A bot model target and the platform whose `llmDirect` it is. */
const BOT_TARGETS: Readonly<Partial<Record<ModelTarget, BotPlatform>>> = {
  telegram: 'telegram',
  line: 'line',
  line_pc: 'lineSelf',
  discord: 'discord',
  slack: 'slack',
};

/** Polled while waiting to restart: a task finishing is noticed within this. */
const IDLE_POLL_MS = 2_000;
/** After the last task ends: the answer that asked for the restart is still being sent. */
const IDLE_GRACE_MS = 3_000;
/** A task that never ends does not hold the restart for good. */
const IDLE_WAIT_MAX_MS = 10 * 60_000;

let restartScheduled = false;

function host(): YobiControlHost {
  const live = getYobiControlHost();
  if (!live) throw new ToolError('not_ready', 'Yobi is still starting. Try again in a moment.');
  return live;
}

/** Runs `action` once no task is running or waiting (or the wait gives up), once per app run. */
function whenIdle(reason: string, action: () => void): void {
  if (restartScheduled) return;
  restartScheduled = true;
  const startedAt = Date.now();
  sendLog(`🔄 ${reason} once running tasks finish`);
  const tick = (): void => {
    const busy = (getYobiControlHost()?.queueSize() ?? 0) > 0;
    if (busy && Date.now() - startedAt < IDLE_WAIT_MAX_MS) {
      setTimeout(tick, IDLE_POLL_MS).unref?.();
      return;
    }
    setTimeout(action, IDLE_GRACE_MS).unref?.();
  };
  setTimeout(tick, IDLE_POLL_MS).unref?.();
}

function modelChoices(): ModelChoice[] {
  const hidden = getHiddenSources();
  const choices: ModelChoice[] = [
    ...PROVIDERS.map((provider) => ({ id: provider, label: PROVIDER_LABELS[provider], url: PROVIDER_URLS[provider] })),
    ...config.byokInstances.map((key) => ({ id: `byok:${key.id}`, label: key.name || key.model || key.id, url: buildByokUrl(key.id) })),
    ...config.byokGroups.map((group) => ({ id: `byokgroup:${group.id}`, label: group.name || group.id, url: buildByokGroupUrl(group.id) })),
  ];
  return choices.filter((choice) => !isModelUrlHidden(choice.url, hidden));
}

function modelSettings(): Partial<Record<ModelTarget, string>> {
  const settings: Partial<Record<ModelTarget, string>> = {
    chat: config.targetUrl,
    flow_build: config.flowGenerateUrl,
    maps_analysis: config.linkAnalysis?.mapsTargetUrl ?? '',
    article_analysis: config.linkAnalysis?.articleTargetUrl ?? '',
  };
  for (const [target, platform] of Object.entries(BOT_TARGETS)) {
    const direct = config[platform]?.llmDirect;
    if (direct) settings[target as ModelTarget] = direct.targetUrl;
  }
  return settings;
}

function setModel(target: ModelTarget, url: string): void {
  if (target === 'chat') {
    setChatTarget(url);
    return;
  }
  if (target === 'flow_build') {
    config.flowGenerateUrl = url;
    saveConfig({ flowGenerateUrl: url });
  } else if (target === 'maps_analysis' || target === 'article_analysis') {
    applyLinkAnalysis({ ...config.linkAnalysis, [target === 'maps_analysis' ? 'mapsTargetUrl' : 'articleTargetUrl']: url });
    sendToRenderer(IPC.SETTINGS_CHANGED);
  } else {
    const platform = BOT_TARGETS[target];
    if (!platform) return;
    config[platform].llmDirect = { targetUrl: url };
    saveConfig({ [platform]: config[platform] });
  }
  sendLog(`🌐 Default model of ${target} set from the Yobi connector`);
}

const deps: YobiControlDeps = {
  now: () => new Date(),
  version: getAppVersion,
  listFlows: () => host().listFlows(),
  nextRuns: (trigger, count) => previewSchedule(trigger, count).runs,
  describeSchedule: (trigger) => describeSchedule(trigger, (key) => t(getEnCache(), key)),
  setFlowsEnabled: (ids, enabled) => host().setFlowsEnabled(ids, enabled),
  modelChoices,
  modelSettings,
  setModel,
  listConversations: async () => {
    const dir = await getOutputDir();
    return (await listOutputFiles()).map((file) => ({ ...file, id: path.relative(dir, file.path).split(path.sep).join('/') }));
  },
  trashConversations: async (files) => {
    const result = await moveToTrash(files.map((file) => file.path));
    return { moved: result.trashIds.length, failed: result.failed.length, busy: result.busy.length };
  },
  updateState,
  checkForUpdates: async () => {
    await checkForUpdates();
  },
  scheduleInstall: () => {
    if (updateState().state !== 'downloaded') return false;
    whenIdle('Installing the update', () => {
      if (!installUpdate()) restartScheduled = false;
    });
    return true;
  },
  scheduleRestart: () => whenIdle('Restarting Yobi', () => relaunchApp('Yobi connector')),
  resetStatistics: () => {
    sendLog('📊 Usage statistics cleared (Yobi connector)');
    resetFlowMetrics();
    resetMetrics();
  },
  queueSize: () => getYobiControlHost()?.queueSize() ?? 0,
  apiKeys: () => config.byokInstances.map(({ id, name, model }) => ({ id, name, model })),
  testApiKeys: async (ids) => {
    const results = await testByokKeys(ids);
    sendLog(`🔑 API keys tested from the Yobi connector: ${results.filter((result) => result.outcome.ok).length}/${results.length} working`);
    return results.map(({ id, name, model, outcome }) => ({ id, name, model, ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) }));
  },
  settingsCatalog: buildSettingsCatalog,
  settingsChanged: (ids) => {
    sendLog(`⚙️ Settings changed from the Yobi connector: ${ids.join(', ')}`);
    sendToRenderer(IPC.SETTINGS_CHANGED);
  },
};

export async function connectYobiMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  setYobiSettingsPrecheck(async (args) => planSettings(await buildSettingsCatalog(), args).refusal);
  return connectInProcess(createYobiMcpServer(deps), clientName, clientVersion);
}
