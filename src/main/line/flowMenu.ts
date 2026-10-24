/**
 * A bot step's picture, text and buttons as one LINE card — a video's menu: the cover, the title
 * and sizes, and a button per choice to tap instead of a line to copy back. Each button is a
 * postback whose data is the very line the person would otherwise type (`url 720`); a tap is
 * handed to the dispatcher as that line addressed to the bot (`LineDispatcher.dispatchFlowButton`),
 * so it passes every check typing it would, works in a group without an @mention, and stays
 * usable after a restart. Forged data is only what the person could have typed themselves.
 *
 * The buttons keep the step's groups (`FlowButton.rowStart`): each group on rows of its own, at
 * most three to a row — a card is narrower than a Telegram keyboard.
 */
import type { messagingApi } from '@line/bot-sdk';
import { FLEX_LABEL_MAX, clip } from './flexParts';
import { LINE_POSTBACK_DATA_MAX, linePostbackData } from './postbackRouter';

/** Prefix of a menu button's postback data; the payload is the line it sends. */
export const LINE_FLOW_BUTTON_PREFIX = 'fb';
/** Longer text goes as a message of its own (`execBotLine`'s other paths), not into a card. */
export const LINE_MENU_TEXT_MAX = 2_000;

const ROW_MAX_BUTTONS = 3;
const ALT_TEXT_MAX = 400;

export interface LineMenuButton {
  label: string;
  /** What a tap stands for: the line the person would type to the bot. */
  line: string;
  /** Begins a new group of buttons (`FlowButton.rowStart`). */
  rowStart?: boolean;
}

export interface LineFlowMenu {
  /** An https jpeg or png shown on top; none = a card of text and buttons. */
  image?: string;
  text: string;
  buttons: readonly LineMenuButton[];
  /** What a notification and the chat list show for the card. */
  altText: string;
}

/** Whether these fit one card: some buttons, each line within a postback's data, the text short enough. */
export function lineMenuFits(text: string, buttons: readonly LineMenuButton[]): boolean {
  return buttons.length > 0
    && Array.from(text).length <= LINE_MENU_TEXT_MAX
    && buttons.every((b) => `${LINE_FLOW_BUTTON_PREFIX}:${b.line}`.length <= LINE_POSTBACK_DATA_MAX);
}

/** Each group on rows of its own, as few as hold it, split evenly; ungrouped buttons one per row. */
export function lineMenuRows<T extends { rowStart?: boolean }>(buttons: readonly T[]): T[][] {
  if (!buttons.some((b) => b.rowStart)) return buttons.map((b) => [b]);
  const groups: T[][] = [];
  for (const button of buttons) {
    if (button.rowStart || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(button);
  }
  return groups.flatMap((group) => {
    const size = Math.ceil(group.length / Math.ceil(group.length / ROW_MAX_BUTTONS));
    const rows: T[][] = [];
    for (let i = 0; i < group.length; i += size) rows.push(group.slice(i, i + size));
    return rows;
  });
}

function menuButton(button: LineMenuButton): messagingApi.FlexButton {
  const label = clip(button.label, FLEX_LABEL_MAX);
  return {
    type: 'button',
    style: 'secondary',
    height: 'sm',
    flex: 1,
    // The label shows as the person's own message, so the chat says what was tapped.
    action: { type: 'postback', label, data: linePostbackData(LINE_FLOW_BUTTON_PREFIX, button.line), displayText: label },
  };
}

export function lineMenuMessage(menu: LineFlowMenu): messagingApi.FlexMessage {
  const rows: messagingApi.FlexBox[] = lineMenuRows(menu.buttons).map((row) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: row.map(menuButton),
  }));
  const text = menu.text.trim();
  return {
    type: 'flex',
    altText: clip(menu.altText.trim() || text || menu.buttons.map((b) => b.label).join(' '), ALT_TEXT_MAX),
    contents: {
      type: 'bubble',
      ...(menu.image ? { hero: { type: 'image', url: menu.image, size: 'full', aspectRatio: '16:9', aspectMode: 'cover' } } : {}),
      ...(text ? { body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text, wrap: true, size: 'sm' }] } } : {}),
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
    },
  };
}
