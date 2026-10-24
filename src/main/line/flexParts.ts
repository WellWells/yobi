/**
 * The pieces every owner card on LINE is built from (groups, accounts, invites): one bubble with
 * text lines in the body and postback buttons in the footer, within LINE's limits — a button label
 * of 40 characters, an alt text of 400.
 */
import type { messagingApi } from '@line/bot-sdk';

/** LINE's limit on a Flex button label. */
export const FLEX_LABEL_MAX = 40;
const ALT_TEXT_MAX = 400;

export const CHECKED = '☑';
export const UNCHECKED = '☐';

/** Cuts to `max` characters (code points), ending in "…" when cut. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

export function flexButton(label: string, data: string, style: messagingApi.FlexButton.StyleEnum): messagingApi.FlexButton {
  return { type: 'button', style, height: 'sm', action: { type: 'postback', label: clip(label, FLEX_LABEL_MAX), data } };
}

export function flexText(value: string, extra: Partial<messagingApi.FlexText> = {}): messagingApi.FlexText {
  return { type: 'text', text: value, wrap: true, size: 'sm', ...extra };
}

/** A bubble with these lines and buttons (no footer when there are none). */
export function flexBubble(lines: messagingApi.FlexText[], buttons: messagingApi.FlexButton[], altText: string): messagingApi.FlexMessage {
  return {
    type: 'flex',
    altText: clip(altText, ALT_TEXT_MAX),
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: lines },
      ...(buttons.length > 0 ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}),
    },
  };
}
