import type { BrowserWindow } from 'electron';
import type {
  AgentStageLabel, CaptureFormat, CardTheme, FlowExecutionLog, MarkdownCapturePayload,
  ShareExpire, ShareSettings,
} from '../../shared/types';

export type LogCallback = (log: FlowExecutionLog) => void;

export interface SaveHistoryInfo {
  prompt: string;
  response: string;
  providerLabel: string;
}

export interface FlowExecutorDeps {
  getWorkerWin: () => BrowserWindow | null;
  onStage?: (label: AgentStageLabel, detail?: string) => void;
  ensureWorkerWin?: () => Promise<BrowserWindow | null>;
  getTargetUrl: () => string;
  getResponseTimeoutMs?: () => number;
  onSaveHistory?: (info: SaveHistoryInfo) => Promise<void>;
  sendTelegramMessage?: (chatId: number, text: string) => Promise<void>;
  getPairedUsers?: () => Array<{ userId: number; username?: string; firstName?: string }>;
  sendLineMessage?: (userId: string, text: string) => Promise<void>;
  sendLineImage?: (userId: string, imageUrl: string) => Promise<void>;
  getLinePairedUsers?: () => Array<{ userId: string; displayName?: string }>;
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
      width?: number;
      zip?: boolean;
    },
  ) => Promise<string>;
  captureScreen?: (format: 'png' | 'jpg', targetDir?: string) => Promise<string>;
  getShareSettings?: () => ShareSettings;
  createShareLink?: (
    markdown: string,
    opts: { expire: ShareExpire; burnAfterReading: boolean },
  ) => Promise<{ url: string; deleteUrl: string }>;
  sendTelegramFile?: (
    chatId: number,
    filePath: string,
    sendAs: 'photo' | 'document' | 'auto',
    caption?: string,
    authorizedPaths?: string[],
  ) => Promise<void>;
}
