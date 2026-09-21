import { ipcMain, app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { IPC } from '../../shared/types';
import type { ChatCommandResult, FlowBuildOutcome, FlowBuildRequestPayload, FlowDefinition, ScraperPickRequest, TriggerConfig } from '../../shared/types';
import { buildFlowExportPayload } from '../../shared/flowExport';
import { cleanTitle } from '../../shared/conversationTitle';
import { config, saveConfig } from '../config';
import { buildSafeFileNameFromTitle, listOutputFiles } from '../files';
import { deliverCommandResultToTempChat, saveCommandOutput } from '../chat/commandOutput';
import { isTempChatMode } from '../tempChat';
import { sendLog, sendToRenderer, sendWebNotification } from '../helpers';
import { loadLanguageData } from '../i18n';
import { getCheckpointPath } from '../flow';
import { previewSchedule } from '../flow/schedulePreview';
import { discoverFeeds } from '../urlParser';
import { pickSelector } from '../selectorPicker';
import { showSaveDialogForWin } from './context';
import type { IpcContext } from './context';

function registerCheckpointHandlers(
  kind: 'rss' | 'scraper' | 'youtube_subs',
  hasChannel: string,
  clearChannel: string,
  logTag: string,
): void {
  ipcMain.handle(hasChannel, async (_event, stepId: string) => {
    try {
      await fs.access(getCheckpointPath(kind, stepId));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(clearChannel, async (_event, stepId: string) => {
    try {
      await fs.unlink(getCheckpointPath(kind, stepId));
      sendLog(`📡 [Flow] ${logTag} checkpoint cleared for step: ${stepId}`);
      return true;
    } catch {
      return false;
    }
  });
}

export function registerFlowHandlers(ctx: IpcContext): void {
  const { flowManager } = ctx;

  ipcMain.handle(IPC.FLOW_GET_ALL, () => {
    return flowManager?.getAll() ?? [];
  });

  ipcMain.handle(IPC.FLOW_SAVE, async (_event, flow: FlowDefinition) => {
    if (!flowManager) return null;
    return flowManager.save(flow);
  });

  ipcMain.handle(IPC.FLOW_DELETE, async (_event, flowId: string) => {
    if (!flowManager) return false;
    return flowManager.delete(flowId);
  });

  ipcMain.handle(IPC.FLOW_DELETE_MANY, async (_event, flowIds: string[]) => {
    if (!flowManager) return false;
    return flowManager.deleteMany(flowIds);
  });

  ipcMain.handle(IPC.FLOW_SET_ENABLED_MANY, async (_event, flowIds: string[], enabled: boolean) => {
    if (!flowManager) return [];
    return flowManager.setEnabledMany(flowIds, enabled);
  });

  ipcMain.handle(IPC.FLOW_DUPLICATE, async (_event, flowId: string) => {
    if (!flowManager) return null;
    return flowManager.duplicate(flowId);
  });

  ipcMain.handle(IPC.FLOW_MOVE, async (_event, flowId: string, direction: 'up' | 'down') => {
    if (!flowManager) return [];
    return flowManager.move(flowId, direction);
  });

  ipcMain.handle(IPC.FLOW_REORDER, async (_event, orderedIds: string[]) => {
    if (!flowManager) return [];
    return flowManager.reorder(orderedIds);
  });

  ipcMain.handle(IPC.FLOW_EXECUTE, async (_event, flowId: string) => {
    if (!flowManager) return { flowId, success: false, outputs: {}, error: 'FlowManager not available', completedSteps: 0, totalSteps: 0, completedAt: new Date().toISOString() };
    return flowManager.queueExecution(flowId);
  });

  ipcMain.handle(IPC.FLOW_RUN_CHAT_COMMAND, async (
    _event,
    flowId: string,
    command: string,
    input: string,
    conversationPath?: string,
  ): Promise<ChatCommandResult> => {
    const failed = (error: string): ChatCommandResult => ({
      result: { flowId, success: false, outputs: {}, error, completedSteps: 0, totalSteps: 0, completedAt: new Date().toISOString() },
    });
    if (!flowManager) return failed('FlowManager not available');

    const info = flowManager.getChatCommandInfo(flowId, command);
    const inputVariable = info?.inputVariable ?? 'input';
    const inputPreview = (input ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    sendLog(`💬 [Flow] Chat command /${info?.command || command} → {{${inputVariable}}}="${inputPreview}"`);
    const { result } = flowManager.queueExecutionWithId(flowId, { [inputVariable]: input ?? '' }, 'chat');
    const flowResult = await result;

    const finalOutput = (flowResult.finalOutput ?? '').trim();
    if (!flowResult.success || !finalOutput) {
      sendLog(flowResult.success
        ? `⚠️ [Flow] Chat command /${info?.command || command} produced no final output — nothing to show in chat`
        : `❌ [Flow] Chat command /${info?.command || command} failed: ${flowResult.error ?? 'unknown error'}`);
      return { result: flowResult };
    }

    try {
      const langData = await loadLanguageData(config.locale);
      const flow = flowManager.getAll().find((f) => f.id === flowId);
      const resolvedCommand = info?.command || command || '';
      const markdownOptions = {
        prompt: `/${resolvedCommand}${input ? ` ${input}` : ''}`.trim(),
        response: finalOutput,
        title: cleanTitle(flowResult.titleHint ?? '')
          || cleanTitle(flow?.name ?? '')
          || (langData?.['flow.trigger.chat'] ?? 'Chat Skill'),
        provider: flowResult.lastLlmProvider || (langData?.['chat.command.providerLabel'] ?? 'Flow'),
        providerLabel: langData?.['md.provider'] ?? 'Provider',
        promptLabel: langData?.['md.prompt'] ?? 'Prompt',
        responseLabel: langData?.['md.response'] ?? 'Response',
        timestampLabel: langData?.['md.timestamp'] ?? 'Time',
      };

      if (isTempChatMode()) {
        deliverCommandResultToTempChat({
          markdownOptions,
          prompt: markdownOptions.prompt,
          response: markdownOptions.response,
          providerLabel: markdownOptions.provider,
          ...(resolvedCommand ? { command: resolvedCommand } : {}),
          ...(flowResult.tokenUsage ? { usage: flowResult.tokenUsage } : {}),
        });
        return { result: flowResult };
      }

      const filePath = await saveCommandOutput({
        conversationPath,
        markdownOptions,
        prompt: markdownOptions.prompt,
        response: markdownOptions.response,
        providerLabel: markdownOptions.provider,
        usage: flowResult.tokenUsage,
      });
      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return { result: flowResult, filePath };
    } catch (err: unknown) {
      sendLog(`⚠️ [Flow] Failed to save chat-skill result: ${err instanceof Error ? err.message : String(err)}`);
      return { result: flowResult };
    }
  });

  ipcMain.handle(IPC.FLOW_ABORT, async (_event, flowId: string) => {
    if (!flowManager) return false;
    return flowManager.abort(flowId);
  });

  ipcMain.handle(IPC.FLOW_GENERATE, async (_event, request: FlowBuildRequestPayload): Promise<FlowBuildOutcome> => {
    if (!flowManager) return { status: 'failed', phase: 'understand', error: 'FlowManager not available' };
    const desc = (request?.description ?? '').trim();
    if (!desc) return { status: 'failed', phase: 'understand', error: 'Empty description' };

    // Remembered before the build runs, so the choice sticks even if this one fails.
    const providerUrl = (request.providerUrl ?? '').trim();
    if (providerUrl !== config.flowGenerateUrl) {
      config.flowGenerateUrl = providerUrl;
      saveConfig({ flowGenerateUrl: providerUrl });
    }

    const langData = await loadLanguageData(config.locale);
    const queueLabel = langData?.['flow.generate.queueLabel'] ?? 'AI Flow';
    const result = await flowManager.queueBuild(desc, {
      buildId: (request.buildId ?? '').trim() || 'flow-build',
      queueLabel,
      ...(providerUrl ? { providerUrl } : {}),
      ...(request.answers?.length ? { answers: request.answers } : {}),
    });

    // A question is the build working as intended and the panel is already showing it, so it
    // gets no notification — only an outcome the user has stopped watching for does.
    if (result.status === 'failed') {
      const compactError = result.error.replace(/\s+/g, ' ').trim();
      const displayError = compactError.length > 140 ? `${compactError.slice(0, 140)}…` : compactError;
      const title = langData?.['flow.generate.failed.title'] ?? 'AI generation failed';
      const body = (langData?.['flow.generate.failed.body']
        ?? 'The AI response could not be parsed into a valid flow. Please try again. ({{error}})')
        .replace(/\{\{error\}\}/g, () => displayError);
      sendWebNotification(title, body, 'error');
    } else if (result.status === 'created') {
      const title = langData?.['flow.generate.done.title'] ?? 'Flow generated';
      const body = (langData?.['flow.generate.done.body']
        ?? 'AI created the flow {{name}}. Review and enable it when ready.')
        .replace(/\{\{name\}\}/g, () => result.flow.name);
      sendWebNotification(title, body, 'success');
    }
    return result;
  });

  ipcMain.handle(IPC.FLOW_GET_AI_URL, () => config.flowGenerateUrl);

  ipcMain.handle(IPC.FLOW_PREVIEW_SCHEDULE, (_event, trigger: TriggerConfig) => {
    return previewSchedule(trigger);
  });

  ipcMain.handle(IPC.FLOW_EXPORT, async (_event, flow: FlowDefinition) => {
    try {
      const safeName = buildSafeFileNameFromTitle(flow.name || 'flow');
      const defaultPath = path.join(app.getPath('documents'), `${safeName}.json`);
      const result = await showSaveDialogForWin(ctx.getMainWin(), {
        defaultPath,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return false;
      const payload = buildFlowExportPayload(flow);
      await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown export error';
      sendLog(`⚠️ Failed to export flow: ${message}`);
      return false;
    }
  });

  ipcMain.handle(IPC.FLOW_EXPORT_RESULT, async (_event, payload: { content: string; defaultFileName: string }) => {
    try {
      const rawName = buildSafeFileNameFromTitle(payload?.defaultFileName || 'flow-result');
      const fileName = rawName.toLowerCase().endsWith('.md') ? rawName : `${rawName}.md`;
      const defaultPath = path.join(app.getPath('documents'), fileName);
      const result = await showSaveDialogForWin(ctx.getMainWin(), {
        defaultPath,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, payload?.content ?? '', 'utf-8');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown export error';
      sendLog(`⚠️ Failed to export flow result: ${message}`);
      return false;
    }
  });

  ipcMain.handle(IPC.RSS_DISCOVER_FEED, async (_event, siteUrl: string) => {
    try {
      return await discoverFeeds(siteUrl ?? '');
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC.SCRAPER_PICK_SELECTOR, async (_event, args: ScraperPickRequest) => {
    try {
      return await pickSelector(args);
    } catch (err: unknown) {
      sendLog(`⚠️ [Flow] Selector picker failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  registerCheckpointHandlers('rss', IPC.RSS_HAS_CHECKPOINT, IPC.RSS_CLEAR_CHECKPOINT, 'RSS');
  registerCheckpointHandlers('scraper', IPC.SCRAPER_HAS_CHECKPOINT, IPC.SCRAPER_CLEAR_CHECKPOINT, 'Scraper');
  registerCheckpointHandlers('youtube_subs', IPC.YT_SUBS_HAS_CHECKPOINT, IPC.YT_SUBS_CLEAR_CHECKPOINT, 'YT Subs');
}
