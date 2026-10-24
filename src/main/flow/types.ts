import type { BrowserWindow } from 'electron';
import type {
  CaptureFormat, CardTheme, FlowButton, FlowExecutionLog, MarkdownCapturePayload,
  ShareExpire, ShareSettings, SocketBotPlatform,
} from '../../shared/types';
import type { SocketBotOutgoing } from '../botChat/socketRuntime';
import type { ResearchProgress } from '../../shared/researchProgress';
import type { RecipientDirectory } from '../../shared/botRecipients';
import type { StepProgress } from '../../shared/stepProgress';
import type { LineCarouselItem } from '../line/pickCarousel';
import type { LineFlowMenu } from '../line/flowMenu';

export type LogCallback = (log: FlowExecutionLog) => void;

export interface SaveHistoryInfo {
  prompt: string;
  response: string;
  providerLabel: string;
}

export interface FlowExecutorDeps {
  getWorkerWin: () => BrowserWindow | null;
  /** A research call's checklist, re-sent whole each time a phase or a count changes. */
  onResearchProgress?: (progress: ResearchProgress) => void;
  /** One run's long step reporting where it is (a download's percentage). */
  onStepProgress?: (progress: StepProgress) => void;
  ensureWorkerWin?: () => Promise<BrowserWindow | null>;
  getTargetUrl: () => string;
  getResponseTimeoutMs?: () => number;
  onSaveHistory?: (info: SaveHistoryInfo) => Promise<void>;
  sendTelegramMessage?: (chatId: number, text: string, extras?: BotSendExtras) => Promise<void>;
  /** Deletes one Telegram message; false when Telegram refuses (no right to in that chat, too old). */
  deleteTelegramMessage?: (chatId: number, messageId: number) => Promise<boolean>;
  getPairedUsers?: () => Array<{ userId: number; username?: string; firstName?: string }>;
  sendLineMessage?: (userId: string, text: string) => Promise<void>;
  sendLineImage?: (userId: string, imageUrl: string) => Promise<void>;
  sendLineVideo?: (userId: string, videoUrl: string, previewUrl: string) => Promise<void>;
  /** A menu's items as cards to tap, each sending its own line (`line/pickCarousel.ts`). */
  sendLineCarousel?: (userId: string, items: readonly LineCarouselItem[], altText: string) => Promise<void>;
  /** A picture, its text and buttons to tap as one card (`line/flowMenu.ts`). */
  sendLineMenu?: (userId: string, menu: LineFlowMenu) => Promise<void>;
  getLinePairedUsers?: () => Array<{ userId: string; displayName?: string }>;
  /** Discord's and Slack's sends: one message (text, the run's files, buttons standing for lines) to a chat id. */
  sendSocketBot?: (platform: SocketBotPlatform, chatId: string, message: SocketBotOutgoing) => Promise<void>;
  getSocketBotPairedUsers?: (platform: SocketBotPlatform) => Array<{ userId: string; displayName?: string }>;
  /** The chats a bot step may name instead of giving an id ("me", a person, a channel). */
  getBotRecipients?: () => Promise<RecipientDirectory>;
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
      /** Blank = the card's built-in padding. */
      margin?: number;
      /** Blank = 1x. */
      pixelRatio?: number;
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
    sendAs: TelegramSendAs,
    caption?: string,
    authorizedPaths?: string[],
    extras?: BotSendExtras,
  ) => Promise<void>;
  /** Several local files as one album (a post's photos and videos), the caption under the first. */
  sendTelegramAlbum?: (
    chatId: number,
    filePaths: string[],
    caption?: string,
    authorizedPaths?: string[],
    /** The message the album answers (`BotSendExtras.replyTo`). */
    replyTo?: number,
  ) => Promise<void>;
}

export type TelegramSendAs = 'photo' | 'document' | 'auto' | 'video' | 'audio';

/** Buttons under a bot message: pressing one runs `flowId` again with the button's input. */
export interface BotSendExtras {
  buttons?: {
    flowId: string;
    /** Whoever started the run; only they may press. */
    userId?: number;
    items: FlowButton[];
  };
  /**
   * The message this answers, quoted above it: the one that started the run, in the chat it was
   * sent in. In a group, an answer that quotes nothing reads as said to no one.
   */
  replyTo?: number;
}
