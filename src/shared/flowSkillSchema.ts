import type { SkillType } from './types';
import { PROVIDER_URLS } from './types';

export const DEFAULT_SKILL_CONFIG: Record<SkillType, Record<string, string>> = {
  shell: { command: '', shell: '' },
  run: { path: '', args: '' },
  js: { code: '' },
  browser: { url: '', includeImage: 'false' },
  browser_open: { url: '', show: 'false' },
  browser_js: { page: '', code: '', emitFailFlag: 'false' },
  browser_close: { page: '' },
  llm: {
    prompt: '',
    provider: '',
    saveToHistory: 'false',
    emitFailFlag: 'false',
    exportFormat: '',
    exportTitle: '',
    exportFileName: '',
    exportShowProvider: 'false',
    exportShowTimestamp: 'false',
    palette: '',
    useMemory: 'false',
  },
  clipboard: { action: 'read', text: '' },
  delay: { delayMs: '1000' },
  notify: { title: '', body: '' },
  capture: { format: 'png', output: '' },
  bot: { chatId: '', message: '', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' },
  rss: { url: '', fetchContent: 'false', includeImage: 'false', cacheDays: '3', checkpoint: '', lastLinks: '' },
  stop: { value: '' },
  comment: { note: '' },
  scraper: { url: '', itemSelector: '', titleSelector: '', linkSelector: '', maxItems: '5', cacheDays: '3' },
  loop: { input: '', loopVar: 'item', limitIterations: 'true', maxIterations: '5' },
  end_loop: {},
  if: { left: '', operator: 'is_true', right: '' },
  end_if: {},
  break: {},
  continue: {},
  sysinfo: { format: 'text', includeGpu: 'true', includePublicIp: 'false' },
  http: { method: 'GET', url: '', headers: '', body: '' },
  youtube: { url: '' },
  youtube_subs: { channels: '', perChannel: '3', cacheDays: '3', skipShorts: 'true' },
  power: { action: '' },
  restart_app: {},
  file_write: { folder: '', filename: '', content: '' },
  file_read: { path: '' },
  file_list: { directory: '' },
  file_delete: { path: '' },
  file_download: { url: '', filename: '', folder: '', maxSizeMb: '100' },
  email_send: { to: '', subject: '', body: '', fromName: '' },
  text: { text: '' },
  stock: { symbol: '' },
  forex: { base: 'USD', target: '', amount: '', precision: '4' },
  weather: { location: '', units: 'metric' },
  random: { min: '1', max: '100', count: '1', unique: 'false' },
};

export const SKILL_TYPES = Object.keys(DEFAULT_SKILL_CONFIG) as SkillType[];

export const SKILLS_WITHOUT_OUTPUT_KEY: SkillType[] = ['comment', 'if', 'end_if', 'end_loop', 'break', 'continue', 'power', 'restart_app', 'browser_close', 'file_delete', 'file_write', 'file_download', 'run', 'delay', 'notify', 'email_send'];

export interface SkillConfigField {
  key: string;
  desc: string;
  required?: boolean;
}

export interface SkillSpec {
  type: SkillType;
  summary: string;
  fields: SkillConfigField[];
}

const PROVIDER_URL_LIST = Object.values(PROVIDER_URLS).join(', ');

export const SKILL_SPECS: SkillSpec[] = [
  {
    type: 'llm',
    summary: 'Send a prompt to the AI web UI and capture the answer.',
    fields: [
      { key: 'prompt', desc: 'the prompt text; may embed {{variables}}', required: true },
      { key: 'provider', desc: `provider URL, one of [${PROVIDER_URL_LIST}] or "" to use the default provider` },
      { key: 'saveToHistory', desc: '"true"|"false" — also save the answer as a Markdown history file' },
      { key: 'emitFailFlag', desc: '"true"|"false" — on failure set {{<outputKey>.isFailed}}=1 and continue instead of aborting' },
      { key: 'useMemory', desc: '"true"|"false" — load this flow\'s memory into the prompt and let the model append to it via a "new_memory:" line' },
      { key: 'exportFormat', desc: '""|"png"|"webp"|"pdf" — when set, render the answer to an image/pdf file' },
      { key: 'exportTitle', desc: 'when exportFormat is set, the heading shown on the exported card; may embed {{variables}} (default "AgentFlow LLM Export")' },
      { key: 'exportFileName', desc: 'when exportFormat is set, the output file name (blank auto-generates a unique name)' },
      { key: 'exportShowProvider', desc: '"true"|"false" — when exportFormat is set, show the AI provider name on the exported card (default "true")' },
      { key: 'exportShowTimestamp', desc: '"true"|"false" — when exportFormat is set, show a timestamp on the exported card (default "true")' },
      { key: 'palette', desc: 'when exportFormat is set, the card colour theme by key — dark: aurora|mint|rose|ocean|sunset|forest|violet|steel|ember; light: dawn|mist|sand|sage|sky|peach|lavender|linen (blank = default dark)' },
    ],
  },
  {
    type: 'browser',
    summary: "Read a human web PAGE and return its visible text (renders JavaScript). For articles/SPA pages. Accepts one URL, a JSON array of URLs, or a comma/newline list. NOT for JSON APIs — use http instead. With includeImage=\"true\" (single URL only) it also exposes the page's cover image as {{<outputKey>.image}} (og:image URL, or '' if none).",
    fields: [
      { key: 'url', desc: 'the page URL (or list); may embed {{variables}}', required: true },
      { key: 'includeImage', desc: '"true"|"false" — also extract the cover image (og:image) into {{<outputKey>.image}}; single URL only (default "false")' },
    ],
  },
  {
    type: 'browser_open',
    summary: "Open a live background browser page and return a reusable page handle for interactive automation (login, form fill, click, scrape, screenshot). Exposes {{<outputKey>}} = the page handle id (pass it to browser_js / browser_close), {{<outputKey>.title}} = page title, {{<outputKey>.url}} = current URL. The session is persistent, so a site logged into once (set show:true the first time to sign in manually) stays logged in on later runs. Pair with browser_js to drive the page and a browser_close at the end (any pages left open auto-close when the flow ends).",
    fields: [
      { key: 'url', desc: 'the page URL to open; may embed {{variables}}', required: true },
      { key: 'show', desc: '"true"|"false" — open a visible window (e.g. for a first-time manual login / captcha) instead of in the background (default "false")' },
    ],
  },
  {
    type: 'browser_js',
    summary:
      "Run custom JavaScript INSIDE a live page opened by browser_open to fill forms, click buttons, read data, or screenshot. Set page to that step's handle (e.g. {{tab_1}}). The code runs in the page with these async helpers in scope (all selectors are CSS selectors): " +
      "await waitFor(sel, timeoutMs?) -> waits for and returns the element (default 15000ms); " +
      "await fill(sel, value) -> sets an input/textarea/contenteditable value (React-safe); " +
      "click(sel) -> realistic click; read(sel) -> innerText of the first match (or ''); " +
      "readAll(sel) -> array of innerTexts; await sleep(ms); " +
      "await screenshot(name?) -> saves a PNG of the page and returns its file path; plus raw document/window. " +
      "End with `return <value>` to set {{<outputKey>}} (objects are JSON-stringified; undefined/null become '').",
    fields: [
      { key: 'page', desc: 'the page handle from a prior browser_open (e.g. {{tab_1}})', required: true },
      { key: 'code', desc: 'JavaScript to run in the page; use the helpers (waitFor/fill/click/read/readAll/sleep/screenshot) and `return value` to produce the output', required: true },
      { key: 'emitFailFlag', desc: '"true"|"false" — on failure set {{<outputKey>.isFailed}}=1 and continue instead of aborting' },
    ],
  },
  {
    type: 'browser_close',
    summary: 'Close a live browser page opened by browser_open, freeing its memory. Set page to the handle (e.g. {{tab_1}}), or "all" to close every page this run opened. Use as the last browser step (pages also auto-close when the flow ends).',
    fields: [{ key: 'page', desc: 'the page handle to close (e.g. {{tab_1}}), or "all"', required: true }],
  },
  {
    type: 'shell',
    summary: 'Run a local system command and return stdout.',
    fields: [
      { key: 'command', desc: 'the command line; may embed {{variables}}', required: true },
      { key: 'shell', desc: 'shell to run the command in — Windows "cmd"|"powershell"; macOS/Linux a shell path like "/bin/zsh"|"/bin/bash"|"/bin/sh" (blank = the platform default)' },
    ],
  },
  {
    type: 'run',
    summary: 'Launch a local program/executable with arguments and continue immediately (fire-and-forget; does not wait or capture output). For shell commands with pipes/redirects use "shell" instead.',
    fields: [
      { key: 'path', desc: 'path to the executable; may embed {{variables}}', required: true },
      { key: 'args', desc: 'space-separated arguments; may embed {{variables}} (e.g. "{{a}} {{b}}")' },
    ],
  },
  {
    type: 'js',
    summary: 'Run in-process JavaScript to transform data between steps. Prior step outputs are in scope as variables named by their outputKey (e.g. {{http_1}} is available as http_1); use "return value" to set the output. Node built-ins JSON, Math, Date, fetch, URL, Buffer, crypto are available.',
    fields: [
      { key: 'code', desc: 'JavaScript body; reference prior outputs by their outputKey and use "return value" to produce the output', required: true },
    ],
  },
  {
    type: 'clipboard',
    summary: 'Read from or write to the system clipboard.',
    fields: [
      { key: 'action', desc: '"read"|"write"', required: true },
      { key: 'text', desc: 'text to write when action="write"; may embed {{variables}}' },
    ],
  },
  {
    type: 'rss',
    summary: "Fetch an RSS/Atom feed and return only the NEW articles since the previous run (deduplicated across runs). The output shape depends on fetchContent — see OUTPUT. With includeImage=\"true\" it also exposes the digest's cover image (first new article's og:image) as {{<outputKey>.image}}.",
    fields: [
      { key: 'url', desc: 'the feed URL', required: true },
      { key: 'fetchContent', desc: '"true"|"false" — also fetch each article body' },
      { key: 'includeImage', desc: '"true"|"false" — also extract the first article\'s cover image (og:image) into {{<outputKey>.image}} (default "false")' },
      { key: 'cacheDays', desc: 'dedup window in days; a link seen within this many days is skipped (default "3")' },
    ],
  },
  {
    type: 'scraper',
    summary: 'Extract a LIST of items from a web page via CSS selectors, returning only NEW items since the last run as a JSON array of {title, link}. For monitoring listings. (Use browser to read one page as text; use http for APIs.)',
    fields: [
      { key: 'url', desc: 'the page URL', required: true },
      { key: 'itemSelector', desc: 'CSS selector for each item container (optional)' },
      { key: 'titleSelector', desc: 'CSS selector for the title' },
      { key: 'linkSelector', desc: 'CSS selector for the link' },
      { key: 'maxItems', desc: 'max number of new items per run (e.g. "5")' },
      { key: 'cacheDays', desc: 'dedup window in days; an item seen within this many days is skipped (default "3")' },
    ],
  },
  {
    type: 'youtube',
    summary: "Fetch a YouTube video's transcript AND title. Exposes {{<outputKey>}} = transcript (empty if no captions), {{<outputKey>.title}} = video title, and {{<outputKey>.isFailed}} = \"0\" on success / \"1\" on failure (no captions / invalid URL). Follow with an if on {{<outputKey>.isFailed}} to branch on success/failure, then an llm step referencing {{<outputKey>}} and {{<outputKey>.title}} to summarize it.",
    fields: [
      { key: 'url', desc: 'the YouTube video URL (watch / youtu.be / shorts); may embed {{variables}}', required: true },
    ],
  },
  {
    type: 'youtube_subs',
    summary: "Monitor a LIST of YouTube channels (a subscription list) and return only NEW videos since the previous run (see OUTPUT for the per-item shape). Resolves each channel's RSS feed from a handle/URL/channelId and de-duplicates across runs; a newly-added channel is seeded with only its latest video so adding channels never floods. Follow with a loop over the array (loopVar e.g. \"video\"), then a youtube step on {{video.link}} to fetch each transcript.",
    fields: [
      { key: 'channels', desc: 'one channel per line: an @handle (e.g. @askvinh) or an https URL (a channel URL like https://www.youtube.com/@handle or /channel/UC..., or a feeds/videos.xml RSS URL)', required: true },
      { key: 'perChannel', desc: 'how many latest videos to take per channel (default "3")' },
      { key: 'skipShorts', desc: '"true"|"false" — exclude YouTube Shorts (/shorts/ URLs), keeping only regular videos (default "true")' },
      { key: 'cacheDays', desc: 'dedup window in days; a video seen within this many days is skipped (default "3")' },
    ],
  },
  {
    type: 'sysinfo',
    summary: 'Collect local system/hardware/network info (OS, CPU, GPU, memory, local IP, uptime, time, app versions). Great as input for a following llm step to analyze.',
    fields: [
      { key: 'format', desc: '"text" (human-readable) | "json"' },
      { key: 'includeGpu', desc: '"true"|"false" — include the GPU model' },
      { key: 'includePublicIp', desc: '"true"|"false" — also look up the public IP (makes a network request)' },
    ],
  },
  {
    type: 'http',
    summary: 'Call an API/endpoint and return the RAW response body. The only fetch skill with custom method/headers/body — use it for REST/JSON APIs, authenticated requests, and webhooks. NOT for reading human web pages — use browser.',
    fields: [
      { key: 'method', desc: '"GET"|"POST"|"PUT"|"PATCH"|"DELETE"' },
      { key: 'url', desc: 'the request URL; may embed {{variables}}', required: true },
      { key: 'headers', desc: 'optional JSON object of request headers, e.g. {"Authorization":"Bearer x"}' },
      { key: 'body', desc: 'optional request body for POST/PUT/PATCH; may embed {{variables}}' },
    ],
  },
  {
    type: 'bot',
    summary: "Send a Telegram message (requires Telegram to be configured). Set attachment to also send a file/photo — a local path (e.g. {{file}}) or an http(s) URL (e.g. {{rss_1.image}}); the message becomes its caption. A caption longer than Telegram's 1024-char limit is trimmed in place so the photo and its caption always arrive as ONE message.",
    fields: [
      { key: 'message', desc: 'the message text (or the attachment caption when attachment is set); may embed {{variables}}', required: true },
      { key: 'chatId', desc: 'comma-separated chat IDs, or {{bot.triggerChatId}}, or "" to broadcast to all paired users' },
      { key: 'attachment', desc: 'optional file to send — a local path inside the app output folder (e.g. {{file}}) or an http(s) URL (e.g. {{rss_1.image}}); empty = text only' },
      { key: 'attachmentType', desc: '"auto"|"photo"|"document" — how to send the attachment; "auto" (default) sends image URLs (e.g. an og:image cover) as a photo and falls back to a document if it is not a renderable image, and judges local files by extension/content' },
      { key: 'emitFailFlag', desc: '"true"|"false" — on send failure set {{<outputKey>.isFailed}}=1 and continue instead of aborting the flow' },
    ],
  },
  {
    type: 'delay',
    summary: 'Pause the flow for a number of milliseconds.',
    fields: [
      { key: 'delayMs', desc: 'milliseconds to wait (default 1000, max 3600000 = 1 hour)' },
    ],
  },
  {
    type: 'notify',
    summary: 'Show a desktop notification (system toast); also recorded in the flow run log.',
    fields: [
      { key: 'title', desc: 'notification title' },
      { key: 'body', desc: 'notification body; may embed {{variables}}' },
    ],
  },
  {
    type: 'capture',
    summary: 'Capture a screenshot of the primary screen and save it to an image file; outputs the saved file path (e.g. to send via Telegram).',
    fields: [
      { key: 'format', desc: '"png"|"jpg"' },
      { key: 'output', desc: 'destination folder to save the screenshot into; blank = the app output folder' },
    ],
  },
  {
    type: 'power',
    summary: 'Perform a local power / session action (shut down, restart, sign out, sleep, lock, hibernate). Side-effect only; use as the final step. Destructive actions take effect immediately.',
    fields: [
      { key: 'action', desc: '"shutdown"|"restart"|"logout"|"sleep"|"lock"|"hibernate"; "" or omitted does nothing' },
    ],
  },
  {
    type: 'restart_app',
    summary: 'Restart the Yobi app itself (NOT the computer — use power for that). The app closes and relaunches automatically, interrupting any running flow. Side-effect only, no outputKey; use as the final step. Empty config.',
    fields: [],
  },
  {
    type: 'stop',
    summary: 'Gracefully halt the flow when a value is empty. Useful right after rss/scraper to skip empty runs.',
    fields: [{ key: 'value', desc: 'the value to test; flow stops when it resolves to "" or "[]"', required: true }],
  },
  {
    type: 'loop',
    summary: 'Repeat every following step (until the matching end_loop) once per item of a JSON array.',
    fields: [
      { key: 'input', desc: 'a JSON array (usually {{<prev outputKey>}})', required: true },
      { key: 'loopVar', desc: 'iteration variable name, default "item" (use {{item}} / {{item.field}} inside)' },
      { key: 'limitIterations', desc: '"true"|"false" — cap the number of iterations' },
      { key: 'maxIterations', desc: 'max iterations when limitIterations="true" (e.g. "5")' },
    ],
  },
  {
    type: 'end_loop',
    summary: 'Closes a loop block. Must pair with a preceding loop. Empty config, no outputKey.',
    fields: [],
  },
  {
    type: 'if',
    summary: 'Run the steps until the matching end_if only when the condition holds. Empty config aside from the comparison; no outputKey.',
    fields: [
      { key: 'left', desc: 'left value; may embed {{variables}}', required: true },
      { key: 'operator', desc: '"is_true"|"is_false"|"equals"|"not_equals"|"contains"|"is_empty"', required: true },
      { key: 'right', desc: 'right value for equals/not_equals/contains' },
    ],
  },
  {
    type: 'end_if',
    summary: 'Closes an if block. Must pair with a preceding if. Empty config, no outputKey.',
    fields: [],
  },
  {
    type: 'break',
    summary: 'Exit the current loop entirely (stop iterating) and resume at the step after the matching end_loop. Only valid inside a loop; place it inside an if/end_if to make it conditional. Empty config, no outputKey.',
    fields: [],
  },
  {
    type: 'continue',
    summary: 'Skip the rest of the current loop iteration and move on to the next item. Only valid inside a loop; place it inside an if/end_if to make it conditional. Empty config, no outputKey.',
    fields: [],
  },
  {
    type: 'comment',
    summary: 'Documentation only — never executes. No outputKey.',
    fields: [{ key: 'note', desc: 'the note text' }],
  },
  {
    type: 'text',
    summary: 'Define a fixed or templated text value and expose it as {{<outputKey>}} for later steps to reuse. The text may embed {{variables}}, so it also composes/formats a string from earlier outputs. Sent to a bot step it is delivered as a text message — use file_write if you need it as a file.',
    fields: [
      { key: 'text', desc: 'the text content; may embed {{variables}}', required: true },
    ],
  },
  {
    type: 'file_write',
    summary: 'Write text to a local file — a terminal action with no outputKey. If a later step needs to act on the file (e.g. a bot step uploading it to Telegram, or a file_delete), it references {{file}} = the path of the most recently written/captured file. Parent folders are created automatically.',
    fields: [
      { key: 'content', desc: 'the text content to write; may embed {{variables}}', required: true },
      { key: 'filename', desc: 'file name; blank auto-generates a unique date+random name. Tokens: {date} {time} {datetime} {rand}. Without an extension, ".txt" is added.' },
      { key: 'folder', desc: 'destination folder; blank uses the app output folder. A relative path is resolved under the output folder.' },
    ],
  },
  {
    type: 'file_read',
    summary: 'Read a local text file and return its contents as text.',
    fields: [
      { key: 'path', desc: 'the file path to read; may embed {{variables}}', required: true },
    ],
  },
  {
    type: 'file_list',
    summary: 'List the files in a local directory (non-recursive, files only) as a JSON array of {title, link} (title = file name, link = full path). Follow with a loop over the array using {{item.title}} / {{item.link}}.',
    fields: [
      { key: 'directory', desc: 'the directory path to list; may embed {{variables}}', required: true },
    ],
  },
  {
    type: 'file_delete',
    summary: 'Delete a local file (no error if it is already gone). Place it after a step that consumed the file — e.g. after a bot upload — to clean up a temporary file. Side-effect only, no outputKey.',
    fields: [
      { key: 'path', desc: 'the file path to delete; usually a prior file_write output, e.g. {{file_write_1}} or {{file}}', required: true },
    ],
  },
  {
    type: 'email_send',
    summary: 'Send an email over SMTP. Requires SMTP credentials configured in Settings › Email (the password is stored encrypted on this device, never in the flow). Side-effect only.',
    fields: [
      { key: 'to', desc: 'recipient email address(es), comma-separated; may embed {{variables}}', required: true },
      { key: 'subject', desc: 'the email subject; may embed {{variables}}', required: true },
      { key: 'body', desc: 'the plain-text email body; may embed {{variables}}' },
      { key: 'fromName', desc: 'optional sender display name (the address is the configured SMTP user)' },
    ],
  },
  {
    type: 'stock',
    summary: "Get a stock/equity quote (data source: Yahoo Finance, no API key). Market = symbol suffix: US tickers as-is (AAPL), Taiwan .TW (2330.TW) / .TWO (OTC), indices ^ (^TWII). {{<outputKey>}} = a JSON quote object; a SINGLE symbol also exposes sub-vars {{<outputKey>.price/.open/.high/.low/.volume/.change/.changePct/.name/.currency/.marketTime/.previousClose/.isFailed}}. Multiple comma/newline symbols → a JSON array, no sub-vars. Never throws — a bad symbol sets {{<outputKey>.isFailed}}=1.",
    fields: [
      { key: 'symbol', desc: 'one symbol, or several comma/newline-separated (e.g. "AAPL", "2330.TW")', required: true },
    ],
  },
  {
    type: 'forex',
    summary: "Get a foreign-exchange rate (and optional converted amount) (data source: open.er-api.com, no API key). {{<outputKey>}} = a JSON object plus sub-vars {{<outputKey>.rate/.converted/.amount/.base/.target/.asOf/.isFailed}}. Never throws — an unknown currency sets {{<outputKey>.isFailed}}=1.",
    fields: [
      { key: 'base', desc: 'base currency ISO code (e.g. USD)', required: true },
      { key: 'target', desc: 'target currency ISO code (e.g. TWD)', required: true },
      { key: 'amount', desc: 'optional amount of base to convert; blank = 1 (rate only)' },
      { key: 'precision', desc: 'decimal places for rate/converted in the output (default "4")' },
    ],
  },
  {
    type: 'weather',
    summary: "Get the weather for a place NAME (data source: Open-Meteo + geocoding, no API key). {{<outputKey>}} = ONE full JSON object {location,temp,feelsLike,condition,humidity,windSpeed,unit,isDay,high,low,rainChance} (current conditions + today's high/low/rain). The same fields are also exposed as sub-vars {{<outputKey>.temp/.feelsLike/.condition/.humidity/.windSpeed/.unit/.isDay/.high/.low/.rainChance/.location/.isFailed}} — pick whichever you need. Never throws — an unknown place sets {{<outputKey>.isFailed}}=1.",
    fields: [
      { key: 'location', desc: 'place name, e.g. "Tokyo" or "Paris, France"', required: true },
      { key: 'units', desc: '"metric" (°C, km/h) | "imperial" (°F, mph)' },
    ],
  },
  {
    type: 'file_download',
    summary: 'Download a file from an https URL to disk (binary-safe) — a terminal sink with no outputKey. The saved path is exposed as {{file}} for a later bot/email/file_delete step. The extension is derived from the response Content-Type so a Telegram bot step routes images as photos.',
    fields: [
      { key: 'url', desc: 'the https:// URL to download; may embed {{variables}} (e.g. {{item.link}})', required: true },
      { key: 'filename', desc: 'optional name; blank auto-generates. Tokens {date}/{time}/{datetime}/{rand}. Extension auto-added from Content-Type when omitted.' },
      { key: 'folder', desc: 'destination folder; blank = the app output folder; a relative path resolves under it' },
      { key: 'maxSizeMb', desc: 'abort if the download exceeds this many MB (default "100", "0" = no limit)' },
    ],
  },
  {
    type: 'random',
    summary: "Generate random WHOLE numbers within an exact inclusive range (both min and max can occur) — for dice, lottery numbers, picking an item index, or jitter. The output shape depends on count: a single number is a bare value, several numbers are a JSON array you loop over (see OUTPUT).",
    fields: [
      { key: 'min', desc: 'the lowest value that may be produced (inclusive; may be negative); may embed {{variables}}', required: true },
      { key: 'max', desc: 'the highest value that may be produced (inclusive); may embed {{variables}}', required: true },
      { key: 'count', desc: 'how many numbers to produce (default "1")' },
      { key: 'unique', desc: '"true"|"false" — when producing several, forbid duplicates (lottery-style); if count exceeds the range size it is capped to the range size (default "false")' },
    ],
  },
];

export const SKILL_OUTPUT: Record<SkillType, string> = {
  shell: '{{<outputKey>}} = the command stdout, trimmed (falls back to stderr when stdout is empty); no sub-variables.',
  run: '',
  js: '{{<outputKey>}} = your `return` value coerced to a string — objects/arrays are JSON-stringified (return an array to drive a following loop), numbers/booleans are stringified, and null/undefined/no-return give ""; no sub-variables.',
  browser: '{{<outputKey>}} = the page\'s visible text (multiple URLs are joined with a "---" separator); with includeImage="true" on a SINGLE url, {{<outputKey>.image}} = the cover image URL ("" if none).',
  browser_open: '{{<outputKey>}} = the page handle id (pass it to browser_js / browser_close); {{<outputKey>.title}} = page title; {{<outputKey>.url}} = current URL.',
  browser_js: '{{<outputKey>}} = the value you `return` (objects JSON-stringified; undefined/null/empty give ""). A screenshot() path comes back via {{<outputKey>}} only — browser_js does NOT set {{file}}. With emitFailFlag="true", {{<outputKey>.isFailed}} = "0"/"1".',
  browser_close: '',
  llm: '{{<outputKey>}} = the AI answer text. BUT when exportFormat is set, {{<outputKey>}} instead becomes the saved file PATH and the magic {{file}} is set to it (chain the file via {{file}}). With emitFailFlag="true", {{<outputKey>.isFailed}} = "0"/"1".',
  clipboard: '{{<outputKey>}} = the clipboard text when action="read"; "" when action="write".',
  delay: '',
  notify: '',
  capture: '{{<outputKey>}} = the saved image path; the magic {{file}} is also set to it (use {{file}} in a later bot/file_delete step).',
  bot: '{{<outputKey>}} = the sent text (the editor hides it; rarely chained). With emitFailFlag="true", {{<outputKey>.isFailed}} = "0"/"1" and a send failure does not abort.',
  rss: '{{<outputKey>}}: with fetchContent="false" a JSON array of NEW link strings (loop with {{item}}); with fetchContent="true" ONE formatted plain-text digest — NOT an array, feed it whole to an llm step, do not loop. "[]" when nothing is new. With includeImage="true", {{<outputKey>.image}} = the first article\'s cover image.',
  stop: '{{<outputKey>}} = the tested value, passed through unchanged when non-empty; if it resolves to "" or "[]" the flow stops — inside a loop this skips the current item, at top level it halts the whole flow.',
  comment: '',
  scraper: '{{<outputKey>}} = a JSON array of {title, link} ("[]" if none); loop over it and use {{item.title}} / {{item.link}}.',
  loop: 'Inside the block each iteration sets {{<loopVar>}} (a string item) or {{<loopVar>.field}} (an object item, e.g. {{item.title}} / {{item.link}}); the loop step\'s own {{<outputKey>}} only echoes the input array.',
  end_loop: '',
  if: '',
  end_if: '',
  break: '',
  continue: '',
  sysinfo: '{{<outputKey>}} = ONE string (key:value lines for format="text", or a JSON document for format="json"); NO sub-variables — feed the whole value to a following llm step.',
  http: '{{<outputKey>}} = the raw response body text (returned for ANY status code; "" for an empty url); NO sub-variables — if the body is JSON, parse it in a following js step before referencing fields.',
  youtube: '{{<outputKey>}} = the transcript ("" if no captions); {{<outputKey>.title}} = video title; {{<outputKey>.isFailed}} = "0"/"1"; {{<outputKey>.image}} = the thumbnail URL (present even on failure, usable as a bot attachment).',
  youtube_subs: '{{<outputKey>}} = a JSON array of {title, link, image} ("[]" if none); loop (e.g. loopVar "video") and use {{video.title}} / {{video.link}} / {{video.image}} (image = the thumbnail URL, usable as a bot attachment).',
  power: '',
  restart_app: '',
  file_write: 'No {{<outputKey>}} — the written file PATH is set as the magic {{file}}; reference {{file}} in a later bot/email_send/file_delete step.',
  file_read: '{{<outputKey>}} = the file\'s text content ("" if the path is blank); no sub-variables.',
  file_list: '{{<outputKey>}} = a JSON array of {title, link} (title = file name, link = full path); loop over it and use {{item.title}} / {{item.link}}.',
  file_delete: '',
  file_download: 'No {{<outputKey>}} — the downloaded file PATH (extension derived from Content-Type) is set as the magic {{file}}; reference {{file}} in a later bot/email_send/file_delete step.',
  email_send: '',
  text: '{{<outputKey>}} = the interpolated text string (no sub-variables); delivered as a plain text message when fed to a bot step.',
  stock: '{{<outputKey>}} = a JSON quote object; a SINGLE symbol also exposes {{<outputKey>.symbol/.name/.currency/.price/.open/.high/.low/.volume/.previousClose/.change/.changePct/.marketTime/.isFailed}} (some may be ""); MULTIPLE symbols give a JSON array of the same-shaped objects (no sub-vars) — loop and use {{item.symbol}} / {{item.price}}.',
  forex: '{{<outputKey>}} = a JSON object {base,target,rate,amount,converted,asOf} plus sub-vars {{<outputKey>.rate/.converted/.amount/.base/.target/.asOf/.isFailed}} (.isFailed="1" on an unknown currency; never throws).',
  weather: '{{<outputKey>}} = a JSON object {location,temp,feelsLike,condition,humidity,windSpeed,unit,isDay,high,low,rainChance}; the same fields plus .isFailed are also exposed as sub-vars {{<outputKey>.temp}} etc. (.isFailed="1" on an unknown place; never throws).',
  random: 'count="1" (or blank): {{<outputKey>}} = a single whole number as a string (e.g. "42") — embed it directly. count>1: {{<outputKey>}} = a JSON array of whole numbers (e.g. [42,7,91]) — loop over it and use {{item}} (a plain value, NOT {{item.field}}). No sub-variables.',
};

function renderSkillLine(spec: SkillSpec): string {
  const hasOutput = !SKILLS_WITHOUT_OUTPUT_KEY.includes(spec.type);
  const fields = spec.fields.length === 0
    ? 'config: {} (empty object)'
    : `config keys: ${spec.fields.map((f) => `"${f.key}" (${f.desc}${f.required ? '; REQUIRED' : ''})`).join('; ')}`;
  const outputDoc = SKILL_OUTPUT[spec.type];
  const output = outputDoc ? ` OUTPUT: ${outputDoc}` : '';
  return `- "${spec.type}"${hasOutput ? '' : ' [no outputKey]'}: ${spec.summary} ${fields}${output}`;
}

const EXAMPLE_FLOW_JSON = JSON.stringify(
  {
    name: 'RSS Digest to Telegram',
    description: 'Summarize new RSS articles and send them to Telegram on weekday mornings.',
    trigger: { type: 'cron', cronExpression: '0 8 * * 1-5' },
    steps: [
      { type: 'rss', label: 'Fetch feed', config: { url: 'https://www.engadget.com/rss.xml', fetchContent: 'true' }, outputKey: 'rss_1' },
      { type: 'stop', label: 'Stop if nothing new', config: { value: '{{rss_1}}' }, outputKey: 'stop_1' },
      { type: 'llm', label: 'Summarize', config: { prompt: 'Summarize these articles as bullet points:\n\n{{rss_1}}', provider: '' }, outputKey: 'llm_1' },
      { type: 'bot', label: 'Send to Telegram', config: { message: '{{llm_1}}', chatId: '' }, outputKey: 'bot_1' },
    ],
  },
  null,
  2,
);

export function buildFlowGenerationPrompt(description: string): string {
  const skillLines = SKILL_SPECS.map(renderSkillLine).join('\n');
  return [
    'You are a flow compiler for "Yobi", an Electron desktop automation app.',
    'Convert the user request below into ONE AgentFlow flow expressed as strict JSON.',
    '',
    'OUTPUT RULES (critical):',
    '- Output ONLY the JSON object. No prose, no explanation, no markdown code fences.',
    '- Do NOT include "id", "createdAt", or "updatedAt" — they are assigned by the app.',
    '- Every value inside every step "config" object MUST be a string (use "true"/"false", not booleans).',
    '',
    'JSON SHAPE:',
    '{',
    '  "name": string,                // short flow name',
    '  "description": string,         // one sentence',
    '  "trigger": { "type": "manual" | "hotkey" | "cron" | "bot" | "chat", ... },',
    '  "extraTriggers": [ { ...same shape as trigger... } ],  // OPTIONAL — omit unless the flow needs several triggers',
    '  "steps": [ { "type": <skill>, "label": string, "config": { ... }, "outputKey": string }, ... ]',
    '}',
    '',
    'TRIGGER:',
    '- manual: {"type":"manual"} (default when unsure)',
    '- hotkey: {"type":"hotkey","keys":"CommandOrControl+Shift+Y"}',
    '- cron:   {"type":"cron","cronExpression":"0 8 * * 1-5"}  (standard 5-field cron)',
    '- bot:    {"type":"bot","botCommand":"my_cmd","botCommandDescription":"...","botInputVariable":"input"}  (a Telegram /command)',
    '- chat:   {"type":"chat","chatCommand":"my_cmd","chatCommandDescription":"...","chatInputVariable":"input"}  (a /command run from the in-app chat)',
    'Infer the trigger from the request (e.g. "every morning at 8" -> cron "0 8 * * *").',
    '- A bot/chat trigger seeds the user\'s argument text as the variable named by botInputVariable/chatInputVariable (default {{input}}); a bot trigger also exposes {{bot.triggerChatId}} (the sender) for a bot step\'s chatId.',
    '- Multiple triggers: keep the primary in "trigger" and put the rest in the OPTIONAL "extraTriggers" array (same shape) — e.g. a cron PLUS a chat command. Omit "extraTriggers" entirely for a single-trigger flow.',
    '',
    'STEPS — choose from these skills only:',
    skillLines,
    '',
    'RULES:',
    '- "outputKey" is a unique snake_case id (e.g. "rss_1", "llm_1"); reference a prior step output with {{outputKey}}.',
    '- A {{outputKey}} reference must point to a step that appears EARLIER in the steps array.',
    '- Each step\'s OUTPUT (above) states exactly what {{outputKey}} resolves to — match a downstream reference to that shape (a JSON array → loop it; a plain string → use it directly).',
    '- Built-in variables: {{clipboard}}, {{timestamp}}, {{flow.name}}. Loop body: {{item}}, {{item.<field>}}.',
    '- Sub-variables: some steps also expose {{outputKey.field}} extras (see each skill\'s OUTPUT, e.g. {{yt_1.title}}, {{weather_1.temp}}, {{stock_1.price}}); only reference the sub-variables named in that skill\'s OUTPUT.',
    '- Magic {{file}}: capture, file_write, file_download, and an llm step with exportFormat set the most-recently produced file path as {{file}}; to send or delete that file, reference {{file}} (NOT the step\'s outputKey).',
    '- Failure branching: a step with emitFailFlag="true" (llm, browser_js, bot) sets {{outputKey.isFailed}}="0" on success or "1" on failure and continues instead of aborting — gate later steps with an "if" on {{outputKey.isFailed}}.',
    '- Skills marked [no outputKey] must use "outputKey": "".',
    '- Fetch skills — pick the right one: "browser" to read a human web page as text, "scraper" to extract a list of titles/links from a page, "http" to call a JSON/REST API or webhook (the only one supporting POST/headers/body).',
    '- Every "loop" needs a matching "end_loop" later; every "if" needs a matching "end_if" (blocks may nest).',
    '- Every config value is a PLAIN string. Never use markdown: URLs must be bare like "https://example.com/feed", NOT "[https://example.com/feed](https://example.com/feed)".',
    '- Keep the flow minimal and correct; only include steps the request needs.',
    '',
    'EXAMPLE (request: "every weekday at 8am summarize my RSS feed and send it to Telegram"):',
    EXAMPLE_FLOW_JSON,
    '',
    'USER REQUEST:',
    description.trim(),
  ].join('\n');
}

export function buildFlowRepairPrompt(description: string, previousResponse: string, error: string): string {
  return [
    'Your previous attempt to produce an AgentFlow flow JSON was REJECTED.',
    `Validation error: ${error}`,
    '',
    'Your previous output (for reference — do not repeat its mistake):',
    previousResponse.trim().slice(0, 4_000),
    '',
    'Produce a corrected flow that fixes the error above and obeys ALL of these rules:',
    '',
    buildFlowGenerationPrompt(description),
  ].join('\n');
}
