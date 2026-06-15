import { ipcMain, app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { IPC } from '../../shared/types';
import type { ChatCommandResult, FlowDefinition, FlowGenerationResult } from '../../shared/types';
import { config } from '../config';
import { buildSafeFileNameFromTitle, getOutputDir, listOutputFiles } from '../files';
import { saveOutput } from '../output';
import { sendLog, sendToRenderer, sendWebNotification } from '../helpers';
import { loadLanguageData } from '../i18n';
import { getCheckpointPath } from '../flow';
import { discoverFeeds } from '../urlParser';
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
      sendLog(`📡 [AgentFlow] ${logTag} checkpoint cleared for step: ${stepId}`);
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

  ipcMain.handle(IPC.FLOW_RUN_CHAT_COMMAND, async (_event, flowId: string, command: string, input: string): Promise<ChatCommandResult> => {
    const failed = (error: string): ChatCommandResult => ({
      result: { flowId, success: false, outputs: {}, error, completedSteps: 0, totalSteps: 0, completedAt: new Date().toISOString() },
    });
    if (!flowManager) return failed('FlowManager not available');

    const info = flowManager.getChatCommandInfo(flowId, command);
    const inputVariable = info?.inputVariable ?? 'input';
    const { result } = flowManager.queueExecutionWithId(flowId, { [inputVariable]: input ?? '' }, 'chat');
    const flowResult = await result;

    const finalOutput = (flowResult.finalOutput ?? '').trim();
    if (!flowResult.success || !finalOutput) {
      return { result: flowResult };
    }

    try {
      const outputDir = await getOutputDir();
      const langData = await loadLanguageData(config.locale);
      const flow = flowManager.getAll().find((f) => f.id === flowId);
      const resolvedCommand = info?.command || command || '';
      const filePath = await saveOutput({
        prompt: `/${resolvedCommand}${input ? ` ${input}` : ''}`.trim(),
        response: finalOutput,
        outputDir,
        title: flow?.name?.trim() || (langData?.['agentflow.trigger.chat'] ?? 'Chat Skill'),
        provider: langData?.['chat.command.providerLabel'] ?? 'AgentFlow',
        providerLabel: langData?.['md.provider'] ?? 'Provider',
        promptLabel: langData?.['md.prompt'] ?? 'Prompt',
        responseLabel: langData?.['md.response'] ?? 'Response',
        timestampLabel: langData?.['md.timestamp'] ?? 'Time',
      });
      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return { result: flowResult, filePath };
    } catch (err: unknown) {
      sendLog(`⚠️ [AgentFlow] Failed to save chat-skill result: ${err instanceof Error ? err.message : String(err)}`);
      return { result: flowResult };
    }
  });

  ipcMain.handle(IPC.FLOW_ABORT, async (_event, flowId: string) => {
    if (!flowManager) return false;
    return flowManager.abort(flowId);
  });

  ipcMain.handle(IPC.FLOW_GENERATE, async (_event, description: string): Promise<FlowGenerationResult> => {
    if (!flowManager) return { ok: false, error: 'FlowManager not available' };
    const desc = (description ?? '').trim();
    if (!desc) return { ok: false, error: 'Empty description' };

    const langData = await loadLanguageData(config.locale);
    const queueLabel = langData?.['agentflow.generate.queueLabel'] ?? 'AI Flow';
    const result = await flowManager.queueGeneration(desc, queueLabel);

    if (!result.ok) {
      const title = langData?.['agentflow.generate.failed.title'] ?? 'AI generation failed';
      const body = langData?.['agentflow.generate.failed.body']
        ?? 'The AI response could not be parsed into a valid flow.';
      sendWebNotification(title, body, 'error');
    } else {
      const title = langData?.['agentflow.generate.done.title'] ?? 'Flow generated';
      const body = (langData?.['agentflow.generate.done.body']
        ?? 'AI created the flow {{name}}. Review and enable it when ready.')
        .replace(/\{\{name\}\}/g, () => result.flow.name);
      sendWebNotification(title, body, 'success');
    }
    return result;
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
      const payload = { type: 'agentflow-export', version: 1, flow };
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

  registerCheckpointHandlers('rss', IPC.RSS_HAS_CHECKPOINT, IPC.RSS_CLEAR_CHECKPOINT, 'RSS');
  registerCheckpointHandlers('scraper', IPC.SCRAPER_HAS_CHECKPOINT, IPC.SCRAPER_CLEAR_CHECKPOINT, 'Scraper');
  registerCheckpointHandlers('youtube_subs', IPC.YT_SUBS_HAS_CHECKPOINT, IPC.YT_SUBS_CLEAR_CHECKPOINT, 'YT Subs');
}
