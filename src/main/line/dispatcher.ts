import { t } from '../i18n';
import { BotChatRouter } from '../botChat/router';
import type { BotChatOutput, BotChatRouterDeps, BotFlowCommandDef } from '../botChat/types';
import type { BotBuiltinRunResult } from '../botBuiltinCommands';
import { formatLineReply, verbatimLineText } from './format';
import type { LineClient } from './client';
import { LINE_GROUPS_COMMAND, LINE_INVITE_COMMAND, LINE_USERS_COMMAND } from './commands';
import type { LineChatEvent, LinePostbackEvent, LineTextEvent } from './events';
import { respond, safePush } from './messaging';

export type LineFlowCommandDef = BotFlowCommandDef;

type RouterOwnedDeps = 'platform' | 'output' | 'ownerCommands';

export interface LineDispatcherDeps extends Omit<BotChatRouterDeps<LineTextEvent>, RouterOwnedDeps> {
  getClient: () => LineClient | null;
  /**
   * `/groups` from a paired account in its private chat (the owner's group cards; the handler
   * checks it is the owner). Absent = an unknown command, and not listed.
   */
  onGroupsCommand?: (event: LineTextEvent) => Promise<void>;
  /** `/users`: the owner's account cards (the handler checks it is the owner). Absent = unknown. */
  onUsersCommand?: (event: LineTextEvent) => Promise<void>;
  /** `/invite`: the owner's pairing link (the handler checks it is the owner). Absent = unknown. */
  onInviteCommand?: (event: LineTextEvent) => Promise<void>;
}

/** How LINE writes the router's answers: plain text, a free reply token first, pushes after. */
function lineOutput(deps: Pick<LineDispatcherDeps, 'getClient' | 'getStrings' | 'onLog'>): BotChatOutput<LineTextEvent> {
  const push = (to: string, text: string): Promise<void> => safePush(deps.getClient(), to, text, deps.onLog);
  return {
    reply: (event, text) => respond(deps.getClient(), event, text, deps.onLog),
    push: (event, text) => push(event.chatId, text),
    pushResult: async (event, result: BotBuiltinRunResult) => {
      const s = deps.getStrings();
      if (result.ok && result.verbatim) {
        const verbatim = verbatimLineText(result.text);
        if (verbatim === null) return false;
        await push(event.chatId, verbatim);
        return true;
      }
      const text = result.ok
        ? formatLineReply(result.text, t(s, 'bot.chat.emptyResponse'))
        : `${t(s, 'bot.chat.runFailed', { provider: result.providerLabel })}\n${result.text}`;
      // LINE sends a picture only from a public https address; a drawn one is a file on this
      // computer, so the reply says where to see it rather than going without a word.
      const pictures = result.ok && result.files?.length ? `\n\n${t(s, 'line.msg.picturesOnComputer', { count: String(result.files.length) })}` : '';
      await push(event.chatId, `${text}${pictures}`);
      return true;
    },
    displayName: async (event) => {
      const client = deps.getClient();
      return event.chatKind === 'user'
        ? client?.getDisplayName(event.userId)
        : client?.getMemberName(event.chatKind, event.chatId, event.userId);
    },
    groupName: async (chatId, chatKind) => (chatKind === 'group' ? deps.getClient()?.getGroupName(chatId) : undefined),
  };
}

/** LINE's events through the shared router (`botChat/router.ts`). */
export class LineDispatcher extends BotChatRouter<LineTextEvent> {
  constructor(deps: LineDispatcherDeps) {
    const { getClient: _client, onGroupsCommand, onUsersCommand, onInviteCommand, ...routerDeps } = deps;
    super({
      ...routerDeps,
      platform: 'line',
      output: lineOutput(deps),
      ownerCommands: {
        [LINE_GROUPS_COMMAND]: onGroupsCommand,
        [LINE_USERS_COMMAND]: onUsersCommand,
        [LINE_INVITE_COMMAND]: onInviteCommand,
      },
    });
  }

  async dispatchChatEvents(events: LineChatEvent[]): Promise<void> {
    for (const event of events) {
      if (event.type === 'leave') this.groupLeft(event.chatId, event.chatKind);
      else await this.groupJoined(event.chatId, event.chatKind);
    }
  }

  /** A tap on a menu card's button (`flowMenu.ts`): its line, as if typed here (`dispatchButtonLine`). */
  dispatchFlowButton(event: LinePostbackEvent, line: string): Promise<void> {
    const { userId, chatId, chatKind, replyToken } = event;
    return this.dispatchButtonLine({ userId, chatId, chatKind, ...(replyToken ? { replyToken } : {}), text: line, mentionsBot: true });
  }
}
