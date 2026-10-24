import type { BotCommandAccessMode } from '../../shared/botCommandAccess';
import type { LinkSiteFilter } from '../../shared/linkRecognition';
import type { BotBuiltinCommandKey, BotLlmDirectConfig, BotPlatform, BotRunKind, FlowExecutionResult } from '../../shared/types';
import type { BotBuiltinRunResult, BotMessageSent } from '../botBuiltinCommands';
import type { ByokCommandDef } from '../byokCommands';
import type { ResolvedBuiltinCommand, ResolvedProviderCommand } from '../providerCommands';
import type { BotRequestPace } from '../botRequestPace';

/** A private chat with one person, a group, or (LINE) a multi-person chat outside a group. */
export type BotChatKind = 'user' | 'group' | 'room';

/** One typed line someone sent the bot, as every platform's adapter hands it to the router. */
export interface BotChatEvent {
  userId: string;
  chatId: string;
  chatKind: BotChatKind;
  text: string;
  /** The bot was addressed (a group's @mention); the mention itself is already gone from `text`. */
  mentionsBot: boolean;
  /**
   * A button the bot sent stood for this line (a menu card's choice): never taken as the answer to
   * a question the agent is waiting on, as a typed line would be, and never paced.
   */
  fromMenu?: boolean;
  /** When the platform says it was sent (ms): what paces a burst (`botRequestPace.ts`). */
  sentAt?: number;
  /** Delivered again after an earlier delivery failed: it is old, so it never answers a question. */
  redelivered?: true;
}

export interface BotFlowCommandDef {
  flowId: string;
  command: string;
  description: string;
  inputVariable: string;
  /**
   * 'admins' = the owner in their own private chat. Absent: an empty list = every paired user,
   * a non-empty one = those ids.
   */
  access?: BotCommandAccessMode;
  allowedUserIds: string[];
}

export type BotFlowCommandResult = Pick<FlowExecutionResult, 'success' | 'error' | 'displayError' | 'aborted'>;

export interface BotPairingProfileInput {
  userId: string;
  displayName?: string;
}

/**
 * How one platform sends what the router decided. `reply` answers the event itself (LINE's free
 * reply token, a quote of the asking message); `push` is a later message in the same chat.
 */
export interface BotChatOutput<E extends BotChatEvent> {
  reply: (event: E, text: string) => Promise<void>;
  push: (event: E, text: string) => Promise<void>;
  /**
   * An agent run's answer, written the platform's way. False only for a verbatim question (a shell
   * or connector approval) that does not fit one message whole: it must not be clipped, so the
   * router withdraws the question instead.
   */
  pushResult: (event: E, result: BotBuiltinRunResult) => Promise<boolean>;
  /** The name the platform shows for this person here; undefined when it cannot be read. */
  displayName: (event: E) => Promise<string | undefined>;
  /** A group's name, for the settings page; undefined when it has none or cannot be read. */
  groupName?: (chatId: string, chatKind: BotChatKind) => Promise<string | undefined>;
  /**
   * The message a flow's result answers, the way this platform's replies do (Discord: the asking
   * message, quoted; Slack: the channel thread). Undefined when replies there do not (a Slack DM).
   */
  replyRef?: (event: E) => string | undefined;
}

export interface BotChatRouterDeps<E extends BotChatEvent> {
  platform: BotPlatform;
  output: BotChatOutput<E>;
  isPairedUser: (userId: string) => boolean;
  consumePairingCode: (code: string, user: BotPairingProfileInput) => { ok: boolean; reason?: string };
  onLog: (message: string) => void;
  getStrings: () => Record<string, string>;
  getLlmDirect: () => BotLlmDirectConfig;
  getProviderCommands: () => ResolvedProviderCommand[];
  getBuiltinCommands: () => ResolvedBuiltinCommand[];
  onBuiltinCommand: (key: BotRunKind, input: string, targetUrl: string, chatId: string, userId: string) => Promise<BotBuiltinRunResult>;
  /**
   * Whether this account may type this built-in command in this chat (its grants: web for
   * `/search`). Asked before anything is queued and when listing commands.
   */
  canUseBuiltin?: (key: BotBuiltinCommandKey, chatId: string, userId: string) => Promise<boolean>;
  /**
   * Whether this account's pasted link may run the downloader in this chat. Without it the link
   * is an ordinary message; the flow runner checks again.
   */
  canUseDownloader?: (chatId: string, userId: string) => Promise<boolean>;
  /**
   * Which sites' typed links run their built-in (Settings › Recognize links), read per message.
   * Absent = every site. A button already sent still works (`fromMenu`).
   */
  linkSites?: () => LinkSiteFilter;
  /**
   * Whether this person may talk to the bot in this chat: every paired account, an unpaired person
   * in a group that grants it. Absent = pairing alone decides.
   */
  canChat?: (chatId: string, userId: string) => Promise<boolean>;
  /** Whether this account may run a flow command limited to admins in this chat. Absent = nobody may. */
  isFlowAdmin?: (chatId: string, userId: string) => Promise<boolean>;
  /** Blocked by the owner: nothing they send is answered. */
  isBlocked?: (userId: string) => boolean;
  /** How often one person may start work (`botRequestPace.ts`); absent = no limit (tests). */
  pace?: BotRequestPace;
  /**
   * A group the owner has not allowed yet: nothing anyone sends there is answered (paired accounts
   * included); it is still registered so settings can list it.
   */
  isGroupPending?: (chatId: string) => boolean;
  /** The bot was just added to this group (a join event). */
  onGroupJoined?: (group: { chatId: string; chatKind: 'group' | 'room'; title?: string }) => void;
  /** An unpaired person addressed the bot here — the owner's "used the bot" list. */
  onUse?: (user: { userId: string; displayName?: string }, chatId: string) => void;
  /** The bot is in this group (joined, or a message showed it). */
  onGroupSeen?: (group: { chatId: string; chatKind: 'group' | 'room'; title?: string }) => void;
  /** The bot was removed from this group. */
  onGroupLeft?: (chatId: string) => void;
  /**
   * The owner's management commands (`/groups`, `/users`, `/invite`) this platform has, by name;
   * each handler checks it is the owner. A name not here is an unknown command, and not listed.
   */
  ownerCommands?: Record<string, ((event: E) => Promise<void>) | undefined>;
  /**
   * An unpaired person wrote in their private chat (anything but `/pair <code>`): a request to
   * use the bot, answered by the handler. Absent = the pairing tip.
   */
  onPairingRequest?: (event: E) => Promise<void>;
  /** A pairing code was just used by this person. */
  onCodePaired?: (code: string, userId: string) => void;
  onAgentAnswer: (answer: string, chatId: string, userId: string) => Promise<BotBuiltinRunResult | null>;
  /** A question waits for this person here; given `sent`, whether that message answers it (sent after it). */
  hasPendingAgentAsk: (chatId: string, userId: string, sent?: BotMessageSent) => boolean;
  onDropAgentAsk: (chatId: string, userId: string) => void;
  onNewConversation: (chatId: string, userId: string) => Promise<boolean>;
  getFlowCommands?: () => BotFlowCommandDef[];
  getByokCommands?: () => ByokCommandDef[];
  onFlowCommand?: (
    flowId: string,
    inputVariable: string,
    input: string,
    userId: string,
    /** Where the flow answers: the person's own chat, or the group they asked in. */
    chatId: string,
    /** What the result answers there (`BotChatOutput.replyRef`), kept as `bot.triggerMessageId`. */
    messageId?: string,
  ) => Promise<{ taskId: string; result: Promise<BotFlowCommandResult> }>;
}
