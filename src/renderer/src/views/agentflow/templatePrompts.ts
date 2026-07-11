// Default LLM prompts seeded into flows created from a template.
//
// These stay in English on purpose: prompt-following is more reliable in English
// across every provider, and the reply language is pinned by a single injected
// line instead. They are seed content the user edits afterwards, not UI chrome,
// so they carry no i18n keys.

const LANGUAGE_NAMES: Record<string, string> = {
  de: 'German',
  'en-US': 'English',
  es: 'Spanish',
  fr: 'French',
  ja: 'Japanese',
  ko: 'Korean',
  'pt-BR': 'Brazilian Portuguese',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese (Taiwan)',
};

// Chat-tuned models like to open with "Here is the summary you asked for". In a
// Telegram channel that line is pure noise, so every prompt bans it explicitly —
// naming what the first emitted character has to be is what makes the ban stick.
function outputOnlyRule(firstLine: string): string {
  return `- Emit the finished post and nothing else: no lead-in sentence, no "here is", no note about how many items you received, no closing remarks. Your reply starts on the first character of ${firstLine}.`;
}

// Downstream, the reply is rendered as Markdown before it reaches Telegram, and a
// bare URL renders as a naked domain name ("engadget.com") rather than the title.
// Only the exact `[text](url)` form — no space between "]" and "(" — becomes a
// title-anchored link.
const MARKDOWN_LINK_RULE =
  '- Write every link as a Markdown link — `[text](url)`, with no space between "]" and "(" — copying the url verbatim from the input. Never leave a bare URL and never put the url in plain parentheses: both render as a naked domain name instead of the title.';

// The reply-language line, resolved once when the flow is created. An unknown
// locale still yields a usable instruction from the tag alone.
//
// Exported for the test suite: pure, offline, deterministic.
export function localeInstruction(locale: string): string {
  const name = LANGUAGE_NAMES[locale];
  return name
    ? `Write the entire response in ${name} [${locale}].`
    : `Write the entire response in the language identified by the IETF tag ${locale}.`;
}

// One new RSS article -> one Telegram briefing. Runs inside the loop, once per
// article: the rss step hands over {title, link} and the browser step fetches the
// page. One article per call keeps the input well under every provider's limit
// and the reply well under Telegram's message cap — the batched version blew
// through both. `{{browser_1}}` is the page's whole visible text, so it opens on
// the site's navigation menu; the prompt has to say so.
export function rssBriefingPrompt(locale: string): string {
  return `You are a professional news summarizer. Turn the article below into a high-density Telegram briefing.

Output exactly:

**[<title, translated>]({{item.link}})**
<One paragraph, 60-100 words: what actually happened — the launch, the release, the policy change, the offer. Open on the event itself.>
<One paragraph, 80-150 words: the specifics. Pull out every hard number the page gives you — model names, technical specs, version numbers, prices with their currency, discounts, percentage gains, physical dimensions. Put a space between a number and its unit: 100 W, 5 nm, 120 Hz.>
#tag1 #tag2 #tag3 #tag4 #tag5

Rules:
${outputOnlyRule('the title')}
${MARKDOWN_LINK_RULE}
- The page text starts with the site's navigation and menu links, and may end with related-article lists and a footer. Ignore all of that and summarize the article itself.
- Use only the title, link and page text given below. Never invent a URL, a price or a figure, and never cite a source that is not in the input.
- Drop subjective filler. "Powerful", "great value" and "impressive" carry no information — give the number or the spec instead.
- 5-8 hashtags, no spaces inside a tag.

${localeInstruction(locale)}

Title: {{item.title}}
Link: {{item.link}}

Page text:
{{browser_1}}`;
}

// Scraped watchlist -> Telegram digest. `{{scraper_1}}` is a JSON array of
// {title, link}: titles and links only, no page content. The prompt has to say
// so, or the model will invent detail it cannot see.
export function webMonitorPrompt(locale: string): string {
  return `You are a change monitor. The JSON array below lists the items that appeared on the watched page since the last check. Each entry has a "title" and a "link", and nothing else — you cannot see the page content.

Output:

<One opening line: how many new items there are, and what they have in common if anything.>
Then one bullet per item:
- **[<title>](<link>)**

You may add a short clause of at most 20 words explaining why an item might matter, but only where the title itself supports it. Where it does not, give the title and link alone.

Rules:
${outputOnlyRule('that opening line')}
${MARKDOWN_LINK_RULE}
- Use only the titles and links given below. Never invent a URL, a detail or an item.

${localeInstruction(locale)}

{{scraper_1}}`;
}

// weather + stock + forex -> one friendly morning brief. The three skills each
// emit a JSON object; the model is handed all three and asked to lay them out.
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

// A periodic watch report: one line per symbol, current price + today's change.
// The data may be a single quote object OR a JSON array of them (multiple
// symbols), so the prompt has to handle both.
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

// --- Command templates (bot/chat triggered) ---
// These reply to a person in a chat, so unlike the digest prompts they may open
// conversationally. The command argument the user typed arrives as {{input}}.

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

// Video transcript -> summary. Runs inside the loop, once per new video.
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
