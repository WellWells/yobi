import { Tokenizer } from 'marked';
import type { TokenizerObject } from 'marked';

/*
 * Where a bare URL ends in Chinese, Japanese or Korean text. GFM's autolink runs to the next
 * whitespace, and these languages put none between a URL and the words after it: in
 * "影片（https://youtu.be/x）的內容…" the rest of the sentence became part of the link. A URL as
 * people write it holds no full-width form, CJK punctuation or CJK character — a page whose path
 * has them is written percent-encoded or as a Markdown link, which this leaves alone.
 */
const STOP_CHARS = '\\u3000-\\u303F\\uFF00-\\uFFEF\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
const STOP = new RegExp(`[${STOP_CHARS}]`, 'u');

/** A character class body (no brackets) for regexes that must stop a URL where this does. */
export const BARE_URL_STOP_CHARS = STOP_CHARS;

/** The length of `raw` up to the first character that ends a bare URL. */
export function bareUrlEnd(raw: string): number {
  return STOP.exec(raw)?.index ?? raw.length;
}

/**
 * marked's GFM `url` tokenizer, ended at `bareUrlEnd`: the URL is read again from the shortened
 * text so its trailing-punctuation rules still apply, and what follows is lexed as text.
 */
export const cjkBoundedUrls: TokenizerObject = {
  url(src) {
    const token = Tokenizer.prototype.url.call(this, src);
    if (!token) return false;
    const end = bareUrlEnd(token.raw);
    if (end === token.raw.length) return token;
    return Tokenizer.prototype.url.call(this, src.slice(0, end));
  },
};
