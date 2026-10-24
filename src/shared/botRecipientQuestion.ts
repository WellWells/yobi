import { BOT_PLATFORM_NAMES } from './types';
import type { BotPlatform, FlowAssessment, TriggerType } from './types';
import { PLATFORM_ORDER, connectedPlatforms, namedIn, saysEveryone, saysForMe } from './botRecipients';
import type { RecipientDirectory } from './botRecipients';

/**
 * What a flow builder asks and says about recipients before anything is generated: the one
 * question the program puts to the user itself, and the setup line the model reads instead of
 * guessing that a bot needs a token. Neither names a recipient to the model unless it is offering
 * them to the user as choices.
 */

const BOT_COMMAND_TRIGGER: TriggerType = 'bot';

/** How a request names each platform. */
const PLATFORM_WORDS: Readonly<Record<BotPlatform, RegExp>> = {
  telegram: /telegram|電報|电报|(?<![a-z])tg(?![a-z])/i,
  line: /(?<![a-z])line(?![a-z])/i,
  discord: /discord/i,
  slack: /slack/i,
};

/** Which platforms the words point at: one named alone, otherwise every connected one. */
function platformsFromWords(words: string, dir: RecipientDirectory): BotPlatform[] {
  const named = PLATFORM_ORDER.filter((platform) => PLATFORM_WORDS[platform].test(words));
  return named.length === 1 ? named : connectedPlatforms(dir);
}

export interface RecipientWording {
  question: (choices: string) => string;
  self: (name: string) => string;
  chat: (name: string) => string;
  everyone: string;
  separator: string;
}

const MAX_CHOICES = 6;

/**
 * The question to put to the user before a flow is generated, or null when nothing needs asking.
 *
 * It asks only when a bot step would otherwise go to everyone and there is more than one person it
 * could mean: one paired person is who "send it to me" means either way, and a request that names
 * someone, says "me" with one account marked as theirs, or says "everyone" has already answered.
 */
export function recipientQuestion(
  skills: readonly string[],
  trigger: TriggerType,
  words: string,
  dir: RecipientDirectory,
  wording: RecipientWording,
): string | null {
  if (!skills.includes('bot') || trigger === BOT_COMMAND_TRIGGER) return null;
  const platforms = platformsFromWords(words, dir);
  const pool = dir.entries.filter((entry) => platforms.includes(entry.platform));
  const people = pool.filter((entry) => entry.kind === 'person');
  if (people.length <= 1) return null;
  if (saysEveryone(words) || namedIn(words, pool).length === 1) return null;
  if (saysForMe(words) && people.filter((entry) => entry.self).length === 1) return null;

  const ordered = [...people.filter((entry) => entry.self), ...people.filter((entry) => !entry.self), ...pool.filter((entry) => entry.kind === 'chat')];
  const choices = ordered.slice(0, MAX_CHOICES).map((entry) => {
    if (entry.self) return wording.self(entry.label);
    return entry.kind === 'chat' ? wording.chat(entry.label) : entry.label;
  });
  return wording.question([...choices, wording.everyone].join(wording.separator));
}

/** The assessment with the recipient question added when one is needed — asked like any other, before generation. */
export function withRecipientQuestion(
  assessment: FlowAssessment,
  words: string,
  dir: RecipientDirectory,
  wording: RecipientWording,
): FlowAssessment {
  const question = recipientQuestion(assessment.skills, assessment.trigger, words, dir, wording);
  return question ? { ...assessment, questions: [...assessment.questions, question] } : assessment;
}

/** What a flow builder may say about the bots without naming anyone. English: it is read by the model. */
export function describeRecipientSetup(dir: RecipientDirectory): string[] {
  // Telegram and LINE are always described; a newer bot only once connected, so the line every
  // build pays for does not grow for people who never set one up.
  const described = PLATFORM_ORDER.filter((platform) => platform === 'telegram' || platform === 'line' || dir.connected[platform]);
  const lines = described.map((platform) => {
    const name = BOT_PLATFORM_NAMES[platform];
    if (!dir.connected[platform]) return `${name} bot: not connected.`;
    const own = dir.entries.filter((entry) => entry.platform === platform);
    const people = own.filter((entry) => entry.kind === 'person');
    const chats = own.length - people.length;
    const selfNote = people.some((entry) => entry.self) ? ' (one is the user)' : '';
    const chatNote = chats > 0 ? `, ${chats} group or channel chat(s)` : '';
    return `${name} bot: connected — ${people.length} paired ${people.length === 1 ? 'person' : 'people'}${selfNote}${chatNote}.`;
  });
  if (connectedPlatforms(dir).length === 0) {
    lines.push('The flow can still be built; the user connects a bot in Settings before it can send.');
  }
  return lines;
}
