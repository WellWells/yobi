import type { BotCommandAccessMode } from '../../shared/botCommandAccess';
import type { LinkSiteFilter } from '../../shared/linkRecognition';
import type { AgentReplyContext, BotBuiltinCommandKey, BotLlmDirectConfig, BotPlatform, BotRunKind, FlowExecutionResult } from '../../shared/types';
import type { BotBuiltinRunRequest, BotBuiltinRunResult, BotMessageSent } from '../botBuiltinCommands';
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
   * True = a run starts without the "queued" line: the answer is the only message. For a platform
   * whose every message is the owner's own, read by everyone in the chat (LINE PC).
   */
  quietStart?: boolean;
  /**
   * False = the platform issues no pairing codes (LINE PC): `/pair` from someone not let in is no
   * pairing attempt — no code checked, no attempt counted — but a line like any other of theirs.
   */
  pairingCodes?: false;
  /**
   * Whether `/help` lists this owner command (`ownerCommands`) to this admin; absent = to every
   * admin. LINE PC's `/groups` is the owner's alone, so no other admin is shown it.
   */
  listsOwnerCommand?: (name: string, userId: string) => boolean;
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
   * The message a flow's result answers, the way this platform's replies do (Discord, LINE PC: the
   * asking message, quoted; Slack: the channel thread). Undefined when replies there do not (a Slack DM).
   */
  replyRef?: (event: E) => string | undefined;
  /**
   * What the chat around a request brings to its agent run (the message it quotes, the group's
   * talk), read when the run starts: a message or a model command, never `/search` nor the answer
   * to the agent's question (its run already has it). Absent, or empty = a run with none.
   */
  agentContext?: (event: E, input: string) => Promise<BotAgentContext>;
  /**
   * The pictures or files an agent run's request is about (LINE PC: the photo a "Yobi" line quotes,
   * or the one its sender posted just before), planned for the run's model and fetched once the
   * request is taken (after the pace check). Null = a run on its words alone. Never `/search`.
   */
  agentMedia?: (event: E, targetUrl: string) => Promise<BotAgentMedia | null>;
}

/** The chat's part of an agent run (`BotBuiltinRunRequest`). */
export type BotAgentContext = Pick<BotBuiltinRunRequest, 'replyTo' | 'recentChat' | 'chatRecap'>;

/** What a run carries besides its words: the model command that named it, its chat's part, its files. */
export type BotRunExtras = Pick<BotBuiltinRunRequest, 'modelNamed' | 'attachments'> & BotAgentContext;

/** A request's pictures and files, ready for its run (`BotChatOutput.agentMedia`). */
export interface BotAgentMedia {
  /** Nothing could be handed to the model: this is said instead of running (the request still counted). */
  refusal?: string;
  /** Scratch copies to upload with the run. */
  attachments: string[];
  /** The model that reads them: the run's own, or the stand-in when that one takes no uploads. */
  targetUrl: string;
  /** The message the request is about as the run is shown it, in place of the chat's quote (its media now attached or read). */
  replyTo?: AgentReplyContext;
  /** Said in place of a failed run's own words (the stand-in model could not read them). */
  failureText?: string;
  /** Deletes the scratch copies; called once the run is over, however it ended. */
  dispose: () => Promise<void>;
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
  /** `run` is passed only when it holds something: a plain message is the five arguments alone. */
  onBuiltinCommand: (key: BotRunKind, input: string, targetUrl: string, chatId: string, userId: string, run?: BotRunExtras) => Promise<BotBuiltinRunResult>;
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
  /**
   * Someone unpaired addressing the bot in an allowed group that lets them do nothing is a request
   * too (`onPairingRequest`, from the group): the platform gives them no private chat with the bot
   * to ask in (LINE PC). Absent = they are ignored there, as where they can ask in private.
   */
  groupPairingRequests?: boolean;
  /**
   * A paired account's command addressed to the bot in a group runs as in its private chat (a
   * model, `/new`, `/search`, a flow command; each checked as there): the platform gives them no
   * private chat with the bot to type it in (LINE PC). Absent = a group takes no commands.
   */
  groupCommands?: boolean;
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
