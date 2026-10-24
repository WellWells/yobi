import { ipcMain, app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { IPC } from '../../shared/types';
import type { ChatCommandResult, FlowBuildOutcome, FlowBuildRequestPayload, FlowDefinition, ScraperPickRequest, TriggerConfig } from '../../shared/types';
import { buildFlowExportPayload } from '../../shared/flowExport';
import { cleanTitle } from '../../shared/conversationTitle';
import { CHAT_MODEL_VARIABLE, builtinById, canonicalBuiltin, isDesktopBuiltinFlowId, siteActionId } from '../../shared/builtinFlows';
import { parseXMediaInput } from '../../shared/xMedia';
import { postCardForTurn } from '../../shared/postCard';
import { MP3_LABEL } from '../../shared/ytdl';
import { compactPreview } from '../../shared/textBudget';
import { config, saveConfig } from '../config';
import { buildSafeFileNameFromTitle, listOutputFiles } from '../files';
import { deliverCommandResultToTempChat, saveCommandOutput } from '../chat/commandOutput';
import { isTempChatMode } from '../tempChat';
import { sendLog, sendToRenderer, sendWebNotification } from '../helpers';
import { loadLanguageData, t } from '../i18n';
import { getCheckpointPath } from '../flow';
import { buildFailureText } from '../flow/flowBuildBroadcast';
import { previewSchedule } from '../flow/schedulePreview';
import { discoverFeeds } from '../urlParser';
import { pickSelector } from '../selectorPicker';
import { parseFlowSaveSource } from '../../shared/flowVersions';
import { registerFlowVersionHandlers } from './flowVersions';
import { showSaveDialogForWin } from './context';
import type { IpcContext } from './context';
import type { StepProgress } from '../../shared/stepProgress';
import { whileConversationBusy } from '../conversationBusy';
import { IMAGE_CHAT_FLOW_ID } from '../../shared/imageRequest';
import { runImageCommand } from '../chat/imageCommand';

function registerCheckpointHandlers(
  kind: 'rss' | 'scraper' | 'youtube_subs' | 'x_posts' | 'ptt_board',
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

  ipcMain.handle(IPC.FLOW_SAVE, async (_event, flow: FlowDefinition, source?: unknown, reviewed?: unknown) => {
    if (!flowManager) return null;
    // A chat-made flow's public-web-only mark is lifted only by the editor's own Save (the button or
    // its shortcut), with the flow in front of the owner. Run, Run all, the switch, rename and the
    // editor's auto-saves save too, and keep the mark the stored flow has; the renderer's copy is
    // never trusted for it.
    const { publicWebOnly: _publicWebOnly, ...owned } = flow;
    const marked = reviewed !== true && flowManager.getAll().some((stored) => stored.id === flow.id && stored.publicWebOnly === true);
    return flowManager.save(marked ? { ...owned, publicWebOnly: true } : owned, { source: parseFlowSaveSource(source) });
  });

  registerFlowVersionHandlers(ctx);

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

  const runFlowChatCommand = async (
    storedFlowId: string,
    command: string,
    input: string,
    conversationPath?: string,
    progressId?: string,
    modelUrl?: string,
  ): Promise<ChatCommandResult> => {
    const startedAt = Date.now();
    // A button from an older conversation may name X's built-in over a Threads, Instagram or
    // Facebook link: it runs that site's own.
    const flowId = typeof storedFlowId === 'string' ? canonicalBuiltin(storedFlowId, input ?? '') : storedFlowId;
    const failed = (error: string): ChatCommandResult => ({
      result: { flowId, success: false, outputs: {}, error, completedSteps: 0, totalSteps: 0, completedAt: new Date().toISOString() },
    });
    // A picture asked for that the chat's own send would not bring back: not a flow, one send that
    // draws, on the page the words name (Gemini when none).
    if (flowId === IMAGE_CHAT_FLOW_ID) {
      const outcome = await runImageCommand(flowManager ?? undefined, {
        prompt: (input ?? '').trim(),
        strings: (await loadLanguageData(config.locale)) ?? {},
        origin: 'app',
        ...(conversationPath ? { conversationPath } : {}),
      });
      if (!outcome.success) {
        const error = outcome.error ?? '';
        return { result: { ...failed(error).result, displayError: error } };
      }
      return {
        result: {
          flowId, success: true, outputs: {}, finalOutput: outcome.answer ?? '', completedSteps: 1, totalSteps: 1,
          completedAt: new Date().toISOString(), lastLlmProvider: outcome.providerLabel,
        },
        ...(outcome.filePath ? { filePath: outcome.filePath } : {}),
      };
    }
    if (!flowManager) return failed('FlowManager not available');

    const info = flowManager.getChatCommandInfo(flowId, command);
    const inputVariable = info?.inputVariable ?? 'input';
    const inputPreview = (input ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    sendLog(`💬 [Flow] Chat command /${info?.command || command} → {{${inputVariable}}}="${inputPreview}"`);
    const onProgress = typeof progressId === 'string' && progressId
      ? (progress: StepProgress) => sendToRenderer(IPC.FLOW_CHAT_COMMAND_PROGRESS, { progressId, progress })
      : undefined;
    const vars: Record<string, string> = { [inputVariable]: input ?? '' };
    // A built-in's model call follows the model the chat has picked; a flow's own steps name theirs.
    const chatModel = typeof modelUrl === 'string' ? modelUrl.trim() : '';
    if (isDesktopBuiltinFlowId(flowId) && chatModel) vars[CHAT_MODEL_VARIABLE] = chatModel;
    const { result } = flowManager.queueExecutionWithId(flowId, vars, 'chat', onProgress);
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
      const flow = flowManager.flowById(flowId);
      // A built-in's command is its id, which is what its turn's buttons send back.
      const builtin = isDesktopBuiltinFlowId(flowId);
      const resolvedCommand = builtin ? flowId : info?.command || command || '';
      // A pasted link (or a button under one) is shown as the user typed it — no command was
      // typed — and a shown post is kept so its "analyze" button can run the analysis of it.
      const shown = builtinById(flowId);
      const xPost = shown?.action === 'post' ? parseXMediaInput(input ?? '')?.url : undefined;
      const saveId = shown?.action === 'post' ? siteActionId(shown.site, 'save') : null;
      const audioId = shown?.action === 'post' ? siteActionId(shown.site, 'audioChat') : null;
      const markdownOptions = {
        prompt: builtin ? (input ?? '').trim() : `/${resolvedCommand}${input ? ` ${input}` : ''}`.trim(),
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

      // A button sends the command again: its whole line is stored, so pressing it later still
      // names the command even if the flow has been renamed since.
      const chatMedia = flowResult.chatMedia ?? [];
      const buttons = resolvedCommand
        ? (flowResult.buttons ?? []).map((b) => ({ l: b.label, i: `/${resolvedCommand} ${b.input}`, ...(b.image ? { p: b.image } : {}) }))
        : [];
      // The post's media is only in the chat's cache: "download" saves it where downloads go, and
      // a video's "MP3" its sound. A menu (a person's stories) shows a picture only, and its own
      // buttons are the downloads.
      if (xPost && saveId && chatMedia.length > 0 && buttons.length === 0) {
        buttons.push({ l: t(langData ?? {}, 'x.download.button'), i: `/${saveId} ${xPost}` });
        if (audioId && chatMedia.some((file) => /\.mp4$/i.test(file))) buttons.push({ l: MP3_LABEL, i: `/${audioId} ${xPost}` });
      }
      const files = flowResult.savedFiles ?? [];
      const postCard = postCardForTurn(flowResult.postCard, markdownOptions.response);
      if (isTempChatMode()) {
        deliverCommandResultToTempChat({
          markdownOptions,
          prompt: markdownOptions.prompt,
          response: markdownOptions.response,
          providerLabel: markdownOptions.provider,
          ...(resolvedCommand ? { command: resolvedCommand } : {}),
          ...(flowResult.tokenUsage ? { usage: flowResult.tokenUsage } : {}),
          ...(buttons.length > 0 ? { buttons } : {}),
          ...(files.length > 0 ? { files } : {}),
          ...(chatMedia.length > 0 ? { chatMedia } : {}),
          ...(xPost ? { xPost } : {}),
          ...(postCard ? { postCard } : {}),
          startedAt,
        });
        return { result: flowResult };
      }

      const filePath = await saveCommandOutput({
        conversationPath,
        markdownOptions,
        prompt: markdownOptions.prompt,
        response: markdownOptions.response,
        providerLabel: markdownOptions.provider,
        // Badged like the temporary-chat path: the recap reads `c` to pass over a flow's turn.
        ...(resolvedCommand ? { command: resolvedCommand } : {}),
        usage: flowResult.tokenUsage,
        ...(buttons.length > 0 ? { buttons } : {}),
        ...(files.length > 0 ? { files } : {}),
        ...(chatMedia.length > 0 ? { chatMedia } : {}),
        ...(xPost ? { xPost } : {}),
        ...(postCard ? { postCard } : {}),
        startedAt,
      });
      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return { result: flowResult, filePath };
    } catch (err: unknown) {
      sendLog(`⚠️ [Flow] Failed to save chat-skill result: ${err instanceof Error ? err.message : String(err)}`);
      return { result: flowResult };
    }
  };

  // Busy until the result is written: it lands in this conversation.
  ipcMain.handle(IPC.FLOW_RUN_CHAT_COMMAND, (
    _event,
    storedFlowId: string,
    command: string,
    input: string,
    conversationPath?: string,
    progressId?: string,
    modelUrl?: string,
  ): Promise<ChatCommandResult> => whileConversationBusy(
    conversationPath,
    'flowCommand',
    () => runFlowChatCommand(storedFlowId, command, input, conversationPath, progressId, modelUrl),
  ));

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
    // gets no notification — only an outcome the user has stopped watching for does. A failure
    // says where it stopped and why, in the same words as the build panel.
    if (result.status === 'failed') {
      const strings = langData ?? {};
      const displayError = compactPreview(buildFailureText(result, strings), 140);
      const body = t(strings, 'flow.generate.failed.body', {
        phase: t(strings, `flow.build.phase.${result.phase}`),
        error: displayError,
      });
      sendWebNotification(t(strings, 'flow.generate.failed.title'), body, 'error');
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

  ipcMain.handle(IPC.FLOW_WATCH_MISSING_GET, () => flowManager?.getWatchMissing() ?? []);

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
  registerCheckpointHandlers('x_posts', IPC.X_POSTS_HAS_CHECKPOINT, IPC.X_POSTS_CLEAR_CHECKPOINT, 'X Posts');
  registerCheckpointHandlers('ptt_board', IPC.PTT_BOARD_HAS_CHECKPOINT, IPC.PTT_BOARD_CLEAR_CHECKPOINT, 'PTT Board');
}
