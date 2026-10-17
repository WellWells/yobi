import type { messagingApi } from '@line/bot-sdk';

/**
 * A menu's items as a LINE carousel (a person's stories), so each item can be previewed:
 * one small portrait card per item, its picture and label, and tapping it sends the item's line —
 * the same text the person would otherwise type back. LINE fetches each picture itself.
 */

export interface LineCarouselItem {
  /** The button's label: number, photo or video and length. */
  label: string;
  /** An https jpeg or png. */
  image: string;
  /** What a tap sends as the person's own message. */
  text: string;
}

/** A carousel holds at most 12 cards. */
export const LINE_CAROUSEL_MAX = 12;
/** The text a tap sends, at most. */
export const LINE_ACTION_TEXT_MAX = 300;
const ALT_TEXT_MAX = 400;

export function pickCarouselMessage(items: readonly LineCarouselItem[], altText: string): messagingApi.FlexMessage {
  const bubbles = items.slice(0, LINE_CAROUSEL_MAX).map((item): messagingApi.FlexBubble => {
    const tap: messagingApi.MessageAction = { type: 'message', text: item.text };
    return {
      type: 'bubble',
      size: 'micro',
      hero: { type: 'image', url: item.image, size: 'full', aspectRatio: '9:16', aspectMode: 'cover', action: tap },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '8px',
        contents: [{ type: 'text', text: item.label, size: 'sm', align: 'center', wrap: true }],
      },
      action: tap,
    };
  });
  return {
    type: 'flex',
    altText: Array.from(altText.trim() || items.map((item) => item.label).join(' ')).slice(0, ALT_TEXT_MAX).join(''),
    contents: { type: 'carousel', contents: bubbles },
  };
}
