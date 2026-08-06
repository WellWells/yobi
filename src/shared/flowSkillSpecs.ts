import type { SkillType } from './types';

export type { SkillType };
import { PROVIDER_URLS } from './types';

export const DEFAULT_SKILL_CONFIG: Record<SkillType, Record<string, string>> = {
  shell: { command: '', shell: '' },
  run: { path: '', args: '' },
  js: { code: '' },
  browser: { url: '', includeImage: 'false', emitFailFlag: 'false' },
  browser_open: { url: '', show: 'false' },
  browser_js: { page: '', code: '', emitFailFlag: 'false' },
  browser_close: { page: '' },
  llm: {
    prompt: '',
    provider: '',
    attachments: '',
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
  share: {
    content: '', format: 'pdf', zip: 'false', width: '1200',
    title: '', filename: '', palette: 'linen', backgroundStyle: 'gradient',
    expire: '1week', burnAfterReading: 'false', emitFailFlag: 'false',
  },
  bot: { chatId: '', message: '', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' },
  rss: { url: '' },
  stop: { value: '' },
  comment: { note: '' },
  scraper: { url: '', itemSelector: '', titleSelector: '', linkSelector: '', maxItems: '5' },
  search: { query: '', limit: '10' },
  research: { query: '', depth: 'standard', sources: '', emitFailFlag: 'false' },
  gmap_reviews: { url: '', sort: 'mixed', count: '100' },
  loop: { input: '', loopVar: 'item', limitIterations: 'true', maxIterations: '5' },
  end_loop: {},
  if: { left: '', operator: 'is_true', right: '' },
  end_if: {},
  on_change: { value: '' },
  break: {},
  continue: {},
  sysinfo: { format: 'text', fields: '' },
  http: { method: 'GET', url: '', headers: '', body: '' },
  youtube: { url: '' },
  youtube_subs: { channels: '', perChannel: '3', skipShorts: 'true' },
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
  air_quality: { location: '', source: 'auto' },
  random: { min: '1', max: '100', count: '1', unique: 'false' },
};

export const SKILL_TYPES = Object.keys(DEFAULT_SKILL_CONFIG) as SkillType[];

/*
 * Type names that existed in shipped flows.json files and in flows an AI may still generate
 * from an older prompt. Renaming a skill cannot rename what is already on disk, so every entry
 * point that reads a step type — persistence and import validation — resolves through here.
 */
export const LEGACY_SKILL_TYPES: Record<string, SkillType> = {
  doc_export: 'share',
};

export function canonicalSkillType(type: string): SkillType | null {
  const migrated = LEGACY_SKILL_TYPES[type];
  if (migrated) return migrated;
  return SKILL_TYPES.includes(type as SkillType) ? (type as SkillType) : null;
}

export const SKILLS_WITHOUT_OUTPUT_KEY: SkillType[] = ['comment', 'if', 'end_if', 'end_loop', 'break', 'continue', 'stop', 'power', 'restart_app', 'browser_close', 'file_delete', 'file_write', 'file_download', 'capture', 'run', 'delay', 'notify', 'email_send'];

export interface SkillConfigField {
  key: string;
  desc: string;
  required?: boolean;
}

/**
 * `brief` is the tier-1 listing text — the only thing the skill-selection prompt sees for a
 * skill it has not chosen yet, so it must front-load WHEN to reach for this skill rather than
 * describe what it is. `summary` is tier-2: it is disclosed only for the selected skills, so it
 * can afford to be long. `BRIEF_MAX_CHARS` is enforced by test/flowGenPromptBudget.test.ts.
 */
export const BRIEF_MAX_CHARS = 150;

export interface SkillSpec {
  type: SkillType;
  brief: string;
  summary: string;
  fields: SkillConfigField[];
}

const PROVIDER_URL_LIST = Object.values(PROVIDER_URLS).join(', ');

export const SKILL_SPECS: SkillSpec[] = [
  {
    type: 'llm',
    brief: "Ask an AI to write, summarize, translate, classify or judge text. Use when the step needs judgement, not data.",
    summary: 'Send a prompt to the AI web UI and capture the answer.',
    fields: [
      { key: 'prompt', desc: 'the prompt text; may embed {{variables}}', required: true },
      { key: 'provider', desc: `provider URL, one of [${PROVIDER_URL_LIST}] or "" to use the default provider` },
      { key: 'saveToHistory', desc: '"true"|"false" — also save the answer as a Markdown history file' },
      { key: 'emitFailFlag', desc: '"true"|"false" — on failure set {{<outputKey>.isFailed}}=1 and continue instead of aborting' },
      { key: 'useMemory', desc: '"true"|"false" — load this flow\'s memory into the prompt and let the model append to it via a "new_memory:" line' },
      { key: 'attachments', desc: 'optional local file paths to upload with the prompt (comma or newline separated) — typically {{file}} from an earlier share/capture/file_write step. Only files produced by this run or living in the app output folder are allowed. Supported by Gemini only; other providers send the prompt as text and log a note' },
      { key: 'exportFormat', desc: '""|"png"|"webp"|"pdf" — when set, render the answer to an image/pdf file' },
      { key: 'exportTitle', desc: 'when exportFormat is set, the heading shown on the exported card; may embed {{variables}} (default "Yobi LLM Export")' },
      { key: 'exportFileName', desc: 'when exportFormat is set, the output file name (blank auto-generates a unique name)' },
      { key: 'exportShowProvider', desc: '"true"|"false" — when exportFormat is set, show the AI provider name on the exported card (default "true")' },
      { key: 'exportShowTimestamp', desc: '"true"|"false" — when exportFormat is set, show a timestamp on the exported card (default "true")' },
      { key: 'palette', desc: 'when exportFormat is set, the card colour theme by key — dark: aurora|mint|rose|ocean|sunset|forest|violet|steel|ember; light: dawn|mist|sand|sage|sky|peach|lavender|linen (blank = default dark)' },
    ],
  },
  {
    type: 'browser',
    brief: "Read one web page (or several) as text. Use to get an article's body after a list step handed you links.",
    summary: "Read a human web PAGE and return its visible text (renders JavaScript). For articles/SPA pages. Accepts one URL, a JSON array of URLs, or a comma/newline list. NOT for JSON APIs — use http instead. With includeImage=\"true\" (single URL only) it also exposes the page's cover image as {{<outputKey>.image}} (og:image URL, or '' if none).",
    fields: [
      { key: 'url', desc: 'the page URL (or list); may embed {{variables}}', required: true },
      { key: 'includeImage', desc: '"true"|"false" — also extract the cover image (og:image) into {{<outputKey>.image}}; single URL only (default "false")' },
      { key: 'emitFailFlag', desc: '"true"|"false" — when a page cannot be fetched, set {{<outputKey>}}="" and {{<outputKey>.isFailed}}=1 and continue instead of aborting; essential inside a loop, where one dead link would otherwise kill the whole run' },
    ],
  },
  {
    type: 'browser_open',
    brief: "Open a persistent, logged-in browser page. Use when a site needs sign-in, clicks or typing before data appears.",
    summary: "Open a live background browser page and return a reusable page handle for interactive automation (login, form fill, click, scrape, screenshot). Exposes {{<outputKey>}} = the page handle id (pass it to browser_js / browser_close), {{<outputKey>.title}} = page title, {{<outputKey>.url}} = current URL. The session is persistent, so a site logged into once (set show:true the first time to sign in manually) stays logged in on later runs. Pair with browser_js to drive the page and a browser_close at the end (any pages left open auto-close when the flow ends).",
    fields: [
      { key: 'url', desc: 'the page URL to open; may embed {{variables}}', required: true },
      { key: 'show', desc: '"true"|"false" — open a visible window (e.g. for a first-time manual login / captcha) instead of in the background (default "false")' },
    ],
  },
  {
    type: 'browser_js',
    brief: "Run JavaScript inside a page opened by browser_open. Use to fill forms, click, read values or screenshot.",
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
    brief: "Close a page opened by browser_open. Use as the last browser step of the flow.",
    summary: 'Close a live browser page opened by browser_open, freeing its memory. Set page to the handle (e.g. {{tab_1}}), or "all" to close every page this run opened. Use as the last browser step (pages also auto-close when the flow ends).',
    fields: [{ key: 'page', desc: 'the page handle to close (e.g. {{tab_1}}), or "all"', required: true }],
  },
  {
    type: 'shell',
    brief: "Run a system command and capture its stdout. Use for local CLI work, pipes and redirects.",
    summary: 'Run a local system command and return stdout.',
    fields: [
      { key: 'command', desc: 'the command line; may embed {{variables}}', required: true },
      { key: 'shell', desc: 'shell to run the command in — Windows "cmd"|"powershell"; macOS/Linux a shell path like "/bin/zsh"|"/bin/bash"|"/bin/sh" (blank = the platform default)' },
    ],
  },
  {
    type: 'run',
    brief: "Launch a program and carry on without waiting. Use to open an app or a file; no output is captured.",
    summary: 'Launch a local program/executable with arguments and continue immediately (fire-and-forget; does not wait or capture output). For shell commands with pipes/redirects use "shell" instead.',
    fields: [
      { key: 'path', desc: 'path to the executable; may embed {{variables}}', required: true },
      { key: 'args', desc: 'space-separated arguments; may embed {{variables}} (e.g. "{{a}} {{b}}")' },
    ],
  },
  {
    type: 'js',
    brief: "Transform data between steps in JavaScript. Use to reshape, filter, compare or compute from earlier outputs.",
    summary: 'Run in-process JavaScript to transform data between steps. Prior step outputs are in scope as variables named by their outputKey (e.g. {{http_1}} is available as http_1); use "return value" to set the output. Node built-ins JSON, Math, Date, fetch, URL, Buffer, crypto are available.',
    fields: [
      { key: 'code', desc: 'JavaScript body; reference prior outputs by their outputKey and use "return value" to produce the output', required: true },
    ],
  },
  {
    type: 'clipboard',
    brief: "Read or write the system clipboard. Use to pick up what the user copied, or leave a result to paste.",
    summary: 'Read from or write to the system clipboard.',
    fields: [
      { key: 'action', desc: '"read"|"write"', required: true },
      { key: 'text', desc: 'text to write when action="write"; may embed {{variables}}' },
    ],
  },
  {
    type: 'rss',
    brief: "Watch an RSS/Atom feed and return only NEW articles. Use for \"tell me when something is published\".",
    summary: 'Fetch an RSS/Atom feed and return only the NEW articles since the previous run (deduplicated across runs) as a JSON array of {title, link}. It returns titles and links only — to summarize an article you must loop over the output and fetch each one with a browser step.',
    fields: [
      { key: 'url', desc: 'the feed URL', required: true },
    ],
  },
  {
    type: 'scraper',
    brief: "Watch a web listing via CSS selectors and return only NEW items. Use when the site has no RSS feed.",
    summary: 'Extract a LIST of items from a web page via CSS selectors, returning only NEW items since the last run as a JSON array of {title, link}. For monitoring listings. (Use browser to read one page as text; use http for APIs.)',
    fields: [
      { key: 'url', desc: 'the page URL', required: true },
      { key: 'itemSelector', desc: 'CSS selector for each item container (optional)' },
      { key: 'titleSelector', desc: 'CSS selector for the title' },
      { key: 'linkSelector', desc: 'CSS selector for the link' },
      { key: 'maxItems', desc: 'max number of new items per run (e.g. "5")' },
    ],
  },
  {
    type: 'search',
    brief: "Search the web for a ranked list of links. Use when you want the links themselves to open next.",
    summary: 'Search the web (DuckDuckGo) and return a ranked LIST of results as a JSON array of {title, link, snippet}. Titles/links/snippets only — no page content and no answer: loop over the output and fetch each page with a browser step (or filter with an llm step first). Stateless — results are NOT deduplicated across runs; for "notify me about NEW items" monitoring use rss or scraper instead. Never aborts the flow: a failure (e.g. a temporary engine rate-limit) is logged and returns "[]".',
    fields: [
      { key: 'query', desc: 'the search query; may embed {{variables}}', required: true },
      { key: 'limit', desc: 'max results to return, 1-10 (default "10"; the engine serves at most 10 per query)' },
    ],
  },
  {
    type: 'research',
    brief: "Research a question end-to-end and return a written, cited answer. Use when you want conclusions, not links.",
    summary: 'Research a QUESTION on the web end-to-end in ONE step and return a written, cited answer: it plans several query angles, reads the top pages, ranks them by relevance and synthesizes the result. Exposes {{<outputKey>}} = the written answer with [n] citation markers, {{<outputKey>.sources}} = a JSON array of the {title, link} pages it read, and {{<outputKey>.count}} = how many. Use this when you want conclusions; use search when you only need a ranked link list to loop over.',
    fields: [
      { key: 'query', desc: 'the question to research (a question, not keywords); may embed {{variables}}', required: true },
      { key: 'depth', desc: '"standard" (default) or "quick" — quick reads 2 sources into a deliberately small prompt: much faster, shallower' },
      { key: 'sources', desc: 'how many pages to read, 1-8; blank = the per-provider default (3 on a web provider, 12 on BYOK)' },
      { key: 'emitFailFlag', desc: '"true"|"false" — when the research fails, set {{<outputKey>}}="" and {{<outputKey>.isFailed}}=1 and continue instead of aborting; essential inside a loop' },
    ],
  },
  {
    type: 'gmap_reviews',
    brief: "Fetch Google Maps reviews plus the place's rating. Use to judge a shop, restaurant, hotel or clinic.",
    summary: 'Fetch Google Maps reviews for one place as a JSON array of {author, rating, date, text, reply} records ("[]" on failure — failures are logged and never abort the flow), PLUS the place-level aggregate on sub-variables: {{<outputKey>.rating}} (overall stars), {{<outputKey>.total}} (total review count), {{<outputKey>.distribution}} (star breakdown). Accepts share links (maps.app.goo.gl) and full place URLs. sort "mixed" (default) samples newest 50% + lowest 25% + highest 25% and dedups, so both positive and negative reviews are always represented; single sorts are also available. Snapshot query — no cross-run dedup; feed the array plus the aggregate into an llm step for analysis, or loop over the array.',
    fields: [
      { key: 'url', desc: 'Google Maps place URL or share link; may embed {{variables}}', required: true },
      { key: 'sort', desc: '"mixed" (default; balanced good+bad sample), "relevant", "newest", "highest", or "lowest"' },
      { key: 'count', desc: 'target number of reviews, 10-300 (default "100"); fewer are returned when the place has fewer' },
    ],
  },
  {
    type: 'youtube',
    brief: "Fetch a YouTube video's transcript and title. Use to summarize or search what was said in a video.",
    summary: "Fetch a YouTube video's transcript AND title. Exposes {{<outputKey>}} = transcript (empty if no captions), {{<outputKey>.title}} = video title, {{<outputKey>.image}} = thumbnail URL, and {{<outputKey>.isFailed}} = \"0\" on success / \"1\" on failure (no captions / invalid URL). Follow with an if on {{<outputKey>.isFailed}} to branch on success/failure, then an llm step referencing {{<outputKey>}} and {{<outputKey>.title}} to summarize it.",
    fields: [
      { key: 'url', desc: 'the YouTube video URL (watch / youtu.be / shorts); may embed {{variables}}', required: true },
    ],
  },
  {
    type: 'youtube_subs',
    brief: "Watch a list of YouTube channels and return only NEW videos. Use to build a subscription digest.",
    summary: "Monitor a LIST of YouTube channels (a subscription list) and return only NEW videos since the previous run (see OUTPUT for the per-item shape). Resolves each channel's RSS feed from a handle/URL/channelId and de-duplicates across runs; a newly-added channel is seeded with only its latest video so adding channels never floods. Follow with a loop over the array (loopVar e.g. \"video\"), then a youtube step on {{video.link}} to fetch each transcript.",
    fields: [
      { key: 'channels', desc: 'one channel per line: an @handle (e.g. @askvinh) or an https URL (a channel URL like https://www.youtube.com/@handle or /channel/UC..., or a feeds/videos.xml RSS URL)', required: true },
      { key: 'perChannel', desc: 'how many latest videos to take per channel (default "3")' },
      { key: 'skipShorts', desc: '"true"|"false" — exclude YouTube Shorts (/shorts/ URLs), keeping only regular videos (default "true")' },
    ],
  },
  {
    type: 'sysinfo',
    brief: "Collect this computer's OS, CPU, memory, GPU, disk and network facts. Use for hardware reports and checks.",
    summary: 'Collect local system/hardware/network info (OS, CPU, memory, GPU, motherboard, BIOS, disks, displays, network) — read WMI-free, so it works even when Windows WMI is broken. "json" format returns a grouped/nested document. Great as input for a following llm step to analyze.',
    fields: [
      { key: 'format', desc: '"text" (human-readable) | "json" (grouped/nested: system/cpu/memory/gpu/displays/motherboard/storage/network)' },
      { key: 'fields', desc: 'OPTIONAL comma-separated subset of field keys to narrow the output — os,platform,hostname,manufacturer,locale,timezone,uptime,time,timeLocal,cpu,cpuSpeed,cpuCores,memoryTotal,memoryFree,memoryType,memoryModules,gpu,graphics,displays,motherboard,bios,disks,volumes,localIp,publicIp,macAddress,gateway,netInterface,networkAdapters,dns,appVersion. OMIT this key entirely to collect the standard local fields. The deep-hardware fields (manufacturer,cpuSpeed,memoryType,memoryModules,graphics,displays,motherboard,bios,disks,volumes,macAddress,gateway,netInterface,networkAdapters,dns) and publicIp are only collected when listed explicitly — they run extra hardware probes or an external network request.' },
    ],
  },
  {
    type: 'http',
    brief: "Call a REST/JSON API or webhook with any method, headers and body. Use for APIs; browser is for human pages.",
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
    brief: "Send a Telegram or LINE message, optionally with a file or photo. Use to deliver a result to the user's phone.",
    summary: "Send a Telegram message (requires Telegram to be configured). Set attachment to also send a file/photo — a local path (e.g. {{file}}) or an http(s) URL (e.g. {{browser_1.image}}); the message becomes its caption. A caption longer than Telegram's 1024-char limit is trimmed in place so the photo and its caption always arrive as ONE message.",
    fields: [
      { key: 'message', desc: 'the message text (or the attachment caption when attachment is set); may embed {{variables}}', required: true },
      { key: 'chatId', desc: 'comma-separated chat IDs, or {{bot.triggerChatId}}, or "" to broadcast to all paired users' },
      { key: 'attachment', desc: 'optional file to send — a local path inside the app output folder (e.g. {{file}}) or an http(s) URL (e.g. {{browser_1.image}}); empty = text only' },
      { key: 'attachmentType', desc: '"auto"|"photo"|"document" — how to send the attachment; "auto" (default) sends image URLs (e.g. an og:image cover) as a photo and falls back to a document if it is not a renderable image, and judges local files by extension/content' },
      { key: 'emitFailFlag', desc: '"true"|"false" — on send failure set {{<outputKey>.isFailed}}=1 and continue instead of aborting the flow' },
    ],
  },
  {
    type: 'delay',
    brief: "Wait a number of milliseconds. Use to pace a loop or let a slow page settle.",
    summary: 'Pause the flow for a number of milliseconds.',
    fields: [
      { key: 'delayMs', desc: 'milliseconds to wait (default 1000, max 3600000 = 1 hour)' },
    ],
  },
  {
    type: 'notify',
    brief: "Show a desktop notification. Use to tell the user something on this computer.",
    summary: 'Show a desktop notification (system toast); also recorded in the flow run log.',
    fields: [
      { key: 'title', desc: 'notification title' },
      { key: 'body', desc: 'notification body; may embed {{variables}}' },
    ],
  },
  {
    type: 'capture',
    brief: "Screenshot the primary screen to an image file. Use to record what is on screen; the path lands in {{file}}.",
    summary: 'Capture a screenshot of the primary screen and save it to an image file — a terminal action with no outputKey. To send or delete the shot in a later step (e.g. a bot upload to Telegram or a file_delete), reference {{file}} = the path of the most recently produced file.',
    fields: [
      { key: 'format', desc: '"png"|"jpg"' },
      { key: 'output', desc: 'destination folder to save the screenshot into; blank = the app output folder' },
    ],
  },
  {
    type: 'share',
    brief: "Turn markdown into a PDF/PNG/WebP file or an encrypted share link. Use when the user wants a document or link.",
    summary: 'Turn markdown into something you can hand over: a PDF / PNG / WebP file, or (format "text") an encrypted paste link on a PrivateBin instance. No AI call involved. For a file, {{<outputKey>}} is the written path and {{file}} points at it too, so a following bot / email_send / file_delete / llm step can act on it with no wiring; for a link, {{<outputKey>}} is the URL and {{file}} is NOT set. Use this (not file_write) when the user asks for a PDF, a picture of some text, a document to send, or a link to share. {{<outputKey>.summary}} is a ready-to-send one-line description of what was produced.',
    fields: [
      { key: 'content', desc: 'the markdown to share; may embed {{variables}}', required: true },
      { key: 'format', desc: '"pdf"|"png"|"webp" to render a file, or "text" for a share link. "zippdf"|"zippng"|"zipwebp" also turn zip on. Blank or unrecognised = pdf' },
      { key: 'zip', desc: '"true"|"false" — file formats only: wrap the result in a .zip (chat apps re-encode a bare image but pass a .zip through)' },
      { key: 'width', desc: 'file formats only: render width in px — 720 (phone), 1000 (standard) or 1200 (wide); blank = 1000' },
      { key: 'title', desc: 'file formats only: document heading; blank = the first markdown heading in content' },
      { key: 'filename', desc: 'file formats only: file name stem; supports {date}/{time}/{datetime}/{rand}. Blank = auto-named' },
      { key: 'palette', desc: 'file formats only: colour scheme key, e.g. "linen" (light document) or "aurora" (dark card); blank = linen' },
      { key: 'backgroundStyle', desc: 'file formats only: "solid"|"gradient"|"mesh"; blank = gradient' },
      { key: 'expire', desc: 'format "text" only: how long the link lives — "5min"|"10min"|"1hour"|"1day"|"1week"|"1month"|"1year"|"never"; blank = the user\'s share setting' },
      { key: 'burnAfterReading', desc: 'format "text" only: "true"|"false" — destroy the paste after it is opened once' },
      { key: 'emitFailFlag', desc: '"true"|"false" — on failure set {{<outputKey>.isFailed}}=1 and continue instead of aborting' },
    ],
  },
  {
    type: 'power',
    brief: "Shut down, restart, sleep, lock, hibernate or sign out of this computer. Use as the final step.",
    summary: 'Perform a local power / session action (shut down, restart, sign out, sleep, lock, hibernate). Side-effect only; use as the final step. Destructive actions take effect immediately.',
    fields: [
      { key: 'action', desc: '"shutdown"|"restart"|"logout"|"sleep"|"lock"|"hibernate"; "" or omitted does nothing' },
    ],
  },
  {
    type: 'restart_app',
    brief: "Restart Yobi itself, not the computer. Use as the final step after changing something read at startup.",
    summary: 'Restart the Yobi app itself (NOT the computer — use power for that). The app closes and relaunches automatically, interrupting any running flow. Side-effect only, no outputKey; use as the final step. Empty config.',
    fields: [],
  },
  {
    type: 'stop',
    brief: "Halt when a value is empty — stops the flow at top level, skips the item inside a loop. Use after a list step.",
    summary: 'Gracefully halt when a value resolves to "" or "[]": at the top level it stops the whole flow, inside a loop it skips the current item and continues with the next. A non-empty value simply passes through (no outputKey — nothing to chain). Useful right after rss/scraper/search/gmap_reviews to skip empty runs.',
    fields: [{ key: 'value', desc: 'the value to test; flow stops when it resolves to "" or "[]"', required: true }],
  },
  {
    type: 'loop',
    brief: "Repeat the following steps once per item of a JSON array. Use to handle a list one entry at a time.",
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
    brief: "Closes a loop block. Every loop needs exactly one.",
    summary: 'Closes a loop block. Must pair with a preceding loop. Empty config, no outputKey.',
    fields: [],
  },
  {
    type: 'if',
    brief: "Run the following steps only when a condition holds. Use to branch, most often on an isFailed flag.",
    summary: 'Run the steps until the matching end_if only when the condition holds. Empty config aside from the comparison; no outputKey.',
    fields: [
      { key: 'left', desc: 'left value; may embed {{variables}}', required: true },
      { key: 'operator', desc: '"is_true"|"is_false"|"equals"|"not_equals"|"contains"|"is_empty"', required: true },
      { key: 'right', desc: 'right value for equals/not_equals/contains' },
    ],
  },
  {
    type: 'end_if',
    brief: "Closes an if block. Every if needs exactly one.",
    summary: 'Closes an if block. Must pair with a preceding if. Empty config, no outputKey.',
    fields: [],
  },
  {
    type: 'break',
    brief: "Leave the loop entirely. Use inside an if to stop iterating early.",
    summary: 'Exit the current loop entirely (stop iterating) and resume at the step after the matching end_loop. Only valid inside a loop; place it inside an if/end_if to make it conditional. Empty config, no outputKey.',
    fields: [],
  },
  {
    type: 'continue',
    brief: "Skip the rest of this iteration and move to the next item. Use inside an if to drop a bad entry.",
    summary: 'Skip the rest of the current loop iteration and move on to the next item. Only valid inside a loop; place it inside an if/end_if to make it conditional. Empty config, no outputKey.',
    fields: [],
  },
  {
    type: 'comment',
    brief: "A note for whoever reads the flow; never runs. Use to explain a section.",
    summary: 'Documentation only — never executes. No outputKey.',
    fields: [{ key: 'note', desc: 'the note text' }],
  },
  {
    type: 'text',
    brief: "Define a fixed or templated string for later steps. Use to compose a message or hold a constant.",
    summary: 'Define a fixed or templated text value and expose it as {{<outputKey>}} for later steps to reuse. The text may embed {{variables}}, so it also composes/formats a string from earlier outputs. Sent to a bot step it is delivered as a text message — use file_write if you need it as a file.',
    fields: [
      { key: 'text', desc: 'the text content; may embed {{variables}}', required: true },
    ],
  },
  {
    type: 'file_write',
    brief: "Write text to a local file. Use to save a result; the path lands in {{file}} for a later send or delete.",
    summary: 'Write text to a local file — a terminal action with no outputKey. If a later step needs to act on the file (e.g. a bot step uploading it to Telegram, or a file_delete), it references {{file}} = the path of the most recently written/captured file. Parent folders are created automatically.',
    fields: [
      { key: 'content', desc: 'the text content to write; may embed {{variables}}', required: true },
      { key: 'filename', desc: 'file name; blank auto-generates a unique date+random name. Tokens: {date} {time} {datetime} {rand}. Without an extension, ".txt" is added.' },
      { key: 'folder', desc: 'destination folder; blank uses the app output folder. A relative path is resolved under the output folder.' },
    ],
  },
  {
    type: 'file_read',
    brief: "Read a local text file. Use to pull in notes, a config or a list the user maintains by hand.",
    summary: 'Read a local text file and return its contents as text.',
    fields: [
      { key: 'path', desc: 'the file path to read (~ = home directory); may embed {{variables}}', required: true },
    ],
  },
  {
    type: 'file_list',
    brief: "List a folder's files. Use to walk a directory with a loop.",
    summary: 'List the files in a local directory (non-recursive, files only) as a JSON array of {title, link} (title = file name, link = full path). Follow with a loop over the array using {{item.title}} / {{item.link}}.',
    fields: [
      { key: 'directory', desc: 'the directory path to list (~ = home directory); may embed {{variables}}', required: true },
    ],
  },
  {
    type: 'file_delete',
    brief: "Delete a local file. Use after a step consumed it, to clean up a temporary file.",
    summary: 'Delete a local file (no error if it is already gone). Place it after a step that consumed the file — e.g. after a bot upload — to clean up a temporary file. Side-effect only, no outputKey.',
    fields: [
      { key: 'path', desc: 'the file path to delete; usually a prior file_write output, e.g. {{file_write_1}} or {{file}}', required: true },
    ],
  },
  {
    type: 'email_send',
    brief: "Send an email over SMTP. Use to deliver a result by mail; credentials live in Settings, not in the flow.",
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
    brief: "Get a stock or index quote. Use for price checks and market alerts.",
    summary: "Get a stock/equity quote (data source: Yahoo Finance, no API key). Market = symbol suffix: US tickers as-is (AAPL), Taiwan .TW (2330.TW) / .TWO (OTC), indices ^ (^TWII). {{<outputKey>}} = a JSON quote object; a SINGLE symbol also exposes sub-vars {{<outputKey>.symbol/.price/.open/.high/.low/.volume/.change/.changePct/.name/.currency/.marketTime/.previousClose/.isFailed}}. Multiple comma/newline symbols → a JSON array, no sub-vars. Never throws — a bad symbol sets {{<outputKey>.isFailed}}=1.",
    fields: [
      { key: 'symbol', desc: 'one symbol, or several comma/newline-separated (e.g. "AAPL", "2330.TW")', required: true },
    ],
  },
  {
    type: 'forex',
    brief: "Get an exchange rate and an optional converted amount. Use for currency alerts and conversions.",
    summary: "Get a foreign-exchange rate (and optional converted amount), quoted near-live (data source: Yahoo Finance, falling back to open.er-api.com's once-daily table; no API key). {{<outputKey>}} = a JSON object plus sub-vars {{<outputKey>.rate/.converted/.amount/.base/.target/.asOf/.previousClose/.changePct/.isFailed}}. Never throws — an unknown currency sets {{<outputKey>.isFailed}}=1. For a \"tell me when it hits X\" alert, follow this with a js comparison and an on_change step so a rate parked past the threshold does not re-notify on every run.",
    fields: [
      { key: 'base', desc: 'base currency ISO code (e.g. USD)', required: true },
      { key: 'target', desc: 'target currency ISO code (e.g. TWD)', required: true },
      { key: 'amount', desc: 'optional amount of base to convert; blank = 1 (rate only)' },
      { key: 'precision', desc: 'decimal places for rate/converted in the output (default "4")' },
    ],
  },
  {
    type: 'weather',
    brief: "Get current weather plus today's high, low and rain chance for a place. Use the English place name.",
    summary: "Get the weather for a place NAME (data source: Open-Meteo + geocoding, no API key). {{<outputKey>}} = ONE full JSON object {location,temp,feelsLike,condition,humidity,windSpeed,unit,isDay,high,low,rainChance} (current conditions + today's high/low/rain). The same fields are also exposed as sub-vars {{<outputKey>.temp/.feelsLike/.condition/.humidity/.windSpeed/.unit/.isDay/.high/.low/.rainChance/.location/.isFailed}} — pick whichever you need. Never throws — an unknown place sets {{<outputKey>.isFailed}}=1.",
    fields: [
      { key: 'location', desc: 'place name, e.g. "Tokyo" or "Paris, France"', required: true },
      { key: 'units', desc: '"metric" (°C, km/h) | "imperial" (°F, mph)' },
    ],
  },
  {
    type: 'air_quality',
    brief: "Get the current air quality (AQI) and pollutants for a place. Use the English place name.",
    summary: 'Get the current air quality for a place NAME — AQI plus the pollutant concentrations behind it. Worldwide via Open-Meteo with no API key; a location in Taiwan additionally reads the nearest Ministry of Environment ground station when the user has saved a (free) MOENV key. Use the place\'s English / Latin-script name (e.g. "Kaohsiung", not "高雄").',
    fields: [
      { key: 'location', desc: 'place name, e.g. "Kaohsiung" or "Delhi, India"', required: true },
      { key: 'source', desc: '"auto" (default — Taiwan places use the MOENV station when a key is saved, everywhere else uses Open-Meteo) | "global" (always Open-Meteo) | "taiwan" (force the MOENV station; falls back to Open-Meteo with no key)' },
    ],
  },
  {
    type: 'file_download',
    brief: "Download a file from an https URL to disk. Use to fetch an image or document; the path lands in {{file}}.",
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
    brief: "Generate random whole numbers in an inclusive range. Use for dice, lottery picks or jitter.",
    summary: "Generate random WHOLE numbers within an exact inclusive range (both min and max can occur) — for dice, lottery numbers, picking an item index, or jitter. The output shape depends on count: a single number is a bare value, several numbers are a JSON array you loop over (see OUTPUT).",
    fields: [
      { key: 'min', desc: 'the lowest value that may be produced (inclusive; may be negative); may embed {{variables}}', required: true },
      { key: 'max', desc: 'the highest value that may be produced (inclusive); may embed {{variables}}', required: true },
      { key: 'count', desc: 'how many numbers to produce (default "1")' },
      { key: 'unique', desc: '"true"|"false" — when producing several, forbid duplicates (lottery-style); if count exceeds the range size it is capped to the range size (default "false")' },
    ],
  },
  {
    type: 'on_change',
    brief: "Pass a value through only when it CHANGED since last run. Use to turn a repeating check into a one-shot alert.",
    summary: "Edge trigger: remember what this step saw last run and only let the value through when it CHANGED. Passing the same value again yields \"\", so a following stop step halts the flow. This is what turns a repeating check into a one-shot alert — a threshold flow that runs hourly would otherwise re-notify every hour the condition stays true. Typical shape: a js step returns a marker like \"hit\" or \"\" -> on_change -> stop -> bot. Falling back below the threshold stores \"\" and re-arms it, so the next crossing alerts again. State is remembered per step (deleting or replacing the step resets it).",
    fields: [
      { key: 'value', desc: 'the value to watch; may embed {{variables}}. Anything that differs from the previous run passes through — a "hit"/"" marker for a threshold alert, or a whole page/price string to fire on any change at all.', required: true },
    ],
  },
];

export const SKILL_OUTPUT: Record<SkillType, string> = {
  shell: '{{<outputKey>}} = the command stdout, trimmed (falls back to stderr when stdout is empty); no sub-variables.',
  run: '',
  js: '{{<outputKey>}} = your `return` value coerced to a string — objects/arrays are JSON-stringified (return an array to drive a following loop), numbers/booleans are stringified, and null/undefined/no-return give ""; no sub-variables.',
  browser: '{{<outputKey>}} = the page\'s visible text (multiple URLs are joined with a "---" separator); with includeImage="true" on a SINGLE url, {{<outputKey>.image}} = the cover image URL ("" if none). With emitFailFlag="true", a fetch failure sets {{<outputKey>}}="" and {{<outputKey>.isFailed}}="1" instead of aborting the flow.',
  browser_open: '{{<outputKey>}} = the page handle id (pass it to browser_js / browser_close); {{<outputKey>.title}} = page title; {{<outputKey>.url}} = current URL.',
  browser_js: '{{<outputKey>}} = the value you `return` (objects JSON-stringified; undefined/null/empty give ""). A screenshot() path comes back via {{<outputKey>}} only — browser_js does NOT set {{file}}. With emitFailFlag="true", {{<outputKey>.isFailed}} = "0"/"1".',
  browser_close: '',
  llm: '{{<outputKey>}} = the AI answer text. BUT when exportFormat is set, {{<outputKey>}} instead becomes the saved file PATH and the magic {{file}} is set to it (chain the file via {{file}}). With emitFailFlag="true", {{<outputKey>.isFailed}} = "0"/"1".',
  clipboard: '{{<outputKey>}} = the clipboard text when action="read"; "" when action="write".',
  delay: '',
  notify: '',
  capture: 'No {{<outputKey>}} — the captured image PATH is set as the magic {{file}}; reference {{file}} in a later bot/email_send/file_delete step.',
  share: '{{<outputKey>}} = the rendered file PATH (file formats) or the share URL (format "text"). {{<outputKey>.kind}} = "file"/"link" — branch on this. For a file the path is ALSO set as the magic {{file}} (reference it in a later bot/email_send/file_delete/llm-attachments step); for a link {{file}} is NOT set. Also: {{<outputKey>.path}} / {{<outputKey>.url}} / {{<outputKey>.deleteUrl}} (the empty one tells you which branch ran), {{<outputKey>.format}} = the format actually produced, {{<outputKey>.requested}} = the one asked for, {{<outputKey>.zipped}} = "0"/"1", {{<outputKey>.fellBack}} = "1" when an over-tall image was re-rendered as PDF instead, {{<outputKey>.expire}} / {{<outputKey>.burn}} for links, and {{<outputKey>.summary}} = a localized one-line description suitable for sending to the user as-is. With emitFailFlag="true", {{<outputKey>.isFailed}} = "0"/"1".',
  bot: '{{<outputKey>}} = the sent text (the editor hides it; rarely chained). With emitFailFlag="true", {{<outputKey>.isFailed}} = "0"/"1" and a send failure does not abort.',
  rss: '{{<outputKey>}} = a JSON array of NEW {title, link} ("[]" when nothing is new); loop over it and use {{item.title}} / {{item.link}}. Titles and links only — no article body.',
  stop: '',
  comment: '',
  scraper: '{{<outputKey>}} = a JSON array of {title, link} ("[]" if none); loop over it and use {{item.title}} / {{item.link}}.',
  research: '{{<outputKey>}} = the written, cited answer (prose with [n] markers — NOT a list, do not loop over it); {{<outputKey>.sources}} = a JSON array of the {title, link} pages that were read (loop over THIS to walk the sources, using {{item.title}} / {{item.link}}); {{<outputKey>.count}} = how many were read. With emitFailFlag="true", a failure sets {{<outputKey>}}="" and {{<outputKey>.isFailed}} = "0"/"1" instead of aborting the flow.',
  search: '{{<outputKey>}} = a JSON array of {title, link, snippet} ranked by relevance ("[]" when nothing matched OR the search failed — failures are logged and never abort the flow; follow with a stop step to halt on an empty list); loop over it and use {{item.title}} / {{item.link}} / {{item.snippet}} (snippet = the result-page summary, may be "").',
  gmap_reviews: '{{<outputKey>}} = a JSON array of {author, rating, date, text, reply} sorted newest-first ("[]" when the place has no reviews OR the fetch failed — failures are logged and never abort the flow); {{<outputKey>.place}} = the place name; {{<outputKey>.rating}} = the place\'s overall Google star rating (e.g. "4.2"), {{<outputKey>.total}} = its total review count (e.g. "2953"), {{<outputKey>.distribution}} = the star breakdown "5★=… 4★=… … 1★=…", {{<outputKey>.positive}} = the positive share as a whole percent (4-5★ over total, e.g. "91"), {{<outputKey>.verdict}} = a Steam-style overall verdict label computed deterministically from the rating + count (e.g. "Very Positive" / "極度好評", localized), {{<outputKey>.tier}} = its tier number "0"–"9" (9 best, 0 = not enough reviews). These are read from the rendered place page (verdict derived from them) and are "" if it could not be read. Loop over the array with {{item.author}} / {{item.rating}} / {{item.date}} / {{item.text}} / {{item.reply}}, or interpolate the whole thing plus {{<outputKey>.rating}}/.total/.distribution into an llm prompt.',
  loop: 'Inside the block each iteration sets {{<loopVar>}} (the string item, or the item JSON for an object item) and {{<loopVar>.<field>}} for EVERY field of an object item (e.g. {{item.title}} / {{item.link}}); inside the block the loop step\'s own {{<outputKey>}}/{{<outputKey>.<field>}} are re-bound to the current item as well.',
  end_loop: '',
  if: '',
  end_if: '',
  break: '',
  continue: '',
  sysinfo: '{{<outputKey>}} = the selected fields as ONE string (key:value lines for format="text", or a JSON document for format="json"); each selected field is ALSO exposed individually as {{<outputKey>.<field>}} (e.g. {{<outputKey>.locale}}, {{<outputKey>.cpu}}, {{<outputKey>.publicIp}}).',
  http: '{{<outputKey>}} = the raw response body text (returned for ANY status code; "" for an empty url); NO sub-variables — if the body is JSON, parse it in a following js step before referencing fields.',
  youtube: '{{<outputKey>}} = the transcript ("" if no captions); {{<outputKey>.title}} = video title; {{<outputKey>.transcript}} = the transcript again (alias of the main output); {{<outputKey>.isFailed}} = "0"/"1"; {{<outputKey>.image}} = the thumbnail URL (usable as a bot attachment; still set when only captions fail, "" when the URL is not a valid YouTube link).',
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
  stock: '{{<outputKey>}} = a JSON quote object; a SINGLE symbol also exposes {{<outputKey>.symbol/.name/.currency/.price/.open/.high/.low/.volume/.previousClose/.change/.changePct/.marketTime/.isFailed}} (some may be ""); MULTIPLE symbols give a JSON array (a failed symbol appears as {symbol, isFailed} only; no sub-vars) — loop and use {{item.symbol}} / {{item.price}}.',
  forex: '{{<outputKey>}} = a JSON object {base,target,rate,amount,converted,asOf,previousClose,changePct} plus sub-vars {{<outputKey>.rate/.converted/.amount/.base/.target/.asOf/.previousClose/.changePct/.isFailed}} (.previousClose/.changePct are the prior session close and the move against it, and are "" when only the daily fallback source was reachable; .isFailed="1" on an unknown currency; never throws).',
  on_change: '{{<outputKey>}} = the value you passed in WHEN it differs from the previous run, otherwise "" — so a following stop step halts every run except the one where it changed. No sub-variables.',
  weather: '{{<outputKey>}} = a JSON object {location,temp,feelsLike,condition,humidity,windSpeed,unit,isDay,high,low,rainChance}; the same fields plus .isFailed are also exposed as sub-vars {{<outputKey>.temp}} etc. (.isFailed="1" on an unknown place; never throws).',
  air_quality: '{{<outputKey>}} = a JSON object {location,station,aqi,level,status,statusLocal,pollutant,pm2_5,pm10,ozone,no2,so2,co,gasUnits,europeanAqi,source,observedAt} plus sub-vars {{<outputKey>.aqi/.level/.status/.statusLocal/.pollutant/.pm2_5/.pm10/.station/.location/.europeanAqi/.source/.observedAt/.isFailed}}. .level is 1-6 (1 Good … 6 Hazardous, 0 = no reading) — compare it numerically rather than matching .status text. .status is always English; .statusLocal is the same band in the app language. .station and .pollutant are filled only by the Taiwan source (blank elsewhere). Gas values are NOT sub-vars because their unit differs by source (see gasUnits). Never throws — .isFailed="1" on an unknown place.',
  random: 'count="1" (or blank): {{<outputKey>}} = a single whole number as a string (e.g. "42") — embed it directly. count>1: {{<outputKey>}} = a JSON array of whole numbers (e.g. [42,7,91]) — loop over it and use {{item}} (a plain value, NOT {{item.field}}). No sub-variables.',
};
