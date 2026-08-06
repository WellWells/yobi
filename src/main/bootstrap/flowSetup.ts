import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { DEFAULT_CAPTURE_WIDTH, IPC } from '../../shared/types';
import type { QueueState } from '../../shared/types';
import { config } from '../config';
import { sendToRenderer } from '../helpers';
import { getWorkerWin, ensureWorkerWindow } from '../windows';
import { captureMarkdownDocument } from '../capture';
import { zipSingleFile } from '../captureClipboard';
import { captureScreenToFile } from '../screenCapture';
import { createPaste } from '../share/privatebin';
import { saveOutput } from '../output';
import {
  listOutputFiles,
  getOutputDir,
  buildSafeFileNameFromTitle,
  buildSnapshotFileName,
  getUniquePath,
} from '../files';
import { loadLanguageData } from '../i18n';
import { FlowManager } from '../flow';
import type { QueueManager } from '../queueManager';
import type { TelegramRuntime } from '../telegram';
import type { LineRuntime } from '../line';

export function broadcastMergedQueueState(queue: QueueManager, flowManager: FlowManager | null): void {
  const promptState = queue.getState();
  const flowItems = flowManager?.getPendingQueueItems() ?? [];
  if (flowItems.length === 0) {
    sendToRenderer(IPC.QUEUE_UPDATE, promptState);
    sendToRenderer(IPC.STATUS, promptState.status);
    return;
  }
  const allItems = [...promptState.items, ...flowItems];
  const anyRunning = allItems.some((i) => i.status === 'running');
  const merged: QueueState = {
    total: allItems.length,
    current: anyRunning ? 1 : 0,
    status: anyRunning ? 'processing' : 'idle',
    items: allItems,
  };
  sendToRenderer(IPC.QUEUE_UPDATE, merged);
  sendToRenderer(IPC.STATUS, merged.status);
}

export function initFlowManager(deps: {
  queue: QueueManager;
  telegramRuntime: TelegramRuntime;
  lineRuntime: LineRuntime;
}): FlowManager {
  const { queue, telegramRuntime, lineRuntime } = deps;

  const flowManager = new FlowManager({
    getWorkerWin,
    ensureWorkerWin: () => ensureWorkerWindow(config.targetUrl),
    getTargetUrl: () => config.targetUrl,
    getResponseTimeoutMs: () => config.responseTimeout,
    sendTelegramMessage: async (chatId, text) => {
      await telegramRuntime.sendProactive(chatId, text);
    },
    sendTelegramFile: async (chatId, filePath, sendAs, caption, authorizedPaths) => {
      await telegramRuntime.sendProactiveFile(chatId, filePath, sendAs, caption, authorizedPaths);
    },
    sendLineMessage: async (userId, text) => {
      await lineRuntime.sendProactive(userId, text);
    },
    sendLineImage: async (userId, imageUrl) => {
      await lineRuntime.sendProactiveImage(userId, imageUrl);
    },
    getLinePairedUsers: () => config.line.pairing.pairedUsers,
    captureMarkdown: async (payload, format, background, options) => {
      const requestedFileName = (options?.fileName ?? '').trim();
      const fileStem = requestedFileName ? buildSafeFileNameFromTitle(requestedFileName) : buildSnapshotFileName();
      const resultDoc = await captureMarkdownDocument({
        payload,
        options: {
          mode: 'save',
          format,
          fileName: fileStem,
          showPrompt: options?.showPrompt ?? false,
          showContent: options?.showContent ?? true,
          showProvider: options?.showProvider ?? false,
          showTimestamp: options?.showTimestamp ?? false,
          showTokens: false,
          cardLayout: 'document',
          pixelRatio: 1,
          zip: options?.zip === true,
          width: options?.width ?? DEFAULT_CAPTURE_WIDTH,
          background,
          cardTheme: options?.cardTheme ?? 'dark',
        },
      });
      const outputDir = await getOutputDir();
      const wantsZip = options?.zip === true;
      const filePath = await getUniquePath(
        path.join(outputDir, `${fileStem}.${wantsZip ? 'zip' : resultDoc.ext}`),
        '',
      );
      await fs.writeFile(
        filePath,
        wantsZip ? zipSingleFile(resultDoc.buffer, `${fileStem}.${resultDoc.ext}`) : resultDoc.buffer,
      );
      return filePath;
    },
    captureScreen: (format, targetDir) => captureScreenToFile(format, targetDir),
    getShareSettings: () => config.share,
    createShareLink: (markdown, opts) => createPaste(config.share.instanceUrl, markdown, opts),
    getPairedUsers: () => config.telegram.pairing.pairedUsers,
    onSaveHistory: async ({ prompt, response, providerLabel }) => {
      const outputDir = await getOutputDir();
      const langData = await loadLanguageData(config.locale);
      const providerHeaderLabel = langData?.['md.provider'] ?? 'Provider';
      const promptLabel = langData?.['md.prompt'] ?? 'Prompt';
      const responseLabel = langData?.['md.response'] ?? 'Response';
      const timestampLabel = langData?.['md.timestamp'] ?? 'Time';
      const fallbackTitle = prompt.trim().replace(/\s+/g, ' ').slice(0, 70);
      await saveOutput({
        prompt,
        response,
        outputDir,
        title: fallbackTitle || 'Flow',
        provider: providerLabel,
        promptLabel,
        responseLabel,
        timestampLabel,
        providerLabel: providerHeaderLabel,
      });
      const files = await listOutputFiles();
      sendToRenderer(IPC.FILE_LIST, files);
    },
  });

  flowManager.setQueueChangeCallback(() => {
    broadcastMergedQueueState(queue, flowManager);
  });

  flowManager.setOnBotCommandsChanged(() => {
    void telegramRuntime.refreshBotCommands();
  });

  void flowManager.init().then(() => {
    if (flowManager.getBotCommands().length > 0) {
      void telegramRuntime.refreshBotCommands();
    }
  });

  return flowManager;
}
