/**
 * The ⋮ menu's info area: two short lines on the menu itself and a compact card on hover. Pure:
 * everything comes from `summarizeConversation`, the same source as the "Conversation info"
 * dialog, so the card is a summary of the dialog and never says something it does not.
 */
import { formatCardTime } from '../../../../../shared/captureCard';
import { formatByteSize } from '../../../utils/byteSize';
import {
  contextValueText,
  durationValueText,
  fillTemplate,
  tokensValueText,
  type ConversationInfo,
} from '../../../utils/conversationInfo';
import { menuStatsText } from './headerMenuModel';

type Translate = (key: string) => string;

/** How many attachment names the card lists before "+N more". */
export const INFO_CARD_ATTACHMENTS = 3;
/**
 * The path is cut in the middle past this, so the drive and the file name both stay readable. It
 * is drawn on one line across the card, in the monospace at the card's small size: 40 characters
 * fit the card's inner width.
 */
export const INFO_CARD_PATH_CHARS = 40;

/** The values' own separator, from the language files ("Input 1.2k · Output 3.4k"). */
const VALUE_SEPARATOR = ' · ';

/**
 * A value cut where it may wrap: after each " · ", never inside a part, so "longest 1 min 5 s"
 * never leaves "5 s" alone on a line. Each part but the last keeps its trailing "·".
 */
export function valueSegments(value: string): string[] {
  const parts = value.split(VALUE_SEPARATOR);
  return parts.map((part, index) => (index < parts.length - 1 ? `${part} ·` : part));
}

/** Long text cut in the middle with an ellipsis; the start and the end are what tell paths apart. */
export function truncateMiddle(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const keep = Math.max(2, max - 1);
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

/** The first few names and how many more there are. */
export function capList(names: readonly string[], max: number): { shown: string[]; more: number } {
  return { shown: names.slice(0, max), more: Math.max(0, names.length - max) };
}

/** The two lines on the menu: "N turns · about X words" and "Last reply {time} · {provider}". */
export function infoMenuLines(
  info: Pick<ConversationInfo, 'turns' | 'lastActiveAt' | 'lastProvider'>,
  words: number,
  t: Translate,
  locale: string,
): { stats: string; lastReply: string } {
  const time = formatCardTime(info.lastActiveAt, locale);
  return {
    stats: menuStatsText(t('header.menu.stats'), info.turns, words, locale),
    lastReply: [time ? fillTemplate(t('header.menu.info.lastReply'), { time }) : '', info.lastProvider]
      .filter(Boolean)
      .join(' · '),
  };
}

export interface InfoCardRow {
  key: string;
  label: string;
  /** One value per line; the context row can have two. */
  values: string[];
  /** A path on its own line under the row, in the dialog's monospace. */
  detail?: string;
}

/** The hover card: the dialog's rows, each in one or two short lines. Rows with nothing to say are left out. */
export function infoCardRows(info: ConversationInfo, filePath: string, t: Translate, locale: string): InfoCardRow[] {
  const rows: InfoCardRow[] = [];
  const add = (key: string, labelKey: string, values: string[]): void => {
    const present = values.filter(Boolean);
    if (present.length > 0) rows.push({ key, label: t(labelKey), values: present });
  };

  add('started', 'chat.info.started', [formatCardTime(info.startedAt, locale)]);
  add('lastActive', 'chat.info.lastActive', [formatCardTime(info.lastActiveAt, locale)]);
  add('models', 'chat.info.models', [
    info.models
      .map((model) => (info.models.length > 1 ? `${model.name} ×${model.turns}` : model.name))
      .join(' · '),
  ]);
  add('tokens', 'chat.info.tokens', [tokensValueText(info, t)]);
  add('duration', 'chat.info.duration', [durationValueText(info, t)]);
  add('context', 'chat.info.context', contextValueText(info, t));

  const attachments = capList(info.attachments, INFO_CARD_ATTACHMENTS);
  add('attachments', 'chat.info.attachments', [
    [
      ...attachments.shown,
      attachments.more > 0 ? fillTemplate(t('header.menu.info.moreAttachments'), { count: attachments.more }) : '',
    ].filter(Boolean).join(', '),
  ]);

  rows.push({
    key: 'file',
    label: t('chat.info.file'),
    values: [formatByteSize(info.sizeBytes)],
    ...(filePath ? { detail: truncateMiddle(filePath, INFO_CARD_PATH_CHARS) } : {}),
  });
  return rows;
}
