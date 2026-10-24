import type { Message, MessageOrigin } from 'grammy/types';
import type { AgentReplyContext } from '../../shared/types';

type MediaCarrier = Partial<Pick<Message,
  'photo' | 'video' | 'animation' | 'video_note' | 'voice' | 'audio' | 'document' | 'sticker'>>;

/** In the model's words. `animation` before `document`: a GIF carries both fields. */
const MEDIA_LABELS: ReadonlyArray<readonly [keyof MediaCarrier, string]> = [
  ['photo', 'photo'],
  ['video', 'video'],
  ['animation', 'animation'],
  ['video_note', 'video message'],
  ['voice', 'voice message'],
  ['audio', 'audio file'],
  ['document', 'file'],
  ['sticker', 'sticker'],
];

function mediaLabel(message: MediaCarrier): string | undefined {
  return MEDIA_LABELS.find(([field]) => message[field])?.[1];
}

function personName(person: { first_name: string; last_name?: string } | undefined): string {
  return [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
}

function senderName(message: Message): string {
  return message.sender_chat?.title?.trim() || personName(message.from);
}

function originName(origin: MessageOrigin): string {
  switch (origin.type) {
    case 'user': return personName(origin.sender_user);
    case 'hidden_user': return origin.sender_user_name.trim();
    case 'chat': return origin.sender_chat.title?.trim() ?? '';
    case 'channel': return origin.chat.title?.trim() ?? '';
    default: return '';
  }
}

/**
 * The message this one replies to, as the agent is shown it: the part the user quoted when they
 * picked one, else its text or caption, and what else it carries. Null when it is not a reply or
 * carries nothing to show. A topic's opening service message is not a reply: in a forum group every
 * message in a topic points at it.
 */
export function readReplyContext(message: Message, botUsername: string): AgentReplyContext | null {
  const replied = message.reply_to_message?.forum_topic_created ? undefined : message.reply_to_message;
  const external = message.external_reply;
  if (!replied && !external) return null;

  const text = (message.quote?.text ?? replied?.text ?? replied?.caption ?? '').trim();
  const media = mediaLabel(replied ?? external ?? {});
  if (!text && !media) return null;

  const author = replied?.from;
  const self = Boolean(author?.is_bot && botUsername && author.username?.toLowerCase() === botUsername.toLowerCase());
  const from = replied ? senderName(replied) : external ? originName(external.origin) : '';
  return {
    from,
    text,
    ...(self ? { self: true } : {}),
    ...(media ? { media } : {}),
  };
}
