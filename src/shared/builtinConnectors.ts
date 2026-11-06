import { BUILTIN_LINE_SERVER_ID, builtinLineServerConfig, builtinServerConfig } from './types';
import { asksAboutLink } from './linkQuestion';
import { mentionsXPlatform } from './xHandles';
import { SITE_CONNECTOR_ROWS, siteConnectorServerId } from './siteConnectors';
import type { SiteConnectorFlag, SiteConnectorSite } from './siteConnectors';
import type { McpServerConfig } from './types';

/** Stable id/command of the opt-in connector that reaches the user's own Thunderbird. */
export const BUILTIN_THUNDERBIRD_SERVER_ID = 'builtin-thunderbird';

/**
 * i18n key the registry stores as the connector's error while Thunderbird is not running. Shared so
 * the card can tell "waiting for Thunderbird" apart from a real failure.
 */
export const THUNDERBIRD_UNAVAILABLE_ERROR = 'settings.mcp.thunderbird.unavailable';

/** Stable id/command of the in-process connector that reads X (Twitter) as the user. */
export const BUILTIN_X_SERVER_ID = 'builtin-x';

/** Stable id/command of the in-process connector for Taiwan's railways (THSR + TRA timetables and live status) and metros. */
export const BUILTIN_RAIL_SERVER_ID = 'builtin-rail';

/** Stable id/command of the in-process connector that reads PTT (www.ptt.cc) boards and posts. */
export const BUILTIN_PTT_SERVER_ID = 'builtin-ptt';

/** Stable id/command of the in-process connector for the user's own mailbox (IMAP + the shared SMTP account). */
export const BUILTIN_MAIL_SERVER_ID = 'builtin-mail';

/** Stable id/command of the in-process connector for the user's calendars (.ics read, CalDAV read and write). */
export const BUILTIN_CALENDAR_SERVER_ID = 'builtin-calendar';

/** Stable id/command of the in-process connector for free machine translation (no key, no model tokens). */
export const BUILTIN_TRANSLATE_SERVER_ID = 'builtin-translate';

/** Stable id/command of the in-process connector that reads a web page's text by link. */
export const BUILTIN_PAGE_SERVER_ID = 'builtin-page';

/** The config flag that records the user's opt-in for each built-in connector. */
export type BuiltinConnectorFlag =
  | 'lineReaderEnabled' | 'thunderbirdEnabled' | 'xConnectorEnabled' | 'taiwanRailEnabled' | 'pttConnectorEnabled' | 'mailEnabled'
  | 'calendarEnabled' | 'translateConnectorEnabled' | 'pageConnectorEnabled' | SiteConnectorFlag;

export interface BuiltinConnector {
  id: string;
  flag: BuiltinConnectorFlag;
  /** Set for a sign-in connector from `siteConnectors.ts`: the row it was built from. */
  site?: SiteConnectorSite;
  descriptor: () => McpServerConfig;
  /** Words besides the display name that name this connector in a sentence. */
  keywords: readonly string[];
  /** For a name no keyword can carry — X is one letter — a stricter test of the whole message. */
  mentionedIn?: (text: string) => boolean;
  /**
   * Reads only public data — nothing of the user's own (no sign-in, no files, no messages) — so a
   * bot may use it in a group too, still per-account grant. Every other connector stays private
   * chats only: its answers would show the owner's data to the whole group.
   */
  publicData?: true;
  /**
   * Reads any public address the model names, which is what the web switch stands for. It leaves a
   * desktop run with web switched off, goes to a group only when the owner turns it on there, and
   * `mentionedIn` brings it into the one message that matched, not the conversation: that test
   * fires on any link with words around it, and holding a connector makes every later turn an
   * agent run.
   */
  anyPage?: true;
}

/**
 * Built-in connectors are hosted by the app rather than added by URL, so none of them is in
 * `config.mcpServers`. Anything that resolves a connector id against config has to consult this
 * table as well — a built-in missing from one of those places is on in Settings and unknown there.
 */
export const BUILTIN_CONNECTORS: readonly BuiltinConnector[] = [
  { id: BUILTIN_LINE_SERVER_ID, flag: 'lineReaderEnabled', descriptor: builtinLineServerConfig, keywords: [] },
  {
    id: BUILTIN_THUNDERBIRD_SERVER_ID,
    flag: 'thunderbirdEnabled',
    descriptor: () => builtinServerConfig('thunderbird', 'Thunderbird'),
    keywords: ['雷鳥', '雷鸟'],
  },
  {
    id: BUILTIN_X_SERVER_ID,
    flag: 'xConnectorEnabled',
    descriptor: () => builtinServerConfig('x', 'X'),
    // The one-letter name never matches on its own (see connectorKeywords), so phrasings of "on X"
    // stand in for it. Bare possessive/locative forms are left out: math and X-ray text use them too.
    keywords: ['Twitter', 'tweet', 'tweets', 'x.com', 'on X', '推特', 'X 上', 'X上', 'X 平台', 'X平台'],
    mentionedIn: mentionsXPlatform,
  },
  {
    id: BUILTIN_RAIL_SERVER_ID,
    flag: 'taiwanRailEnabled',
    descriptor: () => builtinServerConfig('rail', 'Taiwan Rail'),
    // Words a rider uses about these railways and metros. "Train" is in (in Taiwan it means TRA);
    // "service run" is not — buses and flights have them too, and a match turns the message into
    // an agent run. Bare "metro" and "路線圖" are out for the same reason (Paris Métro, bus routes).
    keywords: [
      '高鐵', '高铁', '台鐵', '臺鐵', '台铁', '火車', '火车', '車次', '自強號', '莒光號', '區間車', '普悠瑪', '太魯閣號', 'THSR',
      '捷運', '捷运', '輕軌', '轻轨', '機捷', '北捷', '高捷', '中捷', '桃捷', '環狀線', '三鶯線', 'MRT',
    ],
    // Public timetables and train status only.
    publicData: true,
  },
  {
    id: BUILTIN_PTT_SERVER_ID,
    flag: 'pttConnectorEnabled',
    descriptor: () => builtinServerConfig('ptt', 'PTT'),
    // The display name already matches "PTT" in any case as a whole word ("ptt.cc" too, not
    // "HTTPTTL"); only the Chinese name needs saying. No board names.
    keywords: ['批踢踢'],
    // Public boards and posts, read signed out.
    publicData: true,
  },
  {
    id: BUILTIN_MAIL_SERVER_ID,
    flag: 'mailEnabled',
    descriptor: () => builtinServerConfig('mail', 'Mail'),
    // Words for the user's own mailbox only. "email", "mail", "信件" and "郵件" are out: "write an
    // email to the client" is a writing request, and a match turns the message into an agent run
    // with the mailbox open.
    keywords: ['信箱', '收件匣', '收件箱', '邮箱', 'Gmail', 'inbox'],
  },
  {
    id: BUILTIN_CALENDAR_SERVER_ID,
    flag: 'calendarEnabled',
    descriptor: () => builtinServerConfig('calendar', 'Calendar'),
    // The display name already matches "calendar". "行程" and "schedule" are out: travel plans and
    // timetables use them, and a match turns the message into an agent run with the calendar open.
    keywords: ['行事曆', '日曆', '行事历', '日历'],
  },
  {
    id: BUILTIN_TRANSLATE_SERVER_ID,
    flag: 'translateConnectorEnabled',
    // Not plain "Translate", and no "翻譯" below: a name is a keyword, and a match turns "translate
    // this sentence" into an agent run, for everyone, since this one is on by default. The extensions
    // stand in for "SRT", which also answers for a question about the format. It is in every run's
    // catalog anyway, for the agent to reach for by itself.
    descriptor: () => builtinServerConfig('translate', 'Free Translate'),
    keywords: ['免費翻譯', '免费翻译', 'free translation', '字幕檔', '字幕文件', 'subtitle file', '.srt', '.vtt'],
  },
  {
    id: BUILTIN_PAGE_SERVER_ID,
    flag: 'pageConnectorEnabled',
    descriptor: () => builtinServerConfig('page', 'Get Page Text'),
    // No bare 內文 or 新聞: a match turns the message into an agent run, and it is on by default. Its
    // title counts as a keyword too, so it is not a phrase people say either. A link is what names it.
    keywords: ['取得內文', '获取正文', '網頁內文', '网页内文', '新聞內文', '新聞全文', '文章全文'],
    mentionedIn: asksAboutLink,
    // Public pages, read signed out, public addresses only.
    publicData: true,
    anyPage: true,
  },
  ...SITE_CONNECTOR_ROWS.map((row): BuiltinConnector => ({
    id: siteConnectorServerId(row.site),
    flag: row.flag,
    descriptor: () => builtinServerConfig(row.site, row.label),
    keywords: row.keywords,
    site: row.site,
  })),
];

/** Built-in connectors carry Yobi's own translated titles (i18n keys); their stored names are English ids. */
export const BUILTIN_CONNECTOR_TITLES: Readonly<Record<string, string>> = {
  [BUILTIN_LINE_SERVER_ID]: 'settings.mcp.line.title',
  [BUILTIN_THUNDERBIRD_SERVER_ID]: 'settings.mcp.thunderbird.title',
  [BUILTIN_X_SERVER_ID]: 'settings.mcp.x.title',
  [BUILTIN_RAIL_SERVER_ID]: 'settings.mcp.rail.title',
  [BUILTIN_PTT_SERVER_ID]: 'settings.mcp.ptt.title',
  [BUILTIN_MAIL_SERVER_ID]: 'settings.mcp.mail.title',
  [BUILTIN_CALENDAR_SERVER_ID]: 'settings.mcp.calendar.title',
  [BUILTIN_TRANSLATE_SERVER_ID]: 'settings.mcp.translate.title',
  [BUILTIN_PAGE_SERVER_ID]: 'settings.mcp.page.title',
  ...Object.fromEntries(SITE_CONNECTOR_ROWS.map((row) => [siteConnectorServerId(row.site), row.keys.title])),
};

/** The connectors a bot may use outside a private chat (see `publicData`). */
export const PUBLIC_DATA_CONNECTOR_IDS: readonly string[] = BUILTIN_CONNECTORS.filter((c) => c.publicData).map((c) => c.id);

export function findBuiltinConnector(id: string): BuiltinConnector | undefined {
  return BUILTIN_CONNECTORS.find((connector) => connector.id === id);
}

/** The connectors that read any public address (see `anyPage`). */
export const ANY_PAGE_CONNECTOR_IDS: readonly string[] = BUILTIN_CONNECTORS.filter((c) => c.anyPage).map((c) => c.id);

export function readsAnyPage(id: string): boolean {
  return ANY_PAGE_CONNECTOR_IDS.includes(id);
}

/** The built-in a `builtin://…` URL names; the chat surfaces know a connector by its URL. */
export function findBuiltinConnectorByUrl(url: string): BuiltinConnector | undefined {
  const target = (url ?? '').trim().toLowerCase();
  return BUILTIN_CONNECTORS.find((connector) => connector.descriptor().url === target);
}
