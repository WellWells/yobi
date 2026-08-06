import { localeInstruction, outputOnlyRule, mapReviewsPrompt } from '../../../../shared/mapReviewsPrompt';
export { mapReviewsPrompt };

const MARKDOWN_LINK_RULE =
  '- Write every link as a Markdown link — `[text](url)`, with no space between "]" and "(" — copying the url verbatim from the input. Never leave a bare URL and never put the url in plain parentheses: both render as a naked domain name instead of the title.';

export function articleBriefingPrompt(locale: string): string {
  return `You are a professional summarizer. Turn the linked page below into a high-density Telegram briefing.

Output exactly:

**[<title, translated>]({{item.link}})**
<One paragraph, 60-100 words: what actually happened — the launch, the release, the policy change, the announcement, the offer. Open on the event or main point itself, not on background.>
<One paragraph, 80-150 words: the specifics. Pull out every hard fact and number the page gives you — names, technical specs, version numbers, prices with their currency, dates, percentage changes, quantities, physical dimensions. Put a space between a number and its unit: 100 W, 5 nm, 120 Hz.>
#tag1 #tag2 #tag3 #tag4 #tag5

Rules:
${outputOnlyRule('the title')}
${MARKDOWN_LINK_RULE}
- The page text starts with the site's navigation and menu links, and may end with related-item lists and a footer. Ignore all of that and summarize the page's main content itself.
- Use only the title, link and page text given below. Never invent a URL, a price or a figure, and never cite a source that is not in the input.
- Drop subjective filler. "Powerful", "great value" and "impressive" carry no information — give the fact or the number instead.
- 5-8 hashtags, no spaces inside a tag.

${localeInstruction(locale)}

Title: {{item.title}}
Link: {{item.link}}

Page text:
{{browser_1}}`;
}

export function morningBriefPrompt(locale: string): string {
  return `Write a short, friendly morning brief from the data below. It has up to three compact sections in this order: the weather, the watched stocks, and the exchange rate. Keep it skimmable — a line or two each, tasteful emoji, no tables.

Rules:
${outputOnlyRule('the brief')}
- A section whose data below is blank or marked failed was not requested — omit that section entirely rather than mentioning it or guessing. Include only the sections that have data.
- Use only the numbers in the data below. Never invent a figure.
- Put a space between a number and its unit (25 °C, 3.2 %).

${localeInstruction(locale)}

Weather: {{weather_1}}
Stocks: {{stock_1}}
Exchange rates: {{fx_1}}`;
}

export function stockWatchPrompt(locale: string): string {
  return `Report where these stocks stand right now, from the data below. One short line per symbol: the ticker (and name if given), the current price with its currency, and today's change as both the amount and the percentage, with a sign and an up/down arrow. Lead with a one-word market mood only if every symbol moved the same direction.

Rules:
${outputOnlyRule('the first symbol line')}
- The data may be a single quote or a list of them — cover every symbol present, in the order given.
- Use only the numbers in the data below. Never invent a figure. Skip any symbol marked failed.
- Put a space between a number and its unit; keep it to one line per symbol, tasteful emoji only.

${localeInstruction(locale)}

{{stock_1}}`;
}

export function askPrompt(locale: string): string {
  return `Answer the question clearly and concisely. If it is ambiguous, answer the most likely reading rather than asking to clarify.

${localeInstruction(locale)}

Question:
{{input}}`;
}

export function summarizeUrlPrompt(locale: string): string {
  return `Summarize the web page below: two or three tight paragraphs, then a short bullet list of the key points. The page text opens with the site's navigation and menu links and may end with a footer — ignore those and summarize the main article.

Use only the page text given. Never invent a figure or a claim it does not contain.

${localeInstruction(locale)}

{{browser_1}}`;
}

export function ytCommandPrompt(locale: string): string {
  return `Summarize the video below from its transcript, keeping the speaker's line of reasoning. Weave in tasteful emoji so it is easy to skim, and end with one line of 3-6 topic hashtags.

Base the summary only on the transcript. Where it is partial or garbled, say so rather than filling the gap.

${localeInstruction(locale)}

{{yt_1.transcript}}`;
}

export function stockQuotePrompt(locale: string): string {
  return `Write a one-paragraph plain-language read on how this stock is doing today, from the quote data below: the price, the change, the day's range. No advice.

Use only the numbers in the quote below.

${localeInstruction(locale)}

{{stock_1}}`;
}

export function youtubeSummaryPrompt(locale: string): string {
  return `Summarize the whole video and tell me what it is about, without breaking the speaker's original line of reasoning. Weave in tasteful emoji so the result reads lively and is easy to skim. End with one line of 3-6 topic hashtags (for example #Keyword — no spaces inside a tag) so it can be searched later.

Base the summary only on the transcript below. Where the transcript is partial or garbled, say so rather than filling the gap.

Rules:
${outputOnlyRule('the summary itself')}

${localeInstruction(locale)}

Title: {{video.title}}
Video: {{video.link}}

Transcript:
{{yt_1.transcript}}`;
}
