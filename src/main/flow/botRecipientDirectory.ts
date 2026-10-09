import { config } from '../config';
import { getLangCache, t } from '../i18n';
import { loadUserMemory } from '../memory/memoryStore';
import { buildRecipientDirectory, EMPTY_RECIPIENT_DIRECTORY } from '../../shared/botRecipients';
import type { RecipientDirectory } from '../../shared/botRecipients';
import type { RecipientWording } from '../../shared/botRecipientQuestion';

/**
 * The chats a flow's bot step can reach right now — the same list the step's recipient picker
 * offers: paired people on each connected bot, plus the Telegram channels it may still post to.
 * "This is me" comes from the memory settings, where the user already marks their own accounts.
 */
export async function loadRecipientDirectory(): Promise<RecipientDirectory> {
  const telegram = Boolean(config.telegram?.enabled && config.telegram.botToken);
  const line = Boolean(config.line?.enabled && config.line.channelAccessToken);
  if (!telegram && !line) return EMPTY_RECIPIENT_DIRECTORY;
  const memory = await loadUserMemory().catch(() => null);
  return buildRecipientDirectory({
    telegram: {
      connected: telegram,
      pairedUsers: config.telegram?.pairing?.pairedUsers ?? [],
      channels: config.telegram?.channels ?? [],
    },
    line: { connected: line, pairedUsers: config.line?.pairing?.pairedUsers ?? [] },
    self: memory?.botSelf ?? { telegram: [], line: [] },
  });
}

/** The paired chats, read once per build and only when a bot step is in play. */
export function lazyRecipients(given?: RecipientDirectory): () => Promise<RecipientDirectory> {
  let directory = given ?? null;
  return async () => {
    directory ??= await loadRecipientDirectory().catch(() => EMPTY_RECIPIENT_DIRECTORY);
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
