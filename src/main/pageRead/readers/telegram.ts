import { load, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { textOf } from '../pageExtract';
import type { PageApiReader } from './api';
import { imagesOn, readerPage } from './readerPage';

const HOSTS = new Set(['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me']);
/** Telegram's photo CDN: the addresses its own widget draws a post's photos from. */
const MEDIA_HOSTS = Array.from({ length: 9 }, (_, index) => `cdn${index + 1}.telesco.pe`);
/**
 * A public chat's message: `/<username>/<id>`, a forum topic's `/<username>/<topic>/<id>`, or the
 * channel preview's `/s/<username>/<id>`. Usernames are 5–32 letters, digits and underscores, so
 * Telegram's own paths (`/c/`, `/s/`, `/boost/`, `/setlanguage/`) never read as one.
 */
const MESSAGE_PATH = /^\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{4,31})\/(?:\d{1,12}\/)?(\d{1,12})\/?$/;
/** A message in a private chat, by the chat's number: only its members can open it. */
const PRIVATE_PATH = /^\/c\/(\d{5,20})\/(?:\d{1,12}\/)?(\d{1,12})\/?$/;

function messagePath(url: URL): string | null {
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  const message = MESSAGE_PATH.exec(url.pathname);
  if (message) return `${message[1]}/${message[2]}`;
  const inPrivate = PRIVATE_PATH.exec(url.pathname);
  return inPrivate ? `c/${inPrivate[1]}/${inPrivate[2]}` : null;
}

/** A widget text block, outside the quote of the message it answers and the link's preview. */
function ownText($: CheerioAPI, bubble: Element): Element | undefined {
  return $(bubble).find('.tgme_widget_message_text').toArray()
    .find((node) => $(node).closest('.tgme_widget_message_reply, .tgme_widget_message_link_preview').length === 0);
}

function textIn($: CheerioAPI, node: Element | undefined): string {
  return node ? textOf($, node).trim() : '';
}

/** The quoted message a reply answers, as `> name: text`. */
function replyQuote($: CheerioAPI, bubble: Element): string {
  const reply = $(bubble).find('.tgme_widget_message_reply').first();
  const said = reply.length > 0 ? textIn($, reply.find('.tgme_widget_message_text').get(0)) : '';
  if (!said) return '';
  const name = reply.find('.tgme_widget_message_author_name').first().text().trim();
  return said.split('\n').map((line, index) => `> ${index === 0 && name ? `${name}: ` : ''}${line}`).join('\n');
}

/** The page a message links to, as the widget previews it: its title, its blurb and the address. */
function linkPreview($: CheerioAPI, bubble: Element): string {
  const preview = $(bubble).find('a.tgme_widget_message_link_preview').first();
  if (preview.length === 0) return '';
  const title = preview.find('.link_preview_title').first().text().trim();
  const blurb = textIn($, preview.find('.link_preview_description').get(0));
  const href = preview.attr('href') ?? '';
  return [title, blurb, /^https?:\/\//.test(href) ? href : ''].filter(Boolean).join('\n');
}

function photoAddresses($: CheerioAPI, bubble: Element): string[] {
  return $(bubble).find('.tgme_widget_message_photo_wrap').toArray()
    .map((node) => /background-image:url\('([^']+)'\)/.exec($(node).attr('style') ?? '')?.[1] ?? '');
}

/** What the widget page says of one message; null for a page without one. */
export function readTelegramWidget(html: string, url: string): ReturnType<PageApiReader['read']> {
  const $ = load(html);
  const bubble = $('.tgme_widget_message_bubble').get(0);
  if (!bubble) return null;
  const text = textIn($, ownText($, bubble));
  const photos = imagesOn(MEDIA_HOSTS, photoAddresses($, bubble));
  if (!text && photos.length === 0) {
    // The widget's own error block: the message was deleted, or the chat is not public.
    if ($(bubble).find('.tgme_widget_message_error').length === 0) return null;
    return PRIVATE_PATH.test(new URL(url).pathname)
      ? { failure: 'sign-in', message: 'This links to a message in a private Telegram chat: only its members can open it.' }
      : { failure: 'missing', message: 'Telegram shows no such message: it was deleted, or the chat is not public.' };
  }
  const chat = $(bubble).find('.tgme_widget_message_owner_name').first().text().trim();
  const member = $(bubble).children('.tgme_widget_message_author').find('.tgme_widget_message_author_name').first().text().trim();
  const page = readerPage({
    title: chat || member,
    author: member || chat,
    publishedAt: $(bubble).find('.tgme_widget_message_date time[datetime]').first().attr('datetime')?.slice(0, 10) ?? '',
    siteName: 'Telegram',
    url,
    text: [replyQuote($, bubble), text, linkPreview($, bubble)].filter(Boolean).join('\n\n'),
    images: photos,
  });
  // Photos alone are no whole post to forward as it stands.
  return text ? page : { ...page, complete: false };
}

/**
 * A message in a public Telegram chat. Its own page is a script that draws the post; the widget
 * page Telegram serves for embedding it (`?embed=1`) holds the message itself.
 */
export const telegramReader: PageApiReader = {
  answer: 'html',
  address(url) {
    const path = messagePath(url);
    return path ? `https://t.me/${path}?embed=1&mode=tme` : null;
  },
  read: (answer, url) => (typeof answer === 'string' ? readTelegramWidget(answer, url) : null),
};
