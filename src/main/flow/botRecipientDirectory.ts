import { config } from '../config';
import { sendLog } from '../helpers';
import { getLangCache, t } from '../i18n';
import { loadUserMemory } from '../memory/memoryStore';
import { buildRecipientDirectory, directorySeenBy, EMPTY_RECIPIENT_DIRECTORY } from '../../shared/botRecipients';
import type { RecipientDirectory } from '../../shared/botRecipients';
import type { RecipientWording } from '../../shared/botRecipientQuestion';
import { SOCKET_BOT_SECRET_FIELDS } from '../../shared/types';
import type { BotPlatform, SocketBotPlatform } from '../../shared/types';

/** Turned on with every secret it signs in with (Slack needs both of its tokens). */
export function isSocketBotConfigured(platform: SocketBotPlatform): boolean {
  const section = config[platform] as unknown as Record<string, unknown> | undefined;
  if (!section?.enabled) return false;
  return SOCKET_BOT_SECRET_FIELDS[platform].every((field) => typeof section[field] === 'string' && Boolean((section[field] as string).trim()));
}

/**
 * The groups and friends LINE PC has, as directory names: read only with the LINE connector on, on
 * Windows; a failure leaves LINE PC with its paired people. The reader loads the native database
 * driver, so it is imported here, when first needed.
 */
async function lineSelfChats(): Promise<Array<{ id: string; label: string }>> {
  if (!config.lineReaderEnabled || process.platform !== 'win32') return [];
  try {
    const [{ getSharedLineService }, { listLineSelfTargets }] = await Promise.all([
      import('../line/sharedService'),
      import('../lineSelf/targets'),
    ]);
    const { targets } = await listLineSelfTargets(getSharedLineService());
    return targets.map((target) => ({ id: target.id, label: target.name }));
  } catch (err: unknown) {
    sendLog(`⚠️ [Bot] Could not read LINE PC's chats for the recipients: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export interface RecipientDirectoryOptions {
  /**
   * Also LINE PC's groups and friends, by name (they post as the user's own account): for the
   * desktop and the executor, and for a bot run only when the user asked from their own LINE PC
   * account. Never for anyone else's run.
   */
  lineSelfChats?: boolean;
}

/**
 * The chats a flow's bot step can reach right now — the same list the step's recipient picker
 * offers: paired people on each connected bot, plus the Telegram channels it may still post to,
 * and with `lineSelfChats` LINE PC's groups and friends.
 * "This is me" comes from the memory settings, where the user already marks their own accounts.
 */
export async function loadRecipientDirectory(options: RecipientDirectoryOptions = {}): Promise<RecipientDirectory> {
  const telegram = Boolean(config.telegram?.enabled && config.telegram.botToken);
  const line = Boolean(config.line?.enabled && config.line.channelAccessToken);
  const discord = isSocketBotConfigured('discord');
  const slack = isSocketBotConfigured('slack');
  const lineSelf = isSocketBotConfigured('lineSelf');
  if (!telegram && !line && !discord && !slack && !lineSelf) return EMPTY_RECIPIENT_DIRECTORY;
  const memory = await loadUserMemory().catch(() => null);
  return buildRecipientDirectory({
    telegram: {
      connected: telegram,
      pairedUsers: config.telegram?.pairing?.pairedUsers ?? [],
      channels: config.telegram?.channels ?? [],
    },
    line: { connected: line, pairedUsers: config.line?.pairing?.pairedUsers ?? [] },
    discord: { connected: discord, pairedUsers: config.discord?.pairing?.pairedUsers ?? [] },
    slack: { connected: slack, pairedUsers: config.slack?.pairing?.pairedUsers ?? [] },
    lineSelf: {
      connected: lineSelf,
      pairedUsers: config.lineSelf?.pairing?.pairedUsers ?? [],
      ...(lineSelf && options.lineSelfChats ? { chats: await lineSelfChats() } : {}),
    },
    self: memory?.botSelf ?? {},
  });
}

/** Who asks a bot run to build or change a flow: the user themself or not, on which account. */
export interface BotRunAsker {
  owner: boolean;
  requester: { platform: BotPlatform; userId: string };
}

/**
 * The directory a bot run's flow building reads, once per run: "me" is the asking account
 * (`directorySeenBy`). LINE PC's groups and friends post as the user's own account, so they are in it
 * only when the user themself asks from their own LINE PC account — never another account's run,
 * an admin's included.
 */
export async function botRunRecipients(asker: BotRunAsker): Promise<RecipientDirectory> {
  const lineSelfChats = asker.owner && asker.requester.platform === 'lineSelf';
  const directory = await loadRecipientDirectory({ lineSelfChats }).catch(() => EMPTY_RECIPIENT_DIRECTORY);
  return directorySeenBy(directory, asker.requester.platform, asker.requester.userId);
}

/**
 * The paired chats, read once per build and only when a bot step is in play. Without `given` the
 * build is the user's own at the desktop, so LINE PC's chats are in it; a bot run passes its own.
 */
export function lazyRecipients(given?: RecipientDirectory): () => Promise<RecipientDirectory> {
  let directory = given ?? null;
  return async () => {
    directory ??= await loadRecipientDirectory({ lineSelfChats: true }).catch(() => EMPTY_RECIPIENT_DIRECTORY);
    return directory;
  };
}

/** The recipient question in the app's language — it is shown to the user, unlike the rest of a build. */
export function recipientWording(): RecipientWording {
  const strings = getLangCache();
  return {
    question: (choices) => t(strings, 'flow.build.recipient.question', { choices }),
    self: (name) => t(strings, 'flow.build.recipient.self', { name }),
    chat: (name) => t(strings, 'flow.build.recipient.chat', { name }),
    everyone: t(strings, 'flow.build.recipient.everyone'),
    separator: t(strings, 'flow.build.recipient.separator'),
  };
}
