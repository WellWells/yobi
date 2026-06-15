import type { BrowserWindow } from 'electron';
import type { CaptureFormat, CardTheme, FlowExecutionLog, MarkdownCapturePayload } from '../../shared/types';

export type LogCallback = (log: FlowExecutionLog) => void;

export interface SaveHistoryInfo {
  prompt: string;
  response: string;
  providerLabel: string;
}

export interface FlowExecutorDeps {
  getWorkerWin: () => BrowserWindow | null;
  ensureWorkerWin?: () => Promise<BrowserWindow | null>;
  getTargetUrl: () => string;
  getResponseTimeoutMs?: () => number;
  onSaveHistory?: (info: SaveHistoryInfo) => Promise<void>;
  sendTelegramMessage?: (chatId: number, text: string) => Promise<void>;
  getPairedUsers?: () => Array<{ userId: number; username?: string; firstName?: string }>;
  captureMarkdown?: (
    payload: MarkdownCapturePayload,
    format: CaptureFormat,
    background: string,
    options?: {
      fileName?: string;
      showProvider?: boolean;
      showTimestamp?: boolean;
      showPrompt?: boolean;
      showContent?: boolean;
      cardTheme?: CardTheme;
    },
  ) => Promise<string>;
  captureScreen?: (format: 'png' | 'jpg', targetDir?: string) => Promise<string>;
  sendTelegramFile?: (
    chatId: number,
    filePath: string,
    sendAs: 'photo' | 'document' | 'auto',
    caption?: string,
    authorizedPaths?: string[],
  ) => Promise<void>;
}
